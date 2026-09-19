import { afterEach, describe, expect, test } from "bun:test";
import { archiveRoutes } from "../src/archive/routes";
import { archiveTools } from "../src/archive/tools";
import type { ArchiveReader } from "../src/archive";
import { isMegasetSearchOverride } from "../shared/types";
import type { CrateConfig } from "../src/config";
import type { DB } from "../src/db";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

interface MegasetTool {
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

function captureSetBuildRequest(): {
  urls: URL[];
  tool: MegasetTool;
} {
  const urls: URL[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      urls.push(new URL(String(input)));
      return Response.json({ ok: true });
    },
    { preconnect: originalFetch.preconnect },
  );
  return {
    urls,
    tool: archiveTools().megaset_propose as MegasetTool,
  };
}

describe("megaset_propose candidate-pool contract", () => {
  test("an absent limit requests the entire downloaded archive DB", async () => {
    const { urls, tool } = captureSetBuildRequest();

    await tool.run({});

    expect(urls).toHaveLength(1);
    expect(urls[0]!.pathname).toBe("/api/archive/megaset");
    expect(urls[0]!.searchParams.has("limit")).toBe(false);
  });

  test("an explicit limit remains bounded", async () => {
    const { urls, tool } = captureSetBuildRequest();

    await tool.run({ limit: 99_999 });

    expect(urls[0]!.searchParams.get("limit")).toBe("1000");
  });

  test("an explicit search override is forwarded for A/B compares", async () => {
    const { urls, tool } = captureSetBuildRequest();

    await tool.run({ search: "beam" });

    expect(urls[0]!.searchParams.get("search")).toBe("beam");
  });

  test("an unknown search value is rejected instead of silently degrading to auto", async () => {
    const { urls, tool } = captureSetBuildRequest();

    expect(tool.run({ search: "deepest" })).rejects.toThrow(
      'search must be "greedy" or "beam"',
    );
    expect(urls).toHaveLength(0);
  });

  test("an explicitly invalid limit is rejected instead of triggering a full scan", async () => {
    const { urls, tool } = captureSetBuildRequest();

    expect(tool.run({ limit: "all" })).rejects.toThrow(
      "limit must be a finite number",
    );
    expect(urls).toHaveLength(0);
  });

  test("the HTTP surface rejects an invalid limit instead of silently scanning everything", async () => {
    const response = await archiveRoutes(
      "/archive/megaset",
      new URL("http://localhost/api/archive/megaset?limit=all"),
      {
        archive: {} as ArchiveReader,
        db: {} as DB,
        cfg: {} as CrateConfig,
      },
    );

    expect(response?.status).toBe(400);
    expect(await response?.json()).toEqual({
      error: "limit must be a finite number",
    });
  });

  test("B7 (#105): a non-numeric minutes value 400s on the HTTP surface — never a silent 60", async () => {
    const response = await archiveRoutes(
      "/archive/megaset",
      new URL("http://localhost/api/archive/megaset?minutes=abc"),
      {
        archive: {} as ArchiveReader,
        db: {} as DB,
        cfg: {} as CrateConfig,
      },
    );

    expect(response?.status).toBe(400);
    expect(await response?.json()).toEqual({
      error: 'minutes must be a number (got "abc")',
    });
  });

  test("B7 (#105): a non-numeric minutes value throws RpcParamError on the MCP surface", async () => {
    const { urls, tool } = captureSetBuildRequest();

    expect(tool.run({ minutes: "abc" })).rejects.toThrow(
      'minutes must be a finite number (got "abc")',
    );
    // zero work before the failure — no API call was even attempted
    expect(urls).toHaveLength(0);
  });

  test("an unknown ?search= value falls back to the automatic pick (explore control, not a contract)", async () => {
    const filePath = "/Volumes/SHELF1/Contents/Test Artist/Test Track.aiff";
    const archive = {
      available: () => true,
      setCandidates: () => ({
        available: true,
        sourceTotal: 1,
        total: 1,
        missingFiles: 0,
        duplicateFiles: 0,
        keyReads: 0,
        keyReadFailures: 0,
        freshness: { beatsAt: null, moodAt: null },
        candidates: [
          {
            videoId: "track-1",
            title: "Test Track",
            artist: "Test Artist",
            durationS: 300,
            bpm: 128,
            key: "8A",
            valence: 5,
            arousal: 6,
            dance: 0.8,
            filePath,
          },
        ],
      }),
    } as unknown as ArchiveReader;

    const response = await archiveRoutes(
      "/archive/megaset",
      new URL("http://localhost/api/archive/megaset?search=nope"),
      {
        archive,
        db: {} as DB,
        cfg: {} as CrateConfig,
      },
    );
    // not a 400: the route degrades to auto like an absent param — the
    // contract here is the build, not the knob (one analyzed track is a
    // 1-candidate pool → the beam path picks it automatically)
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as { search?: string };
    expect(body.search).toBe("beam");
  });

  test("?search=greedy|beam are the only accepted overrides (seam predicate)", () => {
    expect(isMegasetSearchOverride("greedy")).toBe(true);
    expect(isMegasetSearchOverride("beam")).toBe(true);
    expect(isMegasetSearchOverride("auto")).toBe(false);
    expect(isMegasetSearchOverride("")).toBe(false);
    expect(isMegasetSearchOverride(null)).toBe(false);
    expect(isMegasetSearchOverride(undefined)).toBe(false);
  });

  test("the Rekordbox export surface returns an importable read-only M3U8", async () => {
    const filePath = "/Volumes/SHELF1/Contents/Test Artist/Test Track.aiff";
    const archive = {
      setCandidates: () => ({
        available: true,
        sourceTotal: 1,
        total: 1,
        missingFiles: 0,
        duplicateFiles: 0,
        keyReads: 0,
        keyReadFailures: 0,
        freshness: { beatsAt: null, moodAt: null },
        candidates: [
          {
            videoId: "track-1",
            title: "Test Track",
            artist: "Test Artist",
            durationS: 300,
            bpm: 128,
            key: "8A",
            valence: 5,
            arousal: 6,
            dance: 0.8,
            filePath,
          },
        ],
      }),
    } as unknown as ArchiveReader;

    const response = await archiveRoutes(
      "/archive/megaset",
      new URL(
        "http://localhost/api/archive/megaset?preset=warmup&minutes=10&format=m3u8",
      ),
      {
        archive,
        db: {} as DB,
        cfg: {} as CrateConfig,
      },
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("mpegurl");
    expect(response?.headers.get("content-disposition")).toContain("5m.m3u8");
    expect(await response?.text()).toBe(
      `#EXTM3U\n#EXTINF:300,Test Artist - Test Track\n${filePath}\n`,
    );
  });

  test("B1 (#104): the M3U8 export skips metadata-only steps (no dead paths) and says so", async () => {
    const filePath = "/Volumes/SHELF1/Contents/Test Artist/Test Track.aiff";
    const archive = {
      setCandidates: () => ({
        available: true,
        sourceTotal: 2,
        total: 2,
        missingFiles: 1,
        metadataOnly: 1,
        duplicateFiles: 0,
        keyReads: 0,
        keyReadFailures: 0,
        freshness: { beatsAt: null, moodAt: null },
        candidates: [
          {
            videoId: "track-1",
            title: "Test Track",
            artist: "Test Artist",
            durationS: 300,
            bpm: 128,
            key: "8A",
            valence: 5,
            arousal: 6,
            dance: 0.8,
            filePath,
            metadataOnly: false,
          },
          {
            videoId: "meta-1",
            title: "Mirror Only Track",
            artist: "Test Artist",
            durationS: null,
            bpm: 126,
            key: null,
            valence: 5,
            arousal: 6,
            dance: 0.8,
            filePath: null,
            metadataOnly: true,
          },
        ],
      }),
    } as unknown as ArchiveReader;

    const response = await archiveRoutes(
      "/archive/megaset",
      new URL(
        "http://localhost/api/archive/megaset?preset=warmup&minutes=10&format=m3u8",
      ),
      {
        archive,
        db: {} as DB,
        cfg: {} as CrateConfig,
      },
    );

    expect(response?.status).toBe(200);
    const text = await response?.text();
    // the mounted track exports with its real path…
    expect(text).toContain("#EXTINF:300,Test Artist - Test Track");
    expect(text).toContain(filePath);
    // …the metadata-only track is NOT a dead entry — it is a counted note
    expect(text).not.toContain("Mirror Only Track\n/Volumes");
    expect(text).toContain(
      "# megadj: 1 of 2 proposal tracks skipped — no mounted file",
    );
  });

  test("#106 Phase D: derived handoff windows ride the wire and render as #EXTREM comments in the M3U8", async () => {
    const filePath = "/Volumes/SHELF1/Contents/Test Artist/Test Track.aiff";
    const cueList = [
      { bar: 1, position: 0 },
      { bar: 25, position: 45.1 },
      { bar: 57, position: 106.9 },
    ];
    const archive = {
      available: () => true,
      setCandidates: () => ({
        available: true,
        sourceTotal: 1,
        total: 1,
        missingFiles: 0,
        metadataOnly: 0,
        duplicateFiles: 0,
        keyReads: 0,
        keyReadFailures: 0,
        freshness: { beatsAt: null, moodAt: null },
        candidates: [
          {
            videoId: "track-1",
            title: "Test Track",
            artist: "Test Artist",
            durationS: 150,
            bpm: 128,
            key: "8A",
            valence: 5,
            arousal: 6,
            dance: 0.8,
            filePath,
            cues: cueList,
            metadataOnly: false,
          },
        ],
      }),
    } as unknown as ArchiveReader;

    // JSON surface: the derived windows are part of the step payload
    const jsonResponse = await archiveRoutes(
      "/archive/megaset",
      new URL("http://localhost/api/archive/megaset?preset=warmup&minutes=5"),
      { archive, db: {} as DB, cfg: {} as CrateConfig },
    );
    expect(jsonResponse?.status).toBe(200);
    const body = (await jsonResponse?.json()) as {
      steps: {
        mixInCue: { bar: number; position: number } | null;
        mixOutCue: { bar: number; position: number } | null;
      }[];
    };
    // mix-in: nearest the 45 s intro target → bar 25 @ 45.1; mix-out:
    // 150 − 45 = 105 s target → bar 57 @ 106.9
    expect(body.steps[0]?.mixInCue).toEqual({ bar: 25, position: 45.1 });
    expect(body.steps[0]?.mixOutCue).toEqual({ bar: 57, position: 106.9 });

    // M3U8 surface: the same derivation renders as #EXTREM comments
    const m3u8 = await archiveRoutes(
      "/archive/megaset",
      new URL(
        "http://localhost/api/archive/megaset?preset=warmup&minutes=5&format=m3u8",
      ),
      { archive, db: {} as DB, cfg: {} as CrateConfig },
    );
    expect(m3u8?.status).toBe(200);
    const text = await m3u8?.text();
    expect(text).toContain(
      "#EXTREM:mix-in @ 45s (bar 25) · mix-out @ 107s (bar 57)",
    );
  });

  test("#106 Phase D: a track with no cue row builds with null windows (no invented bars anywhere)", async () => {
    const filePath = "/Volumes/SHELF1/Contents/Test Artist/Test Track.aiff";
    const archive = {
      available: () => true,
      setCandidates: () => ({
        available: true,
        sourceTotal: 1,
        total: 1,
        missingFiles: 0,
        metadataOnly: 0,
        duplicateFiles: 0,
        keyReads: 0,
        keyReadFailures: 0,
        freshness: { beatsAt: null, moodAt: null },
        candidates: [
          {
            videoId: "track-1",
            title: "Test Track",
            artist: "Test Artist",
            durationS: 300,
            bpm: 128,
            key: "8A",
            valence: 5,
            arousal: 6,
            dance: 0.8,
            filePath,
            cues: [],
            metadataOnly: false,
          },
        ],
      }),
    } as unknown as ArchiveReader;

    const response = await archiveRoutes(
      "/archive/megaset",
      new URL(
        "http://localhost/api/archive/megaset?preset=warmup&minutes=5&format=m3u8",
      ),
      { archive, db: {} as DB, cfg: {} as CrateConfig },
    );
    expect(response?.status).toBe(200);
    const text = await response?.text();
    // no #EXTREM line at all — absence is honest, never fabricated windows
    expect(text).not.toContain("#EXTREM");
    expect(text).toContain("#EXTINF:300,Test Artist - Test Track");
  });
});
