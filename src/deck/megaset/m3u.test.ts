// m3u.test.ts — rev-52: the ONE M3U8 export seam. Pins:
//   - parseFormatParam: absent/blank/json → json; m3u8 → m3u8; anything
//     else is an ERROR (the silent-JSON fall-through that shipped the
//     cohorts defect is retired on BOTH routes)
//   - m3uSetLines: the single-set rendering contract survives the seam
//     move byte-for-byte (EXTINF, control-char strip, EXTREM windows,
//     metadata-only skip + counted note)
//   - m3uCohortSessionLines: the whole plan renders as ONE playlist —
//     family/arm section headers, SHORT arms labeled, one #EXTM3U, the
//     skip note counts across ALL arms
//   - m3uResponse: one header set (mpegurl + attachment disposition)
import { describe, expect, test } from "bun:test";
import {
  m3uCandidateIndex,
  m3uCohortSessionLines,
  m3uResponse,
  m3uSetLines,
  m3uSkipNote,
  parseFormatParam,
  type M3uCandidate,
} from "./m3u";
import type { MegasetStep } from "../shared/megaset";
import type { CohortPlan } from "./cohorts";

function step(over: Partial<MegasetStep> = {}): MegasetStep {
  return {
    videoId: "t1",
    title: "Track One",
    artist: "Artist A",
    bpm: 128,
    key: "8A",
    arousal: 5,
    atMin: 5,
    transition: null,
    evidence: null,
    landmark: false,
    mixOutCue: null,
    mixInCue: null,
    ...over,
  };
}

const candidate: M3uCandidate & { videoId: string } = {
  videoId: "t1",
  filePath: "/Volumes/SHELF1/Contents/A/Track One.aiff",
  durationS: 300,
  metadataOnly: false,
};

describe("parseFormatParam (rev-52 format gate)", () => {
  test("absent/blank/json → json (the wire default)", () => {
    expect(parseFormatParam(null)).toBe("json");
    expect(parseFormatParam("")).toBe("json");
    expect(parseFormatParam("  ")).toBe("json");
    expect(parseFormatParam("json")).toBe("json");
    expect(parseFormatParam("JSON")).toBe("json");
  });

  test("m3u8 → m3u8 (case-insensitive, trimmed)", () => {
    expect(parseFormatParam("m3u8")).toBe("m3u8");
    expect(parseFormatParam(" M3U8 ")).toBe("m3u8");
  });

  test("anything else is an ERROR — never a silent JSON fall-through", () => {
    const bad = parseFormatParam("pls");
    expect(typeof bad).toBe("object");
    if (typeof bad === "object" && "error" in bad) {
      expect(bad.error).toContain("pls");
      expect(bad.error).toContain("m3u8");
    } else {
      expect.unreachable();
    }
  });
});

describe("m3uSetLines (the single-set contract, seam-moved byte-for-byte)", () => {
  test("renders EXTINF + path; strips control characters from metadata", () => {
    const index = m3uCandidateIndex([candidate]);
    const render = m3uSetLines(
      [step({ title: "Track\nOne", artist: "Artist\x1b[A" })],
      index,
    );
    // control chars (ESC, newline) collapse to spaces — a playlist line
    // can never be split or turned into a directive by track metadata
    expect(render.lines).toEqual([
      "#EXTM3U",
      "#EXTINF:300,Artist [A - Track One",
      "/Volumes/SHELF1/Contents/A/Track One.aiff",
    ]);
    expect(render.skippedMetadataOnly).toBe(0);
  });

  test("metadata-only steps are skipped and counted — no dead entries", () => {
    const index = m3uCandidateIndex([
      { videoId: "gone", filePath: null, durationS: 10, metadataOnly: true },
      candidate,
    ]);
    const render = m3uSetLines(
      [step({ videoId: "gone" }), step({ videoId: "t1" })],
      index,
    );
    expect(render.lines).toHaveLength(3);
    expect(render.skippedMetadataOnly).toBe(1);
    expect(m3uSkipNote(2, 1)).toBe(
      "# megadj: 1 of 2 proposal tracks skipped — no mounted file (shelf offline; rebuild after mounting to get the full playlist)",
    );
  });

  test("#106 handoff windows render as EXTREM comments", () => {
    const index = m3uCandidateIndex([candidate]);
    const render = m3uSetLines(
      [
        step({
          mixInCue: { bar: 25, position: 45.1 },
          mixOutCue: { bar: 57, position: 106.9 },
        }),
      ],
      index,
    );
    expect(render.lines[2]).toBe(
      "#EXTREM:mix-in @ 45s (bar 25) · mix-out @ 107s (bar 57)",
    );
  });
});

function arm(over: {
  preset: "warmup" | "peak";
  complete: boolean;
  shortfallMinutes: number;
  chain?: MegasetStep[];
}): CohortPlan["cohorts"][number]["warmup"] {
  return {
    preset: over.preset,
    actualMinutes: 30,
    requestedMinutes: 30,
    complete: over.complete,
    shortfallMinutes: over.shortfallMinutes,
    steps: (over.chain ?? []).length,
    avgTransition: null,
    minTransition: null,
    sameArtistPairs: 0,
    genreFiltered: 10,
    pool: 10,
    chain: over.chain ?? [step()],
    poolRows: [candidate],
  };
}

const plan: CohortPlan = {
  minutes: 30,
  families: ["edm", "techno"],
  cohorts: [
    {
      family: "edm",
      warmup: arm({ preset: "warmup", complete: true, shortfallMinutes: 0 }),
      peak: arm({ preset: "peak", complete: true, shortfallMinutes: 0 }),
    },
    {
      family: "techno",
      warmup: arm({
        preset: "warmup",
        complete: false,
        shortfallMinutes: 26,
      }),
      peak: arm({ preset: "peak", complete: false, shortfallMinutes: 26 }),
    },
  ],
  allComplete: false,
  blankGenreNote: "outside scope",
  elapsedMs: 5,
};

describe("m3uCohortSessionLines (the WHOLE session as ONE playlist)", () => {
  test("one #EXTM3U, per-arm section headers, tracks in plan order", () => {
    const index = m3uCandidateIndex(plan.cohorts[0]!.warmup.poolRows);
    const render = m3uCohortSessionLines(plan, index);
    // exactly ONE playlist header, first line
    expect(render.lines[0]).toBe("#EXTM3U");
    expect(render.lines.filter((l) => l === "#EXTM3U")).toHaveLength(1);
    // section headers carry family + preset + honesty flag
    expect(render.lines).toContain("# --- edm · warmup (30m) ---");
    expect(render.lines).toContain("# --- edm · peak (30m) ---");
    expect(render.lines).toContain(
      "# --- techno · warmup (30m, SHORT 26m) ---",
    );
    // every arm's track rendered (4 arms × 1 step)
    expect(
      render.lines.filter((l) => l.endsWith("Track One.aiff")),
    ).toHaveLength(4);
    // family order preserved (warmup before peak, edm before techno)
    const positions = render.lines.map((l, i) => [l, i] as const);
    const edmWarmup = positions.find(([l]) => l.includes("edm · warmup"))![1];
    const edmPeak = positions.find(([l]) => l.includes("edm · peak"))![1];
    const technoWarmup = positions.find(([l]) =>
      l.includes("techno · warmup"),
    )![1];
    expect(edmWarmup).toBeLessThan(edmPeak);
    expect(edmPeak).toBeLessThan(technoWarmup);
  });

  test("the skip note counts across ALL arms", () => {
    const gone = {
      videoId: "gone",
      filePath: null,
      durationS: 10,
      metadataOnly: true,
    };
    const shortPlan: CohortPlan = {
      ...plan,
      cohorts: [
        {
          family: "edm",
          warmup: arm({
            preset: "warmup",
            complete: true,
            shortfallMinutes: 0,
            chain: [step({ videoId: "gone" }), step()],
          }),
          peak: arm({
            preset: "peak",
            complete: true,
            shortfallMinutes: 0,
            chain: [step({ videoId: "gone" }), step()],
          }),
        },
      ],
    };
    const index = new Map([
      ["t1", candidate],
      ["gone", gone],
    ]);
    const render = m3uCohortSessionLines(shortPlan, index);
    expect(
      render.lines.some((l) =>
        l.includes("# megadj: 2 of 4 proposal tracks skipped"),
      ),
    ).toBe(true);
  });
});

test("m3uResponse: ONE header set for every export surface", () => {
  const res = m3uResponse(["#EXTM3U"], "set-x.m3u8");
  expect(res.headers.get("content-type")).toContain("mpegurl");
  expect(res.headers.get("content-disposition")).toContain("attachment");
  expect(res.headers.get("cache-control")).toBe("no-store");
});
