// archive/routes.ts — the /api/archive/* route family, extracted from
// index.ts (file-length guard). Pure reads over megadj's archive DB via
// the shared readonly ArchiveReader (§4-A1: archive mutation stays CLI —
// a bug here physically cannot corrupt archive state).
//
// index.ts calls archiveRoutes({ archive, getArchiveSweepDeps }) with the
// URL already sliced to the route part ("/archive/..."). Returns null when
// no archive route matched so index.ts can fall through.
import type { ArchiveReader } from "../db/reader";
import {
  SET_PRESETS,
  buildMegaset,
  parseMegasetQuery,
} from "../megaset/engine";
import {
  clampMegasetPool,
  isMegasetSearchOverride,
  megasetNearestGenreFamily,
  MEGASET_EXCLUDED_PREVIEW_MAX,
} from "../shared/megaset";
import { isSimilarSpace } from "../../shared/leaf/vector-space";
import { intakeCandidateDirs } from "../intake-run";
import type { DB } from "../db";
import type { CrateConfig } from "../config";

export interface ArchiveRouteDeps {
  archive: ArchiveReader;
  db: DB;
  cfg: CrateConfig;
  /** Optional job-engine seam: only the surfaced-batch write needs it
   *  (enqueue the real ingest job instead of blocking the HTTP request
   *  for a minutes-long CLI run). Structural — tests stub it; the
   *  dispatcher supplies the real engine. */
  jobs?: ArchiveJobs | undefined;
}

/** Minimal job-engine surface the archive family may use. */
export interface ArchiveJobs {
  enqueue: (
    driveId: string,
    kind: "ingest",
    mountPoint: string,
    origin: string,
  ) => { id: string };
}

/** The CLI spawn seam for the family's single write (skip). The reads
 *  stay direct over the readonly reader; the write goes through the
 *  engine CLI so archive mutation stays engine-owned (§4-A1). */
type MegadjCli = (args: string[]) => Promise<{ code: number; stderr: string }>;

/** Optional limit param → parsed int, or undefined when absent/invalid. */
function intParam(v: string | null): number | undefined {
  if (v === null) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

type ArchiveHandler = (
  url: URL,
  archive: ArchiveReader,
  db: DB,
  cfg: CrateConfig,
  req?: Request,
) => Response | Promise<Response>;

/** Resolve the shared set-builder query and inspect the archive exactly once.
 * JSON preview and M3U8 export use the same seam, so an export cannot drift
 * from the proposal parameters the DJ just reviewed. */
function resolveSetBuild(
  url: URL,
  archive: ArchiveReader,
):
  | { error: string }
  | {
      built: ReturnType<typeof buildMegaset>;
      census: ReturnType<ArchiveReader["setCandidates"]>;
    } {
  const parsed = parseMegasetQuery({
    preset: url.searchParams.get("preset"),
    minutes: url.searchParams.get("minutes"),
  });
  if ("error" in parsed) return parsed;

  const rawLimit = url.searchParams.get("limit");
  let limit = clampMegasetPool(null);
  if (rawLimit !== null) {
    const parsedLimit = Number(rawLimit);
    if (rawLimit.trim() === "" || !Number.isFinite(parsedLimit))
      return { error: "limit must be a finite number" };
    limit = clampMegasetPool(parsedLimit);
  }

  // #283 genre pool filter: `?genre=` narrows the candidate pool by
  // case-folded substring families (shared megasetGenreTerms — "house"
  // matches House/Tech House/Deep-house; "tropical" → the tropical-house
  // family). Absent/blank = no filter, byte-identical census. A value
  // that matches ZERO rows builds from an empty pool and reports the
  // honest empty-chain diagnosis (never a silent whole-library fallback).
  const census = archive.setCandidates(
    limit,
    url.searchParams.get("genre") ?? undefined,
  );
  return {
    census,
    built: buildMegaset({
      candidates: census.candidates,
      preset: SET_PRESETS[parsed.preset],
      minutes: parsed.minutes,
      openerId: url.searchParams.get("opener") ?? undefined,
      // S13 (#107): repeatable ?landmark=<video_id> pins — must-plays the
      // engine slots at arc-legal positions; unplaceable pins are
      // excluded + counted in landmarks_missing, never silent.
      landmarkIds: url.searchParams.getAll("landmark"),
      // A/B hook (E7): ?search=greedy|beam forces one strategy so the UI
      // compare mode can diff them on the same pool; absent = pool-size
      // rule decides. An unknown value falls back to the automatic pick
      // rather than erroring — the knob is an explore control, not a
      // contract param (unlike preset, which IS a contract and 400s).
      searchOverride: (() => {
        const raw = url.searchParams.get("search");
        return isMegasetSearchOverride(raw) ? raw : undefined;
      })(),
    }),
  };
}

/** M3U comment fields are one physical line; strip control characters rather
 * than allowing track metadata to inject playlist directives. Built from
 * code points instead of a literal control-char class (no-control-regex). */
const M3U_CONTROL_CHARS = new RegExp(
  `[${String.fromCharCode(0x00)}-${String.fromCharCode(
    0x1f,
  )}${String.fromCharCode(0x7f)}]+`,
  "g",
);
function m3uText(value: string | null, fallback: string): string {
  return (value ?? fallback).replaceAll(M3U_CONTROL_CHARS, " ").trim();
}

/** One handler per /api/archive/* route. `archiveRoutes` derives the route
 *  list from these keys — the keys ARE the route census, never a second
 *  hand-copied list (the drift that 404'd `genre-why`, found live
 *  2026-09-17). Exported for the dispatch-census test. */
export function archiveHandlers(): Record<string, ArchiveHandler> {
  return {
    search: (url, archive) => {
      const q = (url.searchParams.get("q") ?? "").trim();
      if (q.length < 2) return json({ error: "q must be ≥2 chars" }, 400);
      return json(archive.searchTracks(q));
    },
    track: (url, archive) => {
      const id = url.searchParams.get("id") ?? "";
      const t = archive.trackStats(id);
      return t ? json(t) : json({ error: "unknown video_id" }, 404);
    },
    "ingest-status": (_url, archive) => json(archive.ingestStatus()),
    // The download queue awaiting sync (the Backlog tab's pending card):
    // what sync WOULD attempt — reviewable, and skippable per-row via
    // the skip write.
    "pending-queue": (url, archive) => {
      const limit = intParam(url.searchParams.get("limit"));
      return json(archive.pendingQueue(limit ?? 200));
    },
    // POST /api/archive/skip?id=<video_id> — user-marks ONE pending row
    // as not-YouTube-music so sync's queue never picks it (Sep 19).
    // Through megadjCli (the family's CLI seam) so the ENGINE owns the
    // ledger mutation (§4-A1); kept in this map so the route census and
    // the dispatcher stay one source of truth.
    skip: async (_url, _archive, _db, _cfg, req) => {
      if (!req || req.method !== "POST")
        return json({ error: "POST required" }, 405);
      if (!archiveCli) return json({ error: "skip not available" }, 501);
      return skipRoute(_url, archiveCli);
    },
    // POST /api/archive/surfaced-note — body {id, done}: the surfaced-link
    // checklist checkbox (Sep 19). Engine-owned via `megadj surfaced-note`.
    "surfaced-note": async (_url, _archive, _db, _cfg, req) =>
      surfacedNoteRoute(req, archiveCli),
    // POST /api/archive/surfaced-batch — body {ids: string[], folder}:
    // the checklist's final button. Runs the REAL fulltags batch engine
    // (`megadj ingest <folder> --json`) so the saved files get the same
    // dated-batch intake + tags/art/dedupe chain as every other import.
    // The engine owns the ledger; this route just aims it at the folder.
    // Same allowlist as /intake/start (intakeCandidateDirs) — one folder
    // gate per enqueue seam, no weaker sibling (super-sure Sep 20).
    "surfaced-batch": async (_url, _archive, _db, cfg, req) =>
      surfacedBatchRoute(req, archiveCli, cfg),
    // Skip-reason census: why gone/skipped rows didn't land ("category:
    // …" buckets, YouTube errors) — the Pipeline tab's "what the pipeline
    // decided" card.
    "skip-census": (url, archive) => {
      const limit = intParam(url.searchParams.get("limit"));
      return json(
        limit !== undefined ? archive.skipCensus(limit) : archive.skipCensus(),
      );
    },
    // Source census: every source tag + playable split — the Sources
    // tab's diff-form suggestions.
    sources: (_url, archive) => json(archive.sourceCensus()),
    // Unified analysis coverage: playable tracks vs beats/mood/cues
    // ledgers in one read — FullTags' single progress picture.
    "analysis-coverage": (_url, archive) => json(archive.analysisCoverage()),
    lowq: (_url, archive) => json(archive.lowqQueue()),
    "source-diff": (url, archive) => {
      const a = url.searchParams.get("a");
      const b = url.searchParams.get("b");
      if (!a || !b)
        return json({ error: "a and b source names required" }, 400);
      return json(archive.sourceDiff(a, b));
    },
    // Independent beatgrid cross-check (roadmap §2/#2): beat_this
    // ledger vs RB BPM×duration. Read-only over the archive DB.
    "grid-cross-check": (url, archive) => {
      const limit = intParam(url.searchParams.get("limit"));
      return json(
        limit !== undefined
          ? archive.gridCrossCheck(limit)
          : archive.gridCrossCheck(),
      );
    },
    // Mood/dance/valence profile (roadmap #4): aggregate + extremes
    // over the mood ledger. `limit` (default 5, max 25) sizes the
    // per-dimension extremes lists.
    mood: (url, archive) => {
      const limit = intParam(url.searchParams.get("limit"));
      return json(
        limit !== undefined
          ? archive.moodProfile(limit)
          : archive.moodProfile(),
      );
    },
    // Structure cues ledger (roadmap "structure cues"): 8-bar phrase
    // markers from `megadj cues`, read-only over the archive DB.
    cues: (url, archive) => {
      const limit = intParam(url.searchParams.get("limit"));
      return json(
        limit !== undefined ? archive.cueStats(limit) : archive.cueStats(),
      );
    },
    // I49 "sounds like": cosine kNN over the embeddings ledger
    // (`megadj mood --embeddings` writes it). id required; k optional;
    // space=raw|whitened (whitened = mean-centre + all-but-the-top +
    // CSLS, the research review's retrieval corrections).
    similar: (url, archive) => {
      const id = (url.searchParams.get("id") ?? "").trim();
      if (!id) return json({ error: "id (video_id) required" }, 400);
      const k = intParam(url.searchParams.get("k"));
      const space = url.searchParams.get("space") ?? "raw";
      if (!isSimilarSpace(space))
        return json({ error: "space must be raw or whitened" }, 400);
      return json(
        k !== undefined
          ? archive.similarTracks(id, k, space)
          : archive.similarTracks(id, 10, space),
      );
    },
    // GENRE-WHY (#215): one track's #173 vote-ladder breakdown — every
    // rung's genre + weight + elected flag, re-elected through the write
    // path's exact seam (`electGenre`). The explainability read the
    // write side promised: "why Techno?" answered from the row.
    "genre-why": (url, archive) => {
      const id = (url.searchParams.get("id") ?? "").trim();
      if (!id) return json({ error: "id (video_id) required" }, 400);
      return json(archive.genreWhy(id));
    },
    // Set-builder copilot: propose an ordered mix chain from the
    // measured data (beats BPM + mood axes + file TKEY). Propose-only.
    // Params validated by the engine's parseMegasetQuery (shared with the
    // MCP tool): unknown preset → 400, never a silent peak-time fallback;
    // minutes clamp to 10–240; defaults live in shared/types.ts so every
    // surface agrees.
    megaset: (url, archive) => {
      const resolved = resolveSetBuild(url, archive);
      if ("error" in resolved) return json({ error: resolved.error }, 400);
      // A downloaded UTF-8 playlist is the safe Rekordbox bridge: import it
      // through File → Import → Playlist. This format stays read-only and
      // never opens or mutates master.db.
      if (url.searchParams.get("format") === "m3u8") {
        const byId = new Map(
          resolved.census.candidates.map((candidate) => [
            candidate.videoId,
            candidate,
          ]),
        );
        const lines = ["#EXTM3U"];
        let skippedMetadataOnly = 0;
        for (const step of resolved.built.steps) {
          const candidate = byId.get(step.videoId);
          if (!candidate?.filePath) {
            // B1 (#104): metadata-only steps have no mounted file — they
            // must NOT become dead playlist entries. Counted so the
            // export tells the truth about what it dropped.
            if (candidate?.metadataOnly) skippedMetadataOnly++;
            continue;
          }
          const duration = Math.max(0, Math.round(candidate.durationS ?? 300));
          const artist = m3uText(step.artist, "Unknown artist");
          const title = m3uText(step.title, step.videoId);
          const filePath = m3uText(candidate.filePath, "");
          if (!filePath) continue;
          // #106 Phase D: carry the derived handoff windows as comments.
          // m3u8 tolerates unknown directives; rekordbox import keeps the
          // text visible as track descriptions (positions are seconds from
          // track start — matching rekordbox's own cue unit).
          const windows = [
            step.mixInCue
              ? `mix-in @ ${Math.round(step.mixInCue.position)}s (bar ${step.mixInCue.bar})`
              : null,
            step.mixOutCue
              ? `mix-out @ ${Math.round(step.mixOutCue.position)}s (bar ${step.mixOutCue.bar})`
              : null,
          ].filter((part) => part !== null);
          lines.push(
            `#EXTINF:${duration},${artist} - ${title}`,
            ...(windows.length > 0 ? [`#EXTREM:${windows.join(" · ")}`] : []),
            filePath,
          );
        }
        if (skippedMetadataOnly > 0) {
          lines.push(
            `# megadj: ${skippedMetadataOnly} of ${resolved.built.steps.length} proposal tracks skipped — no mounted file (shelf offline; rebuild after mounting to get the full playlist)`,
          );
        }
        const actual = String(resolved.built.actualMinutes).replace(".", "-");
        return new Response(`${lines.join("\n")}\n`, {
          headers: {
            "Cache-Control": "no-store",
            "Content-Disposition": `attachment; filename="set-${resolved.built.preset}-${actual}m.m3u8"`,
            "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
          },
        });
      }
      const {
        sourceTotal,
        total,
        missingFiles,
        metadataOnly,
        duplicateFiles,
        relocatedFiles,
        rekordboxKeyHits,
        rekordboxBpmHits,
        keyReads,
        keyReadFailures,
        genreFiltered,
        freshness,
      } = resolved.census;
      const { built } = resolved;
      return json({
        available: archive.available(),
        source_total: sourceTotal,
        pool: total,
        missing_files: missingFiles,
        metadata_only: metadataOnly,
        duplicate_files: duplicateFiles,
        relocated_files: relocatedFiles,
        rekordbox_key_hits: rekordboxKeyHits,
        rekordbox_bpm_hits: rekordboxBpmHits,
        // how many files needed a live key read this request (cache
        // misses) — a slow first build is explainable, later ones are fast
        key_reads: keyReads,
        key_read_failures: keyReadFailures,
        // ledger ages (newest beats/mood analysis) — the UI staleness
        // line derives from this, never a hand-copied clock read
        freshness,
        // #283: matched-row count when a ?genre= filter ran (0 = none) —
        // the UI/CLI show it so a filtered pool is visible
        genre_filtered: genreFiltered,
        // #290: nearest known genre family when the filter matched 0
        // rows (absent otherwise) — CLI + web + MCP quote the same seam
        ...(genreFiltered === 0 &&
        (url.searchParams.get("genre") ?? "").trim() !== ""
          ? {
              genre_suggestion:
                megasetNearestGenreFamily(url.searchParams.get("genre") ?? "")
                  ?.family ?? undefined,
            }
          : {}),
        // the wire contract is the preset ID (MegasetPayload.preset: string)
        // — consumers resolve labels from the shared MEGASET_PRESET_DEFS registry
        preset: built.preset,
        minutes: built.minutes,
        actualMinutes: built.actualMinutes,
        shortfallMinutes: built.shortfallMinutes,
        complete: built.complete,
        steps: built.steps,
        // the excluded preview shares one cap with the CLI/panel
        // (MEGASET_EXCLUDED_PREVIEW_MAX); excluded_total keeps the full count
        excluded: built.excluded.slice(0, MEGASET_EXCLUDED_PREVIEW_MAX),
        // B13: reason groups derived from the FULL excluded list engine-side
        // (#291: budget-fill excluded — it is the budget_filled status)
        excluded_groups: built.excluded_groups,
        excluded_total: built.excluded.length,
        // #291: budget-fill as a STATUS, not a quality bucket
        budget_filled: built.budget_filled,
        // #283-followup: set-level quality stats (mean/lowest transition)
        avg_transition: built.avg_transition,
        min_transition: built.min_transition,
        // B6 (#107): same-artist adjacency count — the diversity report card
        same_artist_pairs: built.same_artist_pairs,
        // S13 (#107): landmark pins that could not be placed
        landmarks_missing: built.landmarks_missing,
        // which sequencer ran (beam = deep search on small pools) — the
        // UI and CLI quote this, never re-derive the threshold themselves
        search: built.search,
      });
    },
    // FullTags read side (the enrichment engine's mirror columns):
    // genre/year/artwork/energy/codec profile of the playable archive.
    library: (url, archive) => {
      const recent = intParam(url.searchParams.get("recent"));
      return json(
        recent !== undefined
          ? archive.libraryOverview(recent)
          : archive.libraryOverview(),
      );
    },
    // FullTags ↔ rekordbox tag comparison: the census (DB mirrors only,
    // cheap) and the per-track three-source read (live file truth).
    "tag-census": (url, archive) => {
      const limit = intParam(url.searchParams.get("limit"));
      return json(
        limit !== undefined ? archive.tagCensus(limit) : archive.tagCensus(),
      );
    },
    "tag-compare": (url, archive) => {
      const id = (url.searchParams.get("id") ?? "").trim();
      if (!id) return json({ error: "id (video_id) required" }, 400);
      const t = archive.trackTagCompare(id);
      return t.available ? json(t) : json({ error: "archive DB absent" }, 503);
    },
    // D30 archive-integrity sweep: blake2b the music tree vs the archive
    // DB + CrateDeck-side known-good ledger. READ-ONLY on both the tree
    // and megadj's DB (findings only); the ledger upsert is CrateDeck's
    // own db. Long enough (~15s / 88 files) that it must not block the
    // event loop — the engine hashes file-by-file with await (dynamic
    // import keeps the sweep module out of the boot path).
    sweep: (_url, archive, db, cfg) =>
      import("../megaset/sweep").then(({ sweepArchive, tracksForSweep }) =>
        sweepArchive(
          cfg.musicDir,
          tracksForSweep(archive),
          db.archiveLedger(),
          (row) => db.upsertArchiveLedger(row),
        ).then((report) => json(report)),
      ),
  };
}

export function archiveRoutes(
  route: string,
  url: URL,
  deps: ArchiveRouteDeps,
  megadjCli?: MegadjCli,
  req?: Request,
): Promise<Response | null> | Response | null {
  const { archive, db, cfg } = deps;
  archiveCli = megadjCli;
  archiveJobs = deps.jobs;
  // One source of truth: the handler map's keys ARE the route list — the
  // regex here only asserts SHAPE (`/archive/<name>`), never enumerates
  // routes. The old hand-copied route-list regex drifted the moment
  // `genre-why` was added to the map but not the list: handler present,
  // every request 404'd (found live 2026-09-17). A new route is now one
  // edit, not two; an unknown name falls through (null → upstream 404),
  // exactly as before.
  const match = /\/archive\/([a-z-]+)$/.exec(route);
  if (!match) return Promise.resolve(null);
  const handler = archiveHandlers()[match[1]!];
  if (!handler) return null;
  return Promise.resolve(handler(url, archive, db, cfg, req));
}

/** The family's CLI spawn seam — set per-dispatch (no module state) so
 *  the write handlers (skip) can reach the engine CLI while the map's
 *  signature stays compatible with every read row. */
let archiveCli: MegadjCli | undefined;
/** The optional job-engine seam (surfaced-batch enqueue), same pattern. */
let archiveJobs: ArchiveJobs | undefined;

/** POST /api/archive/skip?id=<video_id> — user-marks ONE pending row as
 *  not-YouTube-music so sync's queue never picks it (Sep 19). Through
 *  `megadj skip` (the engine's terminal skip + sticky semantics); the
 *  CLI's stdout carries the one JSON summary. */
async function skipRoute(url: URL, megadjCli: MegadjCli): Promise<Response> {
  const id = url.searchParams.get("id") ?? "";
  if (!/^[\w-]{6,24}$/.test(id)) return json({ error: "id is required" }, 400);
  const r = await megadjCli(["skip", id, "--json"]);
  if (r.code !== 0)
    return json(
      { ok: false, error: r.stderr.slice(-400) || `exit ${r.code}` },
      409,
    );
  return json({ ok: true, id });
}

/** Parse a JSON object body or return an error Response. Shared by the
 *  surfaced POST routes (module scope keeps archiveHandlers' CCN down). */
async function readJsonObject(
  req: Request | undefined,
): Promise<{ body: Record<string, unknown> } | { error: Response }> {
  if (!req || req.method !== "POST")
    return { error: json({ error: "POST required" }, 405) };
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return { error: json({ error: "JSON body required" }, 400) };
  }
  if (typeof parsed !== "object" || parsed === null)
    return { error: json({ error: "object body required" }, 400) };
  return { body: parsed as Record<string, unknown> };
}

/** POST /api/archive/surfaced-note — body {id, done}: the surfaced-link
 *  checklist checkbox. The engine (`megadj surfaced-note`) owns the flip
 *  and rejects unknown / non-surfaced ids (exit 1 → 409). */
async function surfacedNoteRoute(
  req: Request | undefined,
  megadjCli: MegadjCli | undefined,
): Promise<Response> {
  const gate = await readJsonObject(req);
  if ("error" in gate) return gate.error;
  if (!megadjCli) return json({ error: "surfaced-note not available" }, 501);
  const id = typeof gate.body.id === "string" ? gate.body.id : "";
  if (!/^[\w-]{6,24}$/.test(id)) return json({ error: "id is required" }, 400);
  const done = gate.body.done !== false;
  const args = ["surfaced-note", id, "--json"];
  if (!done) args.push("--undone");
  const r = await megadjCli(args);
  if (r.code !== 0)
    return json(
      { ok: false, error: r.stderr.slice(-400) || `exit ${r.code}` },
      409,
    );
  return json({ ok: true, id, done });
}

/** POST /api/archive/surfaced-batch — body {ids, folder}: the checklist's
 *  final button. Enqueues the REAL fulltags intake job (kind "ingest" —
 *  dated intake folder, tags, art, dedupe, live progress) and marks the
 *  checked rows done immediately (the user's act of checking means
 *  "saved the file"; the job processes whatever is in the folder). */
async function surfacedBatchRoute(
  req: Request | undefined,
  megadjCli: MegadjCli | undefined,
  cfg: CrateConfig,
): Promise<Response> {
  const gate = await readJsonObject(req);
  if ("error" in gate) return gate.error;
  if (!megadjCli) return json({ error: "surfaced-batch not available" }, 501);
  const rawFolder = gate.body.folder;
  const folder =
    typeof rawFolder === "string" && rawFolder.trim().length > 0
      ? rawFolder.trim()
      : null;
  if (!folder || !folder.startsWith("/"))
    return json({ error: "folder must be an absolute path" }, 400);
  const ids = Array.isArray(gate.body.ids)
    ? [...new Set(gate.body.ids as unknown[])].filter(
        (id: unknown): id is string => typeof id === "string",
      )
    : [];
  if (
    ids.length === 0 ||
    ids.length > 500 ||
    ids.some((id) => !/^[\w-]{6,24}$/u.test(id))
  )
    return json({ error: "ids must contain 1–500 valid surfaced ids" }, 400);
  // Job-based (Sep 19 UX pass): the ingest is a REAL job on the engine —
  // progress, cancel, SSE dock, one-at-a-time — instead of a blocking
  // CLI spawn inside the HTTP request (the 600s client deadline was a
  // symptom of that). The job's leg runs the CLI then notes the ids done.
  if (!archiveJobs)
    return json({ error: "surfaced-batch jobs not available" }, 501);
  // Allowlist parity with /intake/start (super-sure Sep 20): only folders
  // intakeCandidateDirs offers (watch folder + archive batch dirs) may
  // enqueue — the UI always posts from that census; a crafted path to
  // system dirs is refused, never ingested.
  const allowed = intakeCandidateDirs(cfg).some(
    (c) => c.path === folder && c.exists,
  );
  if (!allowed)
    return json(
      {
        error:
          "folder not on the intake allowlist — pick one from /intake/folders",
      },
      403,
    );
  const job = archiveJobs.enqueue("local-archive", "ingest", folder, "web");
  const noted = await megadjCli(["surfaced-note", ...ids, "--json"]);
  if (noted.code !== 0)
    return json(
      { ok: false, error: noted.stderr.slice(-800) || `exit ${noted.code}` },
      409,
    );
  return json({ ok: true, folder, submitted: ids.length, jobId: job.id });
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
