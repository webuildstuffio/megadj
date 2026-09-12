// archive_routes.ts — the /api/archive/* route family, extracted from
// index.ts (file-length guard). Pure reads over megadj's archive DB via
// the shared readonly ArchiveReader (§4-A1: archive mutation stays CLI —
// a bug here physically cannot corrupt archive state).
//
// index.ts calls archiveRoutes({ archive, getArchiveSweepDeps }) with the
// URL already sliced to the route part ("/archive/..."). Returns null when
// no archive route matched so index.ts can fall through.
import type { ArchiveReader } from "./archive";
import { SET_PRESETS, buildSet, parseSetbuildQuery } from "./setbuild";
import { clampSetPool } from "../shared/setbuild";
import type { DB } from "./db";
import type { CrateConfig } from "./config";

export interface ArchiveRouteDeps {
  archive: ArchiveReader;
  db: DB;
  cfg: CrateConfig;
}

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
      built: ReturnType<typeof buildSet>;
      census: ReturnType<ArchiveReader["setCandidates"]>;
    } {
  const parsed = parseSetbuildQuery({
    preset: url.searchParams.get("preset"),
    minutes: url.searchParams.get("minutes"),
  });
  if ("error" in parsed) return parsed;

  const rawLimit = url.searchParams.get("limit");
  let limit = clampSetPool(null);
  if (rawLimit !== null) {
    const parsedLimit = Number(rawLimit);
    if (rawLimit.trim() === "" || !Number.isFinite(parsedLimit))
      return { error: "limit must be a finite number" };
    limit = clampSetPool(parsedLimit);
  }

  const census = archive.setCandidates(limit);
  return {
    census,
    built: buildSet({
      candidates: census.candidates,
      preset: SET_PRESETS[parsed.preset],
      minutes: parsed.minutes,
      openerId: url.searchParams.get("opener") ?? undefined,
    }),
  };
}

/** M3U comment fields are one physical line; strip control characters rather
 * than allowing track metadata to inject playlist directives. Built from
 * code points instead of a literal control-char class (no-control-regex). */
const M3U_CONTROL_CHARS = new RegExp(
  "[" +
    String.fromCharCode(0x00) +
    "-" +
    String.fromCharCode(0x1f) +
    String.fromCharCode(0x7f) +
    "]+",
  "g",
);
function m3uText(value: string | null, fallback: string): string {
  return (value ?? fallback).replaceAll(M3U_CONTROL_CHARS, " ").trim();
}

/** One handler per /api/archive/* route. The regex dispatch above guarantees
 *  `sub` is a key here; each handler stays single-purpose and testable. */
function archiveHandlers(): Record<string, ArchiveHandler> {
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
    // (`megadj mood --embeddings` writes it). id required; k optional.
    similar: (url, archive) => {
      const id = (url.searchParams.get("id") ?? "").trim();
      if (!id) return json({ error: "id (video_id) required" }, 400);
      const k = intParam(url.searchParams.get("k"));
      return json(
        k !== undefined
          ? archive.similarTracks(id, k)
          : archive.similarTracks(id),
      );
    },
    // M66 set-builder copilot: propose an ordered mix chain from the
    // measured data (beats BPM + mood axes + file TKEY). Propose-only.
    // Params validated by the engine's parseSetbuildQuery (shared with the
    // MCP tool): unknown preset → 400, never a silent peak-time fallback;
    // minutes clamp to 10–240; defaults live in shared/types.ts so every
    // surface agrees.
    setbuild: (url, archive) => {
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
        for (const step of resolved.built.steps) {
          const candidate = byId.get(step.videoId);
          if (!candidate?.filePath) continue;
          const duration = Math.max(0, Math.round(candidate.durationS ?? 300));
          const artist = m3uText(step.artist, "Unknown artist");
          const title = m3uText(step.title, step.videoId);
          const filePath = m3uText(candidate.filePath, "");
          if (!filePath) continue;
          lines.push(`#EXTINF:${duration},${artist} - ${title}`, filePath);
        }
        const actual = String(resolved.built.actualMinutes).replace(".", "-");
        return new Response(`${lines.join("\n")}\n`, {
          headers: {
            "Cache-Control": "no-store",
            "Content-Disposition": `attachment; filename="fulltags-${resolved.built.preset}-${actual}m.m3u8"`,
            "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
          },
        });
      }
      const {
        sourceTotal,
        total,
        missingFiles,
        duplicateFiles,
        relocatedFiles,
        keyReads,
        keyReadFailures,
        freshness,
      } = resolved.census;
      const { built } = resolved;
      return json({
        available: archive.available(),
        source_total: sourceTotal,
        pool: total,
        missing_files: missingFiles,
        duplicate_files: duplicateFiles,
        relocated_files: relocatedFiles,
        // how many files needed a live key read this request (cache
        // misses) — a slow first build is explainable, later ones are fast
        key_reads: keyReads,
        key_read_failures: keyReadFailures,
        // ledger ages (newest beats/mood analysis) — the UI staleness
        // line derives from this, never a hand-copied clock read
        freshness,
        // the wire contract is the preset ID (SetBuildPayload.preset: string)
        // — consumers resolve labels from the shared SET_PRESET_DEFS registry
        preset: built.preset,
        minutes: built.minutes,
        actualMinutes: built.actualMinutes,
        shortfallMinutes: built.shortfallMinutes,
        complete: built.complete,
        steps: built.steps,
        excluded: built.excluded.slice(0, 40),
        excluded_total: built.excluded.length,
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
    // D30 archive-integrity sweep: blake2b the music tree vs the archive
    // DB + CrateDeck-side known-good ledger. READ-ONLY on both the tree
    // and megadj's DB (findings only); the ledger upsert is CrateDeck's
    // own db. Long enough (~15s / 88 files) that it must not block the
    // event loop — the engine hashes file-by-file with await (dynamic
    // import keeps the sweep module out of the boot path).
    sweep: (_url, archive, db, cfg) =>
      import("./archive_sweep").then(({ sweepArchive, tracksForSweep }) =>
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
): Promise<Response | null> | Response | null {
  const { archive, db, cfg } = deps;
  const match =
    /\/archive\/(search|track|ingest-status|lowq|source-diff|grid-cross-check|mood|similar|setbuild|sweep|cues|library|skip-census|sources|analysis-coverage)$/.exec(
      route,
    );
  if (!match) return Promise.resolve(null);
  const sub = match[1]!;
  const handlers = archiveHandlers();
  const handler = handlers[sub];
  if (!handler) return null; // regex and map can never disagree; TS-narrowed anyway
  return Promise.resolve(handler(url, archive, db, cfg));
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
