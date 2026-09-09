// archive_tools.ts — the O82b archive half of the MCP surface.
//
// Extracted from mcp.ts (file-length guard): every archive_* tool is a
// thin read over the server's /api/archive/* routes (which open megadj's
// archive DB readonly — a bug here cannot corrupt archive state).

import { apiGet } from "./deckapi";
import { str, num, optLimit, optNum, RpcParamError } from "./mcp_params";

/** The archive_* tool table (O82b, readonly reads over megadj's DB). */
export function archiveTools(): Record<string, unknown> {
  return {
    archive_search_tracks: {
      description:
        "Search megadj's downloaded archive by artist/title/album/file path (case-insensitive substring, min 2 chars). Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string", description: "search text (≥2 chars)" },
          limit: {
            type: "number",
            description: "max rows (default 50, max 200)",
          },
        },
        required: ["q"],
        additionalProperties: false,
      },
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
      inputSchema: {
        type: "object",
        properties: { video_id: { type: "string" } },
        required: ["video_id"],
        additionalProperties: false,
      },
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
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      run: async () =>
        apiGet("/api/archive/ingest-status").then((r) => r.json()),
    },

    archive_lowq_queue: {
      description:
        "D24 low-quality upgrade queue: downloaded tracks below the set-ready bitrate floor (lossy <256 kbps AAC or <320 kbps MP3), worst first. Read-only.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      run: async () => apiGet("/api/archive/lowq").then((r) => r.json()),
    },

    archive_skip_census: {
      description:
        "[READ-ONLY] Why non-downloaded archive rows didn't land: buckets every gone/skipped track by its recorded reason (YouTube 'video unavailable', ingest 'category: …' skips, etc.). gone= actionables (re-source or drop); skipped= deliberate not-music skips. Answers 'what does the pipeline decide about my liked list'.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "max buckets per kind (default 12, max 50)",
          },
        },
        additionalProperties: false,
      },
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
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      run: async () => apiGet("/api/archive/sources").then((r) => r.json()),
    },

    archive_analysis_coverage: {
      description:
        "[READ-ONLY] Analysis coverage in one read: how many downloaded tracks exist vs how many carry beats / mood / cues ledger rows. null = that ledger doesn't exist yet (pre-analysis DB). The 'is the whole archive analyzed' gate for agents deciding whether to run megadj beats|mood|cues.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      run: async () =>
        apiGet("/api/archive/analysis-coverage").then((r) => r.json()),
    },

    archive_source_diff: {
      description:
        "Diff two archive sources (e.g. 'liked' vs 'PLxxxx…'): video ids only in one of them, and the shared count. Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          a: { type: "string", description: "first source tag" },
          b: { type: "string", description: "second source tag" },
        },
        required: ["a", "b"],
        additionalProperties: false,
      },
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
        "[READ-ONLY] Independent beatgrid cross-check: beat_this beat arrays (megadj beats ledger) vs each track's rekordbox BPM × duration. Returns ok/off/octave verdicts and offender lists — 'off' = grid tempo >2% from RB, 'octave' = grid locked half/double tempo. Empty ledgered=0 means run `megadj beats` first.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "max tracks to check (default 200, max 500)",
          },
        },
        additionalProperties: false,
      },
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
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "extremes per axis, high+low each (default 5, max 25)",
          },
        },
        additionalProperties: false,
      },
      run: async (args: Record<string, unknown>) => {
        const res = await apiGet(
          `/api/archive/mood?limit=${optLimit(args, 5, 25)}`,
        );
        return res.json();
      },
    },

    archive_similar_tracks: {
      description:
        "[READ-ONLY] I49 'sounds like': k nearest neighbours of one track by cosine similarity over megadj's embeddings ledger (effnet 1280-d audio embeddings written by `megadj mood --embeddings`). corpus=0 means no embeddings yet — run `megadj mood --embeddings` first.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "video_id of the query track" },
          k: {
            type: "number",
            description: "neighbours to return (default 10, max 50)",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
      run: async (args: Record<string, unknown>) => {
        const id = str(args, "id");
        if (!id) throw new RpcParamError("id is required");
        const res = await apiGet(
          `/api/archive/similar?id=${encodeURIComponent(id)}&k=${optNum(args, "k", 10, 50)}`,
        );
        return res.json();
      },
    },

    archive_set_build: {
      description:
        "[READ-ONLY, PROPOSES ONLY] M66 set-builder copilot: proposes an ordered mix chain from the archive's measured data — beats-ledger BPM (±6% mixability window), file TKEY (Camelot wheel), mood-ledger arousal/dance shaped into an energy-arc preset (warmup/peak/afterhours). Writes nothing — proposals to accept into a playlist by hand. pool=0 means run `megadj beats` + `megadj mood` first.",
      inputSchema: {
        type: "object",
        properties: {
          preset: {
            type: "string",
            enum: ["warmup", "peak", "afterhours"],
            description: "energy-arc preset (default peak)",
          },
          minutes: {
            type: "number",
            description: "target set length in minutes (default 60, 10–240)",
          },
          opener: {
            type: "string",
            description: "optional video_id to force as the first track",
          },
          limit: {
            type: "number",
            description: "candidate pool cap (default 300, max 1000)",
          },
        },
        additionalProperties: false,
      },
      run: async (args: Record<string, unknown>) => {
        const preset = str(args, "preset") ?? "peak";
        const q = new URLSearchParams({ preset });
        const minutes = num(args, "minutes");
        if (minutes !== undefined)
          q.set("minutes", String(Math.floor(minutes)));
        const opener = str(args, "opener");
        if (opener) q.set("opener", opener);
        const res = await apiGet(
          `/api/archive/setbuild?${q.toString()}&limit=${optLimit(args, 300, 1000)}`,
        );
        return res.json();
      },
    },

    archive_cue_ledger: {
      description:
        "[READ-ONLY] Structure-cues ledger (roadmap 'structure cues'): 8-bar DJ phrase markers per track, derived from the beats ledger's downbeats by `megadj cues`. Returns per-track cue counts + the freshest tracks' first-cue positions. analyzed=0 means run `megadj cues` first.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "max tracks to list (default 40, max 200)",
          },
        },
        additionalProperties: false,
      },
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
      inputSchema: {
        type: "object",
        properties: {
          recent: {
            type: "number",
            description:
              "recently-updated tracks to list (default 12, max 100)",
          },
        },
        additionalProperties: false,
      },
      run: async (args: Record<string, unknown>) => {
        const res = await apiGet(
          `/api/archive/library?recent=${optLimit(args, 12, 100)}`,
        );
        return res.json();
      },
    },

    archive_sweep: {
      description:
        "[READ-ONLY] D30 archive-integrity sweep: blake2b-hash every downloaded archive file and compare against known-good hashes + the archive DB — reports bitrot, silent truncation, and missing files BEFORE they reach a drive. First run baselines; findings start on the second. ~15s on the real archive.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      run: async () => apiGet("/api/archive/sweep").then((r) => r.json()),
    },
  };
}
