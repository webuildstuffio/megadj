// report/tools.ts — the O82b archive half of the MCP surface.
//
// Extracted from mcp.ts (file-length guard): every archive_* tool is a
// thin read over the server's /api/archive/* routes (which open megadj's
// archive DB readonly — a bug here cannot corrupt archive state).
// Schemas are built with the mcp_params helpers (obj/noArgs/s/n) instead
// of hand-written JSON-Schema boilerplate.

import { apiGet } from "../deckapi";
import type { ToolDef } from "../mcp/server";
import { parseMegasetQuery } from "../megaset/engine";
import {
  clampMegasetPool,
  isMegasetSearchOverride,
  MEGASET_BEAM_POOL_MAX,
  MEGASET_PRESET_IDS,
  MEGASET_POOL_MAX,
} from "../shared/types";
import {
  str,
  num,
  optLimit,
  optNum,
  RpcParamError,
  obj,
  noArgs,
  s,
  sArr,
  n,
} from "../mcp/params";
import { isSimilarSpace } from "../../shared/leaf/vector-space";

/** The archive_* + megaset/getdat-adjacent tool table (O82b: readonly
 *  reads over megadj's DB through the server's /api/archive/* routes).
 *  Typed as ToolDef so mcp.ts's TOOLS spread inherits the exact contract
 *  instead of `Record<string, unknown>` — a tool added here without a
 *  description/schema/run is a compile error, not a runtime surprise. */
export function archiveTools(): Record<string, ToolDef> {
  return {
    archive_search_tracks: {
      description:
        "Search megadj's downloaded archive by artist/title/album/file path (case-insensitive substring, min 2 chars). Read-only.",
      inputSchema: obj(
        {
          q: s("search text (≥2 chars)"),
          limit: n("max rows (default 50, max 200)"),
        },
        ["q"],
      ),
      run: async (args: Record<string, unknown>) => {
        const q = str(args, "q");
        if (!q || q.trim().length < 2)
          throw new RpcParamError("q must be at least 2 characters");
        const res = await apiGet(
          `/api/archive/search?q=${encodeURIComponent(q)}&limit=${num(args, "limit") ?? 50}`,
        );
        return res.json();
      },
    },

    archive_track_stats: {
      description:
        "Full archive row for one track by video id: status, bitrate/codec, genre, energy, file path, timestamps. Read-only.",
      inputSchema: obj({ video_id: s("") }, ["video_id"]),
      run: async (args: Record<string, unknown>) => {
        const id = str(args, "video_id");
        if (!id) throw new RpcParamError("video_id is required");
        const res = await apiGet(
          `/api/archive/track?id=${encodeURIComponent(id)}`,
        );
        if (res.status === 404)
          throw new RpcParamError(`no archive track with video_id ${id}`);
        return res.json();
      },
    },

    archive_ingest_status: {
      description:
        "Ingest pipeline health: per-status track counts, last 5 sync runs (downloaded/failed/gone), 10 most recently updated tracks. Answers 'what did I ingest lately'. Read-only.",
      inputSchema: noArgs(),
      run: async () =>
        apiGet("/api/archive/ingest-status").then((r) => r.json()),
    },

    archive_lowq_queue: {
      description:
        "D24 low-quality upgrade queue: downloaded tracks below the set-ready bitrate floor (lossy <256 kbps AAC or <320 kbps MP3), worst first. Read-only.",
      inputSchema: noArgs(),
      run: async () => apiGet("/api/archive/lowq").then((r) => r.json()),
    },

    archive_skip_census: {
      description:
        "[READ-ONLY] Why non-downloaded archive rows didn't land: buckets every gone/skipped track by its recorded reason (YouTube 'video unavailable', ingest 'category: …' skips, etc.). gone= actionables (re-source or drop); skipped= deliberate not-music skips. Answers 'what does the pipeline decide about my liked list'.",
      inputSchema: obj({
        limit: n("max buckets per kind (default 12, max 50)"),
      }),
      run: async (args: Record<string, unknown>) => {
        const res = await apiGet(
          `/api/archive/skip-census?limit=${optLimit(args, 12, 50)}`,
        );
        return res.json();
      },
    },

    archive_sources: {
      description:
        "[READ-ONLY] Source census of the archive: every source tag (liked list, playlist ids, 'ingest') with total and playable track counts — what exists before diffing two sources. Pair with archive_source_diff.",
      inputSchema: noArgs(),
      run: async () => apiGet("/api/archive/sources").then((r) => r.json()),
    },

    archive_analysis_coverage: {
      description:
        "[READ-ONLY] Analysis coverage in one read: how many downloaded tracks exist vs how many carry beats / mood / cues ledger rows. null = that ledger doesn't exist yet (pre-analysis DB). The 'is the whole archive analyzed' gate for agents deciding whether to run megadj beats|mood|cues.",
      inputSchema: noArgs(),
      run: async () =>
        apiGet("/api/archive/analysis-coverage").then((r) => r.json()),
    },

    archive_source_diff: {
      description:
        "Diff two archive sources (e.g. 'liked' vs 'PLxxxx…'): video ids only in one of them, and the shared count. Read-only.",
      inputSchema: obj(
        { a: s("first source tag"), b: s("second source tag") },
        ["a", "b"],
      ),
      run: async (args: Record<string, unknown>) => {
        const a = str(args, "a");
        const b = str(args, "b");
        if (!a || !b)
          throw new RpcParamError("a and b source tags are required");
        const res = await apiGet(
          `/api/archive/source-diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
        );
        return res.json();
      },
    },

    archive_grid_cross_check: {
      description:
        "[READ-ONLY] Independent beatgrid cross-check: beat_this beat arrays (megadj beats ledger) fitted to a constant tempo and compared against each track's rekordbox BPM. Returns ok/off/octave/drift verdicts and offender lists — 'off' = grid tempo >2% from RB, 'octave' = grid locked half/double tempo, 'drift' = grid slides >15 ms positionally across the track (wrong tempo — the class count-based checks can't see). Empty ledgered=0 means run `megadj beats` first.",
      inputSchema: obj({
        limit: n("max tracks to check (default 200, max 500)"),
      }),
      run: async (args: Record<string, unknown>) => {
        const res = await apiGet(
          `/api/archive/grid-cross-check?limit=${optLimit(args, 200, 500)}`,
        );
        return res.json();
      },
    },

    archive_mood_profile: {
      description:
        "[READ-ONLY] Mood / dance / valence profile of the archive (roadmap #4): ledger averages (danceability, valence, arousal, party, electronic, aggressive) + the highest/lowest tracks per axis — 'play me something dark/hyped/smooth' picker data from megadj's mood ledger (TXXX:MOOD mirror). analyzed=0 means run `megadj mood` first.",
      inputSchema: obj({
        limit: n("extremes per axis, high+low each (default 5, max 25)"),
      }),
      run: async (args: Record<string, unknown>) => {
        const res = await apiGet(
          `/api/archive/mood?limit=${optLimit(args, 5, 25)}`,
        );
        return res.json();
      },
    },

    archive_similar_tracks: {
      description:
        "[READ-ONLY] I49 'sounds like': k nearest neighbours of one track by cosine similarity over megadj's embeddings ledger (effnet 1280-d audio embeddings written by `megadj mood --embeddings`). space=whitened applies the research review's retrieval corrections (mean-centre + all-but-the-top + CSLS). corpus=0 means no embeddings yet — run `megadj mood --embeddings` first.",
      inputSchema: obj(
        {
          id: s("video_id of the query track"),
          k: n("neighbours to return (default 10, max 50)"),
          space: s("ranking space: raw (default) or whitened (CSLS-corrected)"),
        },
        ["id"],
      ),
      run: async (args: Record<string, unknown>) => {
        const id = str(args, "id");
        if (!id) throw new RpcParamError("id is required");
        const space = args.space === undefined ? "raw" : String(args.space);
        if (!isSimilarSpace(space))
          throw new RpcParamError("space must be raw or whitened");
        const res = await apiGet(
          `/api/archive/similar?id=${encodeURIComponent(id)}&k=${optNum(args, "k", 10, 50)}&space=${space}`,
        );
        return res.json();
      },
    },

    megaset_propose: {
      description:
        "[READ-ONLY, PROPOSES ONLY] Set builder copilot: audits every downloaded archive row, resolves moved DJ-Imports paths on the mounted shelf, collapses physical-file aliases, then proposes an ordered mix chain. It prefers FullTags beat/mood/key ledgers, fills missing BPM/key from the current Rekordbox master mirror, and reads a file key only when neither source knows it. Rows whose file is missing but that carry measured tempo are admitted metadata-only (metadata_only count; the shelf being offline no longer zeroes the pool). Tempo uses a ±6% mixability window; Camelot and mood shape the selected energy arc. Each step carries mixInCue/mixOutCue: the 8-bar phrase boundary (from the structure-cues ledger) nearest the intro/outro handoff window — null when the track has no cue row. Each transitioned step also carries an evidence breakdown (#284): tempo/key/arcFit/anchor/similarity contributions (weight-scaled), their total, and a halftime flag when the hop used the B8 half/double-time lane. excluded_groups carries only genuine quality reasons; budget-fill is the budget_filled status count (#291). Writes nothing. Inspect requested/actual minutes, completion/shortfall, source_total, pool, missing_files, metadata_only, duplicate_files, relocated_files, excluded_groups, budget_filled, per-step cue windows + scoring evidence, source-hit/key-read diagnostics, stages_ms (#286 measured per-phase timings: sql/fileCheck/keyFills/engine), and freshness to explain the result.",
      inputSchema: obj({
        preset: {
          type: "string",
          enum: MEGASET_PRESET_IDS,
          description: "energy-arc preset (default peak)",
        },
        minutes: n("target set length in minutes (default 60, 10–240)"),
        opener: s("optional video_id to force as the first track"),
        limit: n(
          `optional candidate pool cap; omitted scans the whole downloaded archive DB (max ${MEGASET_POOL_MAX})`,
        ),
        search: {
          type: "string",
          enum: ["greedy", "beam"],
          description: `force a sequencer strategy (A/B compare); omitted = automatic (pools under ${MEGASET_BEAM_POOL_MAX} run the deep 'beam' search, larger keep greedy)`,
        },
        landmarks: sArr(
          "#107 landmark must-plays (video_ids) — the engine slots each pin into the chain at an arc-legal position; unplaceable pins are excluded + listed in landmarks_missing, never silently dropped",
        ),
        genre: s(
          "#283 genre pool filter — narrows candidates by case-folded substring family ('house' matches House/Tech House/Deep-house, 'tropical' → tropical house). Omitted = whole downloaded library",
        ),
      }),
      run: async (args: Record<string, unknown>) => {
        // same validation as the HTTP route (parseMegasetQuery): unknown
        // preset → RpcParamError, never a silent peak-time fallback.
        // B7 (#105): a PRESENT-but-non-numeric minutes errors too — the
        // schema types minutes as a JSON number, so a string/NaN value
        // is a caller bug, not an omission (absent still defaults 60).
        if (args.minutes !== undefined && num(args, "minutes") === undefined)
          throw new RpcParamError(
            `minutes must be a finite number (got ${JSON.stringify(args.minutes)})`,
          );
        const parsed = parseMegasetQuery({
          preset: str(args, "preset") ?? null,
          minutes: num(args, "minutes") ?? null,
        });
        if ("error" in parsed) throw new RpcParamError(parsed.error);
        const q = new URLSearchParams({ preset: parsed.preset });
        q.set("minutes", String(parsed.minutes));
        const opener = str(args, "opener");
        if (opener) q.set("opener", opener);
        // validate locally like limit: an unknown search value 400s here
        // instead of silently degrading to the automatic pick mid-compare
        const searchRaw = str(args, "search");
        if (searchRaw !== undefined) {
          if (!isMegasetSearchOverride(searchRaw))
            throw new RpcParamError('search must be "greedy" or "beam"');
          q.set("search", searchRaw);
        }
        // #283 genre filter: pass-through; the route's shared family
        // matcher validates semantics (unknown families match literally —
        // an empty pool + honest diagnosis, never a silent whole-library
        // fallback)
        const genre = str(args, "genre");
        if (genre !== undefined) q.set("genre", genre);
        // S13 (#107): landmark pins → repeatable ?landmark= params (the
        // route reads getAll, so order is preserved request-first)
        const landmarks = args.landmarks;
        if (landmarks !== undefined) {
          if (!Array.isArray(landmarks))
            throw new RpcParamError("landmarks must be an array of video_ids");
          for (const id of landmarks as unknown[]) {
            if (typeof id !== "string" || id.trim() === "")
              throw new RpcParamError(
                "landmarks must be an array of video_id strings",
              );
            q.append("landmark", id.trim());
          }
        }
        const rawLimit = args.limit;
        if (rawLimit !== undefined) {
          const parsedLimit = num(args, "limit");
          if (parsedLimit === undefined)
            throw new RpcParamError("limit must be a finite number");
          q.set("limit", String(clampMegasetPool(parsedLimit)));
        }
        const res = await apiGet(`/api/archive/megaset?${q.toString()}`);
        return res.json();
      },
    },

    archive_cue_ledger: {
      description:
        "[READ-ONLY] Structure-cues ledger (roadmap 'structure cues'): 8-bar DJ phrase markers per track, derived from the beats ledger's downbeats by `megadj cues`. Returns per-track cue counts + the freshest tracks' first-cue positions. analyzed=0 means run `megadj cues` first.",
      inputSchema: obj({
        limit: n("max tracks to list (default 40, max 200)"),
      }),
      run: async (args: Record<string, unknown>) => {
        const res = await apiGet(
          `/api/archive/cues?limit=${optLimit(args, 40, 200)}`,
        );
        return res.json();
      },
    },

    archive_library_overview: {
      description:
        "[READ-ONLY] FullTags read side — what the enrichment engine has stamped across the playable archive: genre distribution, year coverage, energy stamps, artwork provenance (which art-ladder rung each track's cover came from), codec/size profile, and the freshest tag updates. Read-only mirror of the file tags; run `megadj fetch` / `megadj enrich` to fill gaps this shows.",
      inputSchema: obj({
        recent: n("recently-updated tracks to list (default 12, max 100)"),
      }),
      run: async (args: Record<string, unknown>) => {
        const res = await apiGet(
          `/api/archive/library?recent=${optLimit(args, 12, 100)}`,
        );
        return res.json();
      },
    },

    archive_tag_census: {
      description:
        "[READ-ONLY] FullTags ↔ rekordbox tag census: every playable track's DB mirrors compared (archive tracks.genre/track_keys/beats vs the rb-adopt rekordbox_content mirror — genre, key, BPM, title, artist, year, label). Returns per-track difference lists + per-field disagreement counts, worst first. Pure DB — files are NOT read on this path (per-file ground truth lives in archive_tag_compare). rekordboxMirror:false means `megadj rb-adopt` never ran.",
      inputSchema: obj({
        limit: n(
          "rows to return (default 200; census totals are always full-population)",
        ),
      }),
      run: async (args: Record<string, unknown>) => {
        const res = await apiGet(
          `/api/archive/tag-census?limit=${optLimit(args, 200, 2000)}`,
        );
        return res.json();
      },
    },

    archive_tag_compare: {
      description:
        "[READ-ONLY] One track, three sources side by side: the physical FILE's live tags (ffprobe+mutagen ground truth), the archive DB mirror (FullTags genre/genre_flag/energy + beats BPM + mood), and the rekordbox mirror row (rb-adopt payload: Title/ArtistName/GenreName/KeyName/BPM/ReleaseYear/LabelName/Commnt + the lossless metadata dict). Returns each source's values plus a precomputed differences table. The per-track ground-truth read is the expensive twin of the census — call this for the ONE track you're auditing.",
      inputSchema: obj({
        id: s("video_id of the track (archive_search_tracks finds them)"),
      }),
      run: async (args: Record<string, unknown>) => {
        const id = typeof args["id"] === "string" ? args["id"].trim() : "";
        if (!id) throw new RpcParamError("id (video_id) is required");
        const res = await apiGet(
          `/api/archive/tag-compare?id=${encodeURIComponent(id)}`,
        );
        return res.json();
      },
    },

    archive_sweep: {
      description:
        "[READ-ONLY] D30 archive-integrity sweep: blake2b-hash every downloaded archive file and compare against known-good hashes + the archive DB — reports bitrot, silent truncation, and missing files BEFORE they reach a drive. First run baselines; findings start on the second. ~15s on the real archive.",
      inputSchema: noArgs(),
      run: async () => apiGet("/api/archive/sweep").then((r) => r.json()),
    },

    archive_genre_why: {
      description:
        "[READ-ONLY] #215 explainability read: one track's #173 weighted genre vote-ladder breakdown. Every rung's claim (rung, genre, weight, elected flag, provenance detail) is returned, re-elected through the SAME seam the write path used (`electGenre`) so the replay always matches the stored genre — plus matches_db drift detection, and an honest voted:false empty-state for never-voted tracks. Answers 'why Techno?' from the row, not from code.",
      inputSchema: obj({
        id: s("video_id of the track (archive_search_tracks finds them)"),
      }),
      run: async (args: Record<string, unknown>) => {
        const id = typeof args["id"] === "string" ? args["id"].trim() : "";
        if (!id) throw new RpcParamError("id (video_id) is required");
        const res = await apiGet(
          `/api/archive/genre-why?id=${encodeURIComponent(id)}`,
        );
        return res.json();
      },
    },
  };
}
