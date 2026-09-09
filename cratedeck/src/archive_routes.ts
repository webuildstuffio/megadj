// archive_routes.ts — the /api/archive/* route family, extracted from
// index.ts (file-length guard). Pure reads over megadj's archive DB via
// the shared readonly ArchiveReader (§4-A1: archive mutation stays CLI —
// a bug here physically cannot corrupt archive state).
//
// index.ts calls archiveRoutes({ archive, getArchiveSweepDeps }) with the
// URL already sliced to the route part ("/archive/..."). Returns null when
// no archive route matched so index.ts can fall through.
import type { ArchiveReader } from "./archive";
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

export function archiveRoutes(
  route: string,
  url: URL,
  deps: ArchiveRouteDeps,
): Promise<Response | null> | Response | null {
  const { archive, db, cfg } = deps;
  const match =
    /\/archive\/(search|track|ingest-status|lowq|source-diff|grid-cross-check|mood|sweep|cues|library|skip-census|sources|analysis-coverage)$/.exec(
      route,
    );
  if (!match) return Promise.resolve(null);
  const sub = match[1]!;

  switch (sub) {
    case "search": {
      const q = (url.searchParams.get("q") ?? "").trim();
      if (q.length < 2)
        return Promise.resolve(json({ error: "q must be ≥2 chars" }, 400));
      return Promise.resolve(json(archive.searchTracks(q)));
    }
    case "track": {
      const id = url.searchParams.get("id") ?? "";
      const t = archive.trackStats(id);
      return Promise.resolve(
        t ? json(t) : json({ error: "unknown video_id" }, 404),
      );
    }
    case "ingest-status":
      return Promise.resolve(json(archive.ingestStatus()));
    // Skip-reason census: why gone/skipped rows didn't land ("category:
    // …" buckets, YouTube errors) — the Pipeline tab's "what the pipeline
    // decided" card.
    case "skip-census": {
      const limit = intParam(url.searchParams.get("limit"));
      return Promise.resolve(
        json(
          limit !== undefined
            ? archive.skipCensus(limit)
            : archive.skipCensus(),
        ),
      );
    }
    // Source census: every source tag + playable split — the Sources
    // tab's diff-form suggestions.
    case "sources":
      return Promise.resolve(json(archive.sourceCensus()));
    // Unified analysis coverage: playable tracks vs beats/mood/cues
    // ledgers in one read — FullTags' single progress picture.
    case "analysis-coverage":
      return Promise.resolve(json(archive.analysisCoverage()));
    case "lowq":
      return Promise.resolve(json(archive.lowqQueue()));
    case "source-diff": {
      const a = url.searchParams.get("a");
      const b = url.searchParams.get("b");
      if (!a || !b)
        return Promise.resolve(
          json({ error: "a and b source names required" }, 400),
        );
      return Promise.resolve(json(archive.sourceDiff(a, b)));
    }
    // Independent beatgrid cross-check (roadmap §2/#2): beat_this
    // ledger vs RB BPM×duration. Read-only over the archive DB.
    case "grid-cross-check": {
      const limit = intParam(url.searchParams.get("limit"));
      return Promise.resolve(
        json(
          limit !== undefined
            ? archive.gridCrossCheck(limit)
            : archive.gridCrossCheck(),
        ),
      );
    }
    // Mood/dance/valence profile (roadmap #4): aggregate + extremes
    // over the mood ledger. `limit` (default 5, max 25) sizes the
    // per-dimension extremes lists.
    case "mood": {
      const limit = intParam(url.searchParams.get("limit"));
      return Promise.resolve(
        json(
          limit !== undefined
            ? archive.moodProfile(limit)
            : archive.moodProfile(),
        ),
      );
    }
    // Structure cues ledger (roadmap "structure cues"): 8-bar phrase
    // markers from `megadj cues`, read-only over the archive DB.
    case "cues": {
      const limit = intParam(url.searchParams.get("limit"));
      return Promise.resolve(
        json(
          limit !== undefined ? archive.cueStats(limit) : archive.cueStats(),
        ),
      );
    }
    // FullTags read side (the enrichment engine's mirror columns):
    // genre/year/artwork/energy/codec profile of the playable archive.
    case "library": {
      const recent = intParam(url.searchParams.get("recent"));
      return Promise.resolve(
        json(
          recent !== undefined
            ? archive.libraryOverview(recent)
            : archive.libraryOverview(),
        ),
      );
    }
    // D30 archive-integrity sweep: blake2b the music tree vs the archive
    // DB + CrateDeck-side known-good ledger. READ-ONLY on both the tree
    // and megadj's DB (findings only); the ledger upsert is CrateDeck's
    // own db. Long enough (~15s / 88 files) that it must not block the
    // event loop — the engine hashes file-by-file with await (dynamic
    // import keeps the sweep module out of the boot path).
    case "sweep":
      return import("./archive_sweep").then(
        ({ sweepArchive, tracksForSweep }) =>
          sweepArchive(
            cfg.musicDir,
            tracksForSweep(archive),
            db.archiveLedger(),
            (row) => db.upsertArchiveLedger(row),
          ).then((report) => json(report)),
      );
    // no default: the regex above guarantees `sub` is one of the cases,
    // but the exhaustive switch keeps TS honest if a case is added there
    // without a branch here.
  }
  return null;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
