// megaset-cohorts-route.test.ts — rev-51: the /api/archive/megaset-cohorts
// route's CONTRACT, pinned at the handler level (no live archive DB
// needed — a stub ArchiveReader rides the deps). Pins:
//   - unknown genre family → 400 with the KNOWN list (never a silent skip)
//   - explicit-but-empty families → 400 (the silent zero-cohort run dies)
//   - bad minutes / bad limit → 400 (parseMegasetQuery + Number.isFinite)
//   - the happy path returns the per-family warmup/peak plan (snake_case
//     wire: all_complete, outside_scope, elapsed_ms)
//   - a SHORT arm is a 200 with complete:false — a result, not an error
//   - the route census (archive-dispatch-census) owns reachability; this
//     file owns semantics.
import { describe, expect, test } from "bun:test";
import { archiveHandlers } from "./routes-archive";
import type { ArchiveReader } from "../db/reader";

const handler = archiveHandlers()["megaset-cohorts"]!;

/** Minimal stub reader: typed as unknown then cast — the route only
 *  touches setCandidates on this path. Families in `shortFamilies` get
 *  a 2-row pool (cannot fill any budget) so shortfall behavior is
 *  exercisable without a live archive. */
function stubReader(shortFamilies: ReadonlySet<string> = new Set()) {
  const reader = {
    available: () => true,
    setCandidates: (_limit?: number, genre?: string) => {
      const short = genre !== undefined && shortFamilies.has(genre);
      return {
        candidates: [
          {
            videoId: `t-${genre ?? "all"}-1`,
            title: "T",
            artist: null,
            durationS: 300,
            bpm: 128,
            key: "8A",
            valence: 5,
            arousal: 5,
            dance: 0.5,
            cues: [],
            embedding: null,
            filePath: "/tmp/t.mp3",
            metadataOnly: false,
          },
        ],
        genreFiltered: short ? 2 : 500,
        total: short ? 2 : 500,
      };
    },
  };
  return reader as unknown as ArchiveReader;
}

function call(url: string, reader: ArchiveReader): Response {
  // the handler signature is (url, archive, db, cfg, req) — only the
  // first two matter on this read path
  return handler(
    new URL(url),
    reader,
    undefined as never,
    undefined as never,
    undefined,
  ) as Response;
}

describe("GET /api/archive/megaset-cohorts (rev-51)", () => {
  test("unknown family → 400 naming the bad id AND the known list", async () => {
    const res = call(
      "http://localhost/api/archive/megaset-cohorts?families=edm,bootleg-house",
      stubReader(),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("bootleg-house");
    expect(body.error).toContain("known:");
  });

  test("explicit-but-empty families → 400 (the silent zero-cohort run is retired)", async () => {
    const res = call(
      "http://localhost/api/archive/megaset-cohorts?families=%2C%2C",
      stubReader(),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("empty list");
  });

  test("non-numeric minutes → 400; limit must be finite → 400", async () => {
    const badMinutes = call(
      "http://localhost/api/archive/megaset-cohorts?minutes=abc",
      stubReader(),
    );
    expect(badMinutes.status).toBe(400);
    const badLimit = call(
      "http://localhost/api/archive/megaset-cohorts?limit=abc",
      stubReader(),
    );
    expect(badLimit.status).toBe(400);
  });

  test("happy path: per-family warmup+peak pair, snake_case wire, measured elapsed", async () => {
    const res = call(
      "http://localhost/api/archive/megaset-cohorts?families=edm&minutes=30",
      stubReader(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      command: string;
      minutes: number;
      families: string[];
      cohorts: {
        family: string;
        warmup: {
          preset: string;
          complete: boolean;
          requestedMinutes: number;
          actualMinutes: number;
          shortfallMinutes: number;
        };
        peak: { preset: string; complete: boolean };
      }[];
      all_complete: boolean;
      outside_scope: { blank_genre_note: string };
      elapsed_ms: number;
    };
    expect(body.command).toBe("megaset-cohorts");
    expect(body.minutes).toBe(30);
    expect(body.families).toEqual(["edm"]);
    expect(body.cohorts.length).toBe(1);
    expect(body.cohorts[0]!.family).toBe("edm");
    expect(body.cohorts[0]!.warmup.preset).toBe("warmup");
    expect(body.cohorts[0]!.peak.preset).toBe("peak");
    // the stub pool can't fill 30min — that's the SHORT-arm test below;
    // here we pin the WIRE SHAPE, so the echoed arithmetic
    // (actual + shortfall == requested) is the invariant that matters
    const warmup = body.cohorts[0]!.warmup;
    expect(warmup.requestedMinutes).toBe(30);
    expect(warmup.actualMinutes + warmup.shortfallMinutes).toBe(30);
    expect(body.outside_scope.blank_genre_note).toContain("outside");
    expect(typeof body.elapsed_ms).toBe("number");
  });

  test("a SHORT arm is a 200 with complete:false — a result, not an error", async () => {
    const res = call(
      "http://localhost/api/archive/megaset-cohorts?families=techno",
      stubReader(new Set(["techno"])),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      all_complete: boolean;
      cohorts: {
        family: string;
        warmup: { complete: boolean; pool: number };
      }[];
    };
    expect(body.all_complete).toBe(false);
    expect(body.cohorts[0]!.warmup.complete).toBe(false);
    expect(body.cohorts[0]!.warmup.pool).toBe(2);
  });

  // ---- rev-52: the format gate + the M3U8 session export --------------

  test("rev-52: ?format=m3u8 renders the WHOLE session as one playlist — never JSON", async () => {
    const res = call(
      "http://localhost/api/archive/megaset-cohorts?families=edm&minutes=10&format=m3u8",
      stubReader(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("mpegurl");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const text = await res.text();
    // one playlist, warmup+peak sections under the family header
    expect(text.startsWith("#EXTM3U\n")).toBe(true);
    expect(text).toContain("# --- edm · warmup");
    expect(text).toContain("# --- edm · peak");
    // the stub's mounted track appears (its stub path rides the export)
    expect(text).toContain("/tmp/t.mp3");
    // and it is NOT the JSON plan
    expect(text).not.toContain('"command"');
  });

  test("rev-52: an UNKNOWN format is a 400 — the silent JSON fall-through is retired", async () => {
    const res = call(
      "http://localhost/api/archive/megaset-cohorts?families=edm&format=pls",
      stubReader(),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("pls");
    expect(body.error).toContain("m3u8");
  });

  test("rev-52: the JSON wire strips the server-side export fields (no filePath leaks)", async () => {
    const res = call(
      "http://localhost/api/archive/megaset-cohorts?families=edm",
      stubReader(),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    // filePath + poolRows + chain never serialize — the download is the
    // one surface that legitimately carries paths
    expect(text).not.toContain("filePath");
    expect(text).not.toContain("poolRows");
    expect(text).not.toContain("chain");
    // the summary count stays
    expect(text).toContain('"steps":1');
  });
});
