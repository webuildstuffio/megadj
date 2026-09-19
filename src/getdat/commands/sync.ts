/**
 * megadj sync — incremental archive of the YT Music liked-songs playlist.
 *
 * Every run: refresh playlist state, download pending tracks with rate
 * limiting, enrich metadata, update the tracker. Safe to re-run anytime;
 * already-downloaded tracks are skipped by video ID.
 */

import { $ } from "bun";
import type { ArchiveState } from "../../archive/state";
import { type RateLimiter, TrackGoneError, withRetry } from "../ratelimit";
import {
  Downloader,
  ScPermanentError,
  ytdlpCookieArgs,
  type DownloadResult,
} from "../downloader";
import {
  SC_SOURCE,
  classifyScFailure,
  extractAcquisitionLinks,
  isPrivateUser404,
  mergeScRawLinks,
  ripDecision,
  scRawTrackLinks,
  scTrackIdFromUrl,
  scUserGateNeeded,
  type SyncSource,
} from "../soundcloud";

/** The sync-options source type, re-exported under the CLI arm's name
 *  (cli-commands.ts builds these without importing the module internals).
 *  unicorn's prefer-export-from wants the direct-from-source form — done. */
export type { SyncSource as PlaylistSource } from "../soundcloud";
import { commandLog, ProgressBar } from "../../shared/progress";
import { applyTags } from "../../fulltags/write/writer";
import { probeFile } from "../../fulltags/media-probe";
import {
  buildMetadata,
  scInfoToYtdlpInfo,
  type YtdlpInfo,
} from "../../fulltags/write/metadata-build";
import { guessFromFreeText } from "../../fulltags/genre/genre-vocab";
import { isRecord, isUnknownArray } from "../../shared/leaf/guards";

const isTty = process.stdout.isTTY ?? false;

export interface SyncOptions {
  state: ArchiveState;
  limiter: RateLimiter;
  musicDir: string;
  cookiesFromBrowser: string | null;
  cookiesFile?: string | null | undefined;
  limit?: number | undefined;
  dryRun?: boolean | undefined;
  sources?: SyncSource[] | undefined;
  /** Only download tracks YouTube categorizes as Music. */
  musicOnly?: boolean | undefined;
  /** Stop once this many tracks are downloaded in total. */
  targetTotal?: number | undefined;
  /** #256 link-first: rip even when the track offers an official link. */
  forceRip?: boolean | undefined;
  /** #258-followup: re-probe terminal SC rows (gone/link_surfaced) that
   *  have empty title/artist and backfill identity from the raw API. */
  repairIdentity?: boolean | undefined;
  onProgress?: ((msg: string) => void) | undefined;
  /** Machine-readable summary instead of human logs (P1: --json everywhere). */
  json?: boolean | undefined;
  /** Injectable playlist fetcher for tests — defaults to the yt-dlp probe. */
  fetchPlaylistFn?: typeof fetchPlaylist | undefined;
  /** yt-dlp binary passed to the Downloader. Tests set a nonexistent path
   * so probes fail fast (exit 1, no network) — see sync.test.ts. */
  ytdlpBin?: string | undefined;
}

interface PlaylistEntry {
  id: string;
  title: string | null;
}

/** Decode yt-dlp playlist output at the process boundary. */
export function parsePlaylistOutput(stdout: string): PlaylistEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error("playlist output was not valid JSON", { cause: error });
  }
  if (!isRecord(parsed)) {
    throw new Error("playlist output was not valid JSON");
  }
  const entries = parsed.entries;
  if (entries !== undefined && !isUnknownArray(entries)) {
    throw new Error("playlist output was not valid JSON");
  }
  return (entries ?? []).flatMap((entry): PlaylistEntry[] => {
    if (entry === null || typeof entry !== "object") return [];
    const row = entry as { id?: unknown; title?: unknown };
    return typeof row.id === "string" && row.id.length > 0
      ? [
          {
            id: row.id,
            title: typeof row.title === "string" ? row.title : null,
          },
        ]
      : [];
  });
}

async function fetchPlaylist(
  playlistId: string,
  cookiesFile?: string | null,
  cookiesFromBrowser?: string | null,
): Promise<PlaylistEntry[]> {
  const url = `https://music.youtube.com/playlist?list=${playlistId}`;
  // Cookie flags come from the shared builder (issue #81) — the order
  // (jar first, then browser) lives in ONE place now. History: skipping
  // browser extraction here (the old inline twin) made `megadj sync` 403
  // every auth-required liked list while the downloader worked.
  const cookieArgs = ytdlpCookieArgs(cookiesFile, cookiesFromBrowser);
  const proc = await $`yt-dlp ${[...cookieArgs, "--flat-playlist", "-J", url]}`
    .quiet()
    .nothrow();
  if (proc.exitCode !== 0) {
    throw new Error(
      `playlist fetch failed (${playlistId}): ${new TextDecoder().decode(proc.stderr).slice(0, 300)}`,
    );
  }
  return parsePlaylistOutput(new TextDecoder().decode(proc.stdout));
}

export interface SyncTotals {
  attempted: number;
  downloaded: number;
  gone: number;
  failed: number;
  notMusic: number;
  bytes: number;
  /** #256 link-first: tracks where the rip was SKIPPED because an
   *  official acquisition link was surfaced instead. */
  surfaced: number;
}

/** --repair-identity (#258-followup): re-probe terminal SC rows whose
 *  title/artist are empty and backfill them from the raw API. The probe
 *  is best-effort — a null merge changes nothing. */
async function repairScIdentity(
  opts: SyncOptions,
  log: (msg: string) => void,
): Promise<Partial<SyncTotals>> {
  const thin = opts.state
    .allTracks()
    .filter(
      (t) =>
        t.source.startsWith(SC_SOURCE) &&
        (t.status === "gone" || t.status === "link_surfaced") &&
        (!t.title ||
          t.title.trim() === "" ||
          !t.artist ||
          t.artist.trim() === ""),
    );
  log(`${thin.length} thin terminal row(s) to repair`);
  let repaired = 0;
  for (const row of thin) {
    const raw = await scRawTrackLinks(row.video_id);
    if (raw === null) continue;
    const title = typeof raw.title === "string" ? raw.title : null;
    const artist = typeof raw.user === "string" ? raw.user : null;
    if (title === null && artist === null) continue;
    opts.state.backfillTrackIdentity(row.video_id, title, artist);
    repaired++;
  }
  log(`repaired identity on ${repaired} row(s)`);
  return { attempted: thin.length, downloaded: repaired };
}

/** Build the Downloader source + queue for one sync source. YT playlist
 *  sources keep the flat-playlist -J probe; SC sources (single track, set,
 *  user page) resolve through the SAME yt-dlp invocation, then route by
 *  result shape: a playlist payload fans out to entries, a single-track
 *  payload is a queue of one (#255/#257). Each SC entry becomes a ledger
 *  row keyed by its NUMERIC SC track id; the source column carries
 *  provenance ("soundcloud" / "soundcloud:<label-slug>" for sets). */
/** The injectable SC-queue seam (mirrors sc-search's scSearchImpl): tests
 *  install a canned impl so the gate never touches the SC network. */
export let scSourceQueueImpl: typeof scSourceQueue = scSourceQueue;

/** Install a canned SC-queue impl; returns the restore function. */
export function setScSourceQueueImpl(impl: typeof scSourceQueue): () => void {
  const prev = scSourceQueueImpl;
  scSourceQueueImpl = impl;
  return () => {
    scSourceQueueImpl = prev;
  };
}

async function scSourceQueue(
  source: SyncSource,
  opts: SyncOptions,
): Promise<{ id: string; title: string | null; label: string }[]> {
  const proc = Bun.spawnSync({
    cmd: [
      "yt-dlp",
      ...ytdlpCookieArgs(opts.cookiesFile, opts.cookiesFromBrowser),
      "--flat-playlist",
      "-J",
      scUrlOf(source),
    ],
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  });
  if (proc.exitCode !== 0) {
    const stderr = new TextDecoder().decode(proc.stderr);
    const cls = classifyScFailure(stderr);
    const detail = stderr.split("\n").slice(-2).join(" ").slice(0, 200);
    // #258: a PRIVATE likes/user page 404s exactly like a dead one when
    // no cookies were passed — name the remedy instead of a bare 404.
    if (scUserGateNeeded(source) && isPrivateUser404(stderr)) {
      const remedy = opts.cookiesFromBrowser
        ? "cookies loaded but SC says private/not-found — check the profile name"
        : "pass --cookies-from-browser <browser> (or --cookies <file>) — private likes need auth";
      throw new Error(`SC likes/user unavailable: ${detail} — ${remedy}`);
    }
    if (cls === "gone" || cls === "permanent") {
      // Permanent at the SOURCE level: an honest error, zero work.
      throw new Error(`SC source unavailable (permanent): ${detail}`);
    }
    throw new Error(`SC source fetch failed: ${detail}`);
  }
  const stdout = new TextDecoder().decode(proc.stdout);
  // Guarded parse (same contract as parsePlaylistOutput): a malformed
  // body throws with cause instead of tripping the boundary census's
  // sanction list (#255 follow-through).
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error("SC source output was not valid JSON", { cause: error });
  }
  if (!isRecord(parsed)) {
    throw new Error("SC source output was not valid JSON");
  }
  const entries = parsed.entries;
  if (isUnknownArray(entries)) {
    // A set / user page: fan out. Titles arrive at probe time (flat
    // entries carry only id + url).
    return entries.flatMap((entry) => {
      if (entry === null || typeof entry !== "object") return [];
      const row = entry as { id?: unknown; url?: unknown };
      if (typeof row.id !== "string" || row.id.length === 0) return [];
      const label =
        source.kind === "sc-set"
          ? `${SC_SOURCE}:${scSlug(scUrlOf(source))}`
          : SC_SOURCE;
      return [{ id: row.id, title: null, label }];
    });
  }
  // Single track: the payload IS the track object.
  const trackId =
    typeof parsed.id === "string" && parsed.id.length > 0
      ? parsed.id
      : scTrackIdFromUrl(scUrlOf(source));
  if (!trackId) return [];
  const meta = parsed as { title?: unknown };
  return [
    {
      id: trackId,
      title: typeof meta.title === "string" ? meta.title : null,
      label: SC_SOURCE,
    },
  ];
}

/** "listening-house" from a /sets/<slug> URL — set provenance for the
 *  ledger source column (bounded, no private data). */
function scSlug(url: string): string {
  const slug = url.split("/sets/")[1]?.split(/[?#]/)[0] ?? "";
  return (slug || "set").slice(0, 30);
}

/** Narrow one source of the tagged union to the SC arms (the ytm arm has
 *  no url). Throws never — callers only pass url-bearing kinds. */
function scUrlOf(source: SyncSource): string {
  if (source.kind === "ytm-playlist") {
    throw new Error("ytm-playlist has no SC url");
  }
  return source.url;
}

/** Fresh zeroed counters for one sync run. */
export function newTotals(): SyncTotals {
  return {
    attempted: 0,
    downloaded: 0,
    gone: 0,
    failed: 0,
    notMusic: 0,
    bytes: 0,
    surfaced: 0,
  };
}

interface PreparedSources {
  queue: { video_id: string; title: string | null }[];
}

/** Phase 1-2: refresh playlist state (real run) or build the dry-run preview
 *  (in memory only — a dry run must never write to the state DB). */
async function prepareQueue(
  opts: SyncOptions,
  log: (msg: string) => void,
  isDry: boolean,
): Promise<PreparedSources> {
  const sources: SyncSource[] = opts.sources ?? [
    { kind: "ytm-playlist", id: "LM", label: "liked" },
  ];
  // The run's ledger-source scope (see the queue filter below): YT arms
  // write label as `tracks.source`; SC set arms write "soundcloud:<slug>"
  // and plain "soundcloud" for singles/likes/user pages — include both
  // shapes for the SC kinds so set rows and re-keyed rows all match.
  const sourceLabels = new Set<string>();
  for (const source of sources) {
    sourceLabels.add(source.label);
    if (source.kind !== "ytm-playlist") {
      sourceLabels.add(SC_SOURCE);
      if (source.kind === "sc-set") {
        sourceLabels.add(`${SC_SOURCE}:${scSlug(scUrlOf(source))}`);
      }
    }
  }
  const pendingPreview: {
    video_id: string;
    title: string | null;
    liked_position: number | null;
    status: string;
  }[] = [];

  for (const source of sources) {
    if (source.kind === "ytm-playlist") {
      log(`fetching playlist ${source.id} (${source.label})…`);
      const entries = await (opts.fetchPlaylistFn ?? fetchPlaylist)(
        source.id,
        opts.cookiesFile,
        opts.cookiesFromBrowser,
      );
      log(`  ${entries.length} tracks`);
      if (!isDry) {
        entries.forEach((entry, index) => {
          opts.state.upsertTrackFromPlaylist(
            entry.id,
            index,
            entry.title,
            source.label,
          );
        });
      } else {
        // Dry-run on a fresh DB would otherwise report 0 tracks (the pending
        // queue is only populated by real runs). Project what WOULD be
        // tracked — in memory, nothing written — so `--dry-run` answers
        // "what would the next real run do?" on any database state.
        pendingPreview.push(
          ...entries.map((entry, index) => ({
            video_id: entry.id,
            title: entry.title,
            liked_position: index,
            status: "pending",
          })),
        );
      }
      continue;
    }
    // SC sources (#255/#257): single track / set / user page.
    log(`fetching soundcloud ${source.kind} (${source.label})…`);
    const entries = await scSourceQueueImpl(source, opts);
    log(`  ${entries.length} track(s)`);
    entries.forEach((entry, index) => {
      if (!isDry) {
        opts.state.upsertTrackFromPlaylist(
          entry.id,
          index,
          entry.title,
          entry.label,
        );
      }
      pendingPreview.push({
        video_id: entry.id,
        title: entry.title,
        liked_position: index,
        status: "pending",
      });
    });
  }

  // Cross-source dedupe: a video already downloaded from one source stays put.
  // A dry run previews playlist entries in memory (nothing was upserted, so
  // the DB queue is blind to them); a real run reads only the DB queue.
  // #255-fix (Sep 19, paro-sets incident): the queue is FILTERED TO THIS
  // RUN'S SOURCES — the unfiltered pendingTracks() made a `--sc-url <set>`
  // run attempt all 1,100 pre-existing YT pending rows (their YT probes
  // burned the backoff ladder and marked 3 rows failed) before ever
  // reaching the SC set. Rows carry their source label in `tracks.source`
  // (YT arms: the playlist label; SC arms: "soundcloud"[:slug]), so the
  // label set IS the run's scope.
  let queue: { video_id: string; title: string | null }[] = isDry
    ? pendingPreview
    : opts.state.pendingTracks().filter((row) => sourceLabels.has(row.source));
  // --limit 0 must mean "attempt nothing" (0 is falsy — the old check
  // silently treated it as unlimited); negative was already rejected by the CLI.
  if (opts.limit !== undefined && opts.limit >= 0) {
    queue = queue.slice(0, opts.limit);
  }
  return { queue };
}

/** Music-only gate: reject anything YouTube doesn't categorize as Music. */
function classifyMusic(result: YtdlpInfo, opts: SyncOptions): boolean {
  if (!opts.musicOnly) return true;
  const cats = result.categories ?? [];
  const uploader = (result.uploader ?? result.channel ?? "").toLowerCase();
  return (
    cats.some((c) => c.toLowerCase() === "music") ||
    uploader.includes(" - topic") ||
    uploader.includes("- topic") ||
    (result.artist !== undefined && result.artist !== null)
  );
}

/** stat() can throw if yt-dlp's reported path vanished between the download
 *  finishing and here (AV quarantine, race) — that must fail this one track,
 *  not the whole run. */
export async function statSizeSafe(
  filePath: string,
  log: (msg: string) => void,
): Promise<number | null> {
  try {
    return (await Bun.file(filePath).stat()).size;
  } catch (error) {
    log(`  ⚠ landed file not statable: ${filePath}`);
    void error;
    return null;
  }
}

/** Handle one resolved download outcome (downloaded / gone / failed / no-path).
 *  `isSc` selects the SC codec/format facts (the mp3 twin lands .mp3 at
 *  128k; SC aac rows keep the "aac" codec the LOWQ floors already know). */
export async function settleDownload(
  opts: SyncOptions,
  log: (msg: string) => void,
  bar: ProgressBar,
  totals: SyncTotals,
  track: { video_id: string; title: string | null },
  dl: DownloadResult,
  isSc = false,
): Promise<void> {
  const { state } = opts;
  if (dl.status === "gone") {
    totals.gone++;
    state.markGone(track.video_id, "track unavailable");
    log(`  ↳ gone (unavailable)`);
    bar.update();
    return;
  }
  if (dl.status === "failed") {
    totals.failed++;
    state.markFailed(track.video_id, dl.error ?? "unknown");
    log(`  ↳ failed: ${dl.error?.slice(0, 120)}`);
    bar.update();
    return;
  }
  if (dl.filePath && dl.info) {
    // Preview-clip guard (super-sure pass, Sep 19): SC tracks behind Go+
    // walls serve ONLY a 30-second preview. yt-dlp happily downloads it
    // and the run registered a 30s clip as a full download (15 paro-set
    // rows). The SC probe payload's duration is the FULL track's — a
    // landed file at less than half that duration is a preview, never a
    // rip. SC-only: YT Music never serves previews.
    if (isSc) {
      const fullDuration = dl.info.duration ?? 0;
      const landedProbe = (await probeFile(dl.filePath)).durationS;
      if (
        fullDuration > 90 &&
        landedProbe !== null &&
        landedProbe < fullDuration * 0.5
      ) {
        totals.gone++;
        state.markGone(
          track.video_id,
          `preview-only (${Math.round(landedProbe)}s clip of ${Math.round(fullDuration)}s track) — SC serves no full stream`,
        );
        log(`  ↳ gone: 30s preview downloaded, not the full track`);
        bar.update();
        return;
      }
    }
    const meta = buildMetadata(dl.info);
    await applyTags(dl.filePath, meta);
    const fileSize = await statSizeSafe(dl.filePath, log);
    if (fileSize === null) {
      totals.failed++;
      state.markFailed(
        track.video_id,
        "downloaded file disappeared before verification",
      );
      log(`  ↳ failed: landed file disappeared before verification`);
      bar.update();
      return;
    }
    totals.bytes += fileSize;
    state.markDownloaded(track.video_id, {
      title: meta.title,
      artist: meta.artist,
      album: meta.album,
      genre: meta.genre,
      formatId: dl.formatId ?? null,
      bitrateKbps: Downloader.formatBitrateKbps(dl.formatId),
      codec: isSc && dl.filePath.endsWith(".mp3") ? "mp3" : "aac",
      filePath: dl.filePath,
      fileSizeBytes: fileSize,
      durationS: dl.info.duration ?? null,
    });
    state.updateGenre(track.video_id, meta.genre);
    totals.downloaded++;
    log(`  ↳ downloaded → ${meta.title ?? track.video_id}`);
    bar.update(1, fileSize);
  } else {
    // yt-dlp exited 0 but no usable path/info came back (output drift,
    // odd filename): count the track and burn the attempt — silence
    // here shrank every run summary while consuming retry budget.
    totals.failed++;
    state.markFailed(
      track.video_id,
      "download reported success but no file path was parsed",
    );
    log(`  ↳ failed: no file path parsed from downloader output`);
    bar.update();
  }
}

/** Phase 3: the per-track download loop. */
async function processQueue(
  opts: SyncOptions,
  log: (msg: string) => void,
  queue: { video_id: string; title: string | null }[],
  downloader: Downloader,
  isDry: boolean,
  totals: SyncTotals,
): Promise<void> {
  const bar = new ProgressBar(queue.length, "sync");
  for (const track of queue) {
    // Explicit !== undefined (not truthiness): --target-total 0 must mean
    // "stop immediately" — truthiness used to silently ignore it.
    if (
      opts.targetTotal !== undefined &&
      opts.state.downloadedCount() >= opts.targetTotal
    ) {
      log(`target of ${opts.targetTotal} downloaded reached — stopping`);
      break;
    }
    totals.attempted++;
    if (isTty && !opts.json) process.stdout.write("\r\u001b[K");
    log(
      `[${totals.attempted}/${queue.length}] ${track.title ?? track.video_id}`,
    );

    if (isDry) {
      log(`  ↳ would download (dry-run)`);
      bar.update(0);
      continue;
    }

    const row = opts.state.trackById(track.video_id);
    const isSc = row?.source === SC_SOURCE;

    opts.state.markAttempt(track.video_id, null);

    try {
      const result = await withRetry(
        opts.limiter,
        () => downloader.probe(track.video_id),
        { maxRetries: 2 },
      );
      // #258: SC payloads carry uploader/timestamp instead of artist/date
      // (measured live) — normalize BEFORE the music gate, link-first
      // extraction and tag build read it. #256-followup (Sep 19): yt-dlp's
      // SC extractor NEVER maps the API's `purchase_url` (verified in
      // soundcloud.py's return dict) — the raw API carries it on a large
      // share of label tracks (90 of 220 in the paro-set census). The
      // enrichment fills ONLY the fields yt-dlp left empty (yt-dlp wins),
      // then scInfoToYtdlpInfo normalizes the merged shape. Best-effort:
      // a failed probe changes nothing.
      const probed = isSc
        ? scInfoToYtdlpInfo(
            mergeScRawLinks(
              result as unknown as Record<string, unknown>,
              await scRawTrackLinks(track.video_id),
            ),
          )
        : result;
      // Identity backfill (before any terminal mark): the raw-API merge
      // may have recovered title/user for a row whose probe payload was
      // thin (set fan-out rows carry only id+url). Fill-don't-clobber.
      if (isSc) {
        opts.state.backfillTrackIdentity(
          track.video_id,
          typeof probed.title === "string" ? probed.title : null,
          typeof probed.artist === "string" ? probed.artist : null,
        );
      }

      if (!isSc && !classifyMusic(result, opts)) {
        const cats = result.categories ?? [];
        totals.notMusic++;
        opts.state.markNotMusic(track.video_id, cats[0] ?? null);
        log(`  ↳ skipped (not music: ${cats[0] ?? "no category"})`);
        bar.update();
        continue;
      }

      // #256 LINK-FIRST (SC only): an official acquisition link means the
      // user goes through it instead — the rip is skipped, the link is
      // printed AND persisted. --force-ip rips anyway.
      if (isSc) {
        const links = extractAcquisitionLinks(probed);
        const decision = ripDecision(links, opts.forceRip === true);
        if (decision.action === "surface" && decision.link) {
          const linksJson = JSON.stringify(links);
          opts.state.markLinkSurfaced(
            track.video_id,
            linksJson,
            `${decision.link.kind}: ${decision.link.url}`,
          );
          totals.surfaced++;
          log(`  ↳ link available — go through it: ${decision.link.url}`);
          bar.update();
          continue;
        }
        if (links.length > 0) {
          // force-rip with links present: record the provenance either way.
          opts.state.markForcedRip(track.video_id, JSON.stringify(links));
        }
      }

      // Genre decides the destination folder for this download. No
      // "Music" mint (#61): sanitizeGenreFolder maps null (and "Music"
      // itself) through the same "Unknown Genre" bucket organize uses,
      // so unknown stays ONE recoverable bucket, never a fake genre.
      const downloadGenre = guessFromFreeText([
        probed.genre,
        probed.artist,
        probed.album,
        probed.title,
      ]);

      const dl = await downloader.download(
        track.video_id,
        probed,
        downloadGenre,
      );
      await settleDownload(opts, log, bar, totals, track, dl, isSc);
    } catch (error) {
      const { message } = error as Error;
      if (error instanceof TrackGoneError) {
        totals.gone++;
        opts.state.markGone(track.video_id, "track unavailable");
        log(`  ↳ gone (unavailable)`);
      } else if (error instanceof ScPermanentError) {
        // SC DRM/Go+: parked as gone-class with an honest reason — the
        // stream is not acquirable; retrying would never succeed.
        totals.gone++;
        opts.state.markGone(track.video_id, "DRM/Go+ protected stream");
        log(`  ↳ gone (DRM/Go+ protected — not acquirable)`);
      } else {
        totals.failed++;
        opts.state.markFailed(track.video_id, message.slice(0, 300));
        log(`  ↳ failed after retries: ${message.slice(0, 120)}`);
      }
      bar.update();
    }
  }
  bar.close();
}

/** Phase 4 lives in sync-summary.ts (#211 split: the report/summary tail
 *  beside the totals it reports; sync.ts is the flow). */
import { finishRun } from "./sync-summary";

export async function sync(opts: SyncOptions): Promise<void> {
  const log = commandLog(opts);
  // One downloader per source FAMILY: the URL seam (#255) is decided by
  // the row's source column, so SC and YT legs can share a run — but
  // probes during the playlist phase need the right family when a run is
  // SC-only. The per-track reads below re-derive the target from the ROW,
  // so mixed runs stay correct even with one downloader instance.
  const onlySc =
    (opts.sources ?? []).length > 0 &&
    (opts.sources ?? []).every((s) => s.kind !== "ytm-playlist");
  const downloader = new Downloader({
    musicDir: opts.musicDir,
    ytdlpBin: opts.ytdlpBin,
    cookiesFromBrowser: opts.cookiesFromBrowser,
    cookiesFile: opts.cookiesFile ?? null,
    source: onlySc ? SC_SOURCE : "liked",
  });

  const isDry = opts.dryRun === true;
  // A dry run reports what WOULD happen — it must not write to the state DB
  // (no playlist upserts, no run rows). The old dry-run recorded tracks and
  // a finished run row, so "dry" mutated the archive's memory.
  const runId = isDry ? null : opts.state.startRun();

  // --repair-identity (#258-followup, Sep 19): SC rows that reached a
  // terminal state (gone / link_surfaced) with thin metadata — set/user
  // fan-out entries carry only id+url, so a row marked terminal at probe
  // time never learned its title/artist. This scoped pass re-probes JUST
  // those rows through the raw-API enrichment and backfills the empty
  // columns. Fill-don't-clobber; a failed probe changes nothing.
  if (opts.repairIdentity === true) {
    const repaired = await repairScIdentity(opts, log);
    await finishRun(opts, log, runId, { ...newTotals(), ...repaired });
    return;
  }

  const { queue } = await prepareQueue(opts, log, isDry);
  log(`${queue.length} track(s) to attempt this run`);

  const totals = newTotals();
  await processQueue(opts, log, queue, downloader, isDry, totals);
  await finishRun(opts, log, runId, totals);
}
