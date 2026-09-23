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
import { buildCohortPlan, parseCohortFamilies } from "../megaset/cohorts";
import {
  m3uCandidateIndex,
  m3uCohortSessionLines,
  m3uResponse,
  m3uSetLines,
  m3uSkipNote,
  parseFormatParam,
} from "../megaset/m3u";
import {
  buildMegasetPayload,
  clampMegasetPool,
  isMegasetSearchOverride,
  megasetNearestGenreFamily,
} from "../shared/megaset";
import { isSimilarSpace } from "../../shared/leaf/vector-space";
import { intakeCandidateDirs } from "../jobs/intake-run";
import { cliOk } from "../hygiene/routes";
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
      census: Omit<ReturnType<ArchiveReader["setCandidates"]>, "stagesMs"> & {
        /** engine is ALWAYS set here — resolveSetBuild times the build
         *  and sums it in before returning (non-optional on the wire). */
        stagesMs: {
          sql: number;
          fileCheck: number;
          keyFills: number;
          engine: number;
        };
      };
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
  // #286: the engine stage is timed here (the caller's job) and summed
  // into the census's stagesMs on the wire.
  const engineT0 = Date.now();
  const built = buildMegaset({
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
  });
  const engineMs = Date.now() - engineT0;
  return {
    census: { ...census, stagesMs: { ...census.stagesMs, engine: engineMs } },
    built,
  };
}

/** M3U comment fields are one physical line; strip control characters rather
 * than allowing track metadata to inject playlist directives. BUILT ONCE in
 * megaset/m3u.ts (rev-52): the route renders every playlist through that
 * seam — never a route-local twin. */

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
      // rev-52 format gate: `?format=` is a CONTRACT param — m3u8
      // renders the Rekordbox playlist (a downloaded UTF-8 file is the
      // safe bridge: import through File → Import → Playlist; read-only,
      // never opens master.db), absent/blank/json is the wire default,
      // and ANYTHING ELSE is a 400 — never the silent JSON fall-through
      // that made a requested file look like success (the exact defect
      // class that shipped on /megaset-cohorts).
      const format = parseFormatParam(url.searchParams.get("format"));
      if (typeof format === "object" && "error" in format)
        return json({ error: format.error }, 400);
      if (format === "m3u8") {
        // through the ONE seam (megaset/m3u.ts) — the same renderer the
        // cohorts export uses, never a route-local twin
        const index = m3uCandidateIndex(resolved.census.candidates);
        const render = m3uSetLines(resolved.built.steps, index);
        const lines = [...render.lines];
        if (render.skippedMetadataOnly > 0) {
          // B1 (#104): metadata-only steps are counted, never dead entries
          lines.push(
            m3uSkipNote(
              resolved.built.steps.length,
              render.skippedMetadataOnly,
            ),
          );
        }
        const actual = String(resolved.built.actualMinutes).replace(".", "-");
        return m3uResponse(
          lines,
          `set-${resolved.built.preset}-${actual}m.m3u8`,
        );
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
        stagesMs,
      } = resolved.census;
      const { built } = resolved;
      return json(
        buildMegasetPayload({
          built,
          available: archive.available(),
          census: {
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
            stagesMs,
          },
          ...(genreFiltered === 0 &&
          (url.searchParams.get("genre") ?? "").trim() !== ""
            ? {
                genreSuggestion:
                  megasetNearestGenreFamily(url.searchParams.get("genre") ?? "")
                    ?.family ?? undefined,
              }
            : {}),
        }),
      );
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
    // #295: the genre-cohort PLAN — warmup + peak chain per genre family
    // in ONE request, over the SAME census+engine as /megaset (the
    // surface-neutral cohorts engine). Propose-only. Families validated
    // by the shared parse (unknown id → 400 with the known list); an arm
    // that falls short keeps `complete: false` + shortfall on the wire
    // (200 — a short plan is a RESULT, not a request error).
    "megaset-cohorts": (url, archive) => {
      // rev-52 format gate FIRST (before any build work): m3u8 → the
      // whole session as ONE importable playlist (per-family sections,
      // SHORT arms labeled — the export never dresses up a shortfall);
      // absent/blank/json → the plan wire; anything else → 400. The old
      // shape silently IGNORED ?format=m3u8 and returned JSON — a query
      // param a route never reads is a lie, not a default.
      const format = parseFormatParam(url.searchParams.get("format"));
      if (typeof format === "object" && "error" in format)
        return json({ error: format.error }, 400);
      const parsedQ = parseMegasetQuery({
        preset: "peak",
        minutes: url.searchParams.get("minutes"),
      });
      if ("error" in parsedQ) return json({ error: parsedQ.error }, 400);
      const limitParam = url.searchParams.get("limit");
      let limit: number | undefined = undefined;
      if (limitParam !== null) {
        const parsedLimit = Number(limitParam);
        if (limitParam.trim() === "" || !Number.isFinite(parsedLimit))
          return json({ error: "limit must be a finite number" }, 400);
        // reuse the SINGLE parsed conversion — the raw Number() below was
        // a second, unguarded site of the same parse (number-census)
        limit = parsedLimit;
      }
      const families = parseCohortFamilies(url.searchParams.get("families"));
      if ("error" in families) return json({ error: families.error }, 400);
      const plan = buildCohortPlan(archive, {
        minutes: parsedQ.minutes,
        families: families.families,
        limit,
      });
      if (format === "m3u8") {
        // union every arm's census rows into ONE path index (same family
        // shares the pool today, but stay correct for any future per-arm
        // divergence — a missing path still skips honestly)
        const index = new Map<
          string,
          (typeof plan)["cohorts"][number]["warmup"]["poolRows"][number]
        >();
        for (const row of plan.cohorts) {
          for (const arm of [row.warmup, row.peak]) {
            for (const c of arm.poolRows) index.set(c.videoId, c);
          }
        }
        const render = m3uCohortSessionLines(plan, index);
        return m3uResponse(
          render.lines,
          `cohort-session-${plan.minutes}m-${plan.cohorts.length}x.m3u8`,
        );
      }
      // the JSON wire strips the server-side export fields (chain +
      // poolRows never serialize: filePath stays server-side by
      // contract; `steps` stays a COUNT on the wire)
      return json({
        command: "megaset-cohorts" as const,
        minutes: plan.minutes,
        families: plan.families,
        cohorts: plan.cohorts.map((row) => ({
          family: row.family,
          warmup: cohortArmWire(row.warmup),
          peak: cohortArmWire(row.peak),
        })),
        all_complete: plan.allComplete,
        outside_scope: {
          blank_genre_note: plan.blankGenreNote,
        },
        // measured wall-clock for the whole plan (the caller's timing,
        // never a fixed schedule — same honesty as /megaset's stages_ms)
        elapsed_ms: plan.elapsedMs,
      });
    },
  };
}

/** The wire arm for /megaset-cohorts: summary counts only — chain +
 *  poolRows are the server-side export fields and never serialize. */
function cohortArmWire(
  arm: ReturnType<typeof buildCohortPlan>["cohorts"][number]["warmup"],
) {
  return {
    preset: arm.preset,
    actualMinutes: arm.actualMinutes,
    requestedMinutes: arm.requestedMinutes,
    complete: arm.complete,
    shortfallMinutes: arm.shortfallMinutes,
    steps: arm.steps,
    avgTransition: arm.avgTransition,
    minTransition: arm.minTransition,
    sameArtistPairs: arm.sameArtistPairs,
    genreFiltered: arm.genreFiltered,
    pool: arm.pool,
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
  const res = await cliOk(megadjCli, json, ["skip", id, "--json"]);
  // the skip wire contract carries the id back (the UI's row update reads it)
  return json({ ...(await res.json()), id });
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
  const res = await cliOk(megadjCli, json, args);
  return json({ ...(await res.json()), id, done });
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
