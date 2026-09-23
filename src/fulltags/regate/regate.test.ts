// regate-genre.test.ts — #169: `megadj regate genre` runs the SAME LOO
// harness `genre --eval` runs (no second eval implementation) against the
// ≥65% ship gate, and `regate effnet` honestly reports unavailable until
// its reference ledger exists (never a manufactured pass).
import { describe, expect, test } from "bun:test";
import {
  GENRE_GATE_PERCENT,
  genreEvalSeeds,
  regate,
  regateEffnet,
  regateGenre,
} from "./regate";
import type { ArchiveState } from "../../core/state";

/** Minimal ArchiveState double: only evalPopulation() is read. */
function stateWith(
  rows: {
    video_id: string;
    genre: string;
    duration_s: number | null;
    artist: string | null;
    vec_json: string;
  }[],
): ArchiveState {
  return {
    evalPopulation: () => rows,
  } as unknown as ArchiveState;
}

const vec = (seed: number, dims = 4): string =>
  JSON.stringify(
    Array.from({ length: dims }, (_, i) =>
      Math.sin(seed * 0.7 + i) >= 0 ? 0.5 + seed * 0.01 : -0.5,
    ),
  );

describe("regate genre (#169)", () => {
  test("gate constant is the tier-0 arbitration bar", () => {
    expect(GENRE_GATE_PERCENT).toBe(65);
  });

  test("unavailable when the ledger has no family-evaluable embeddings — exit-ok honest gap", () => {
    const empty = regateGenre(stateWith([]));
    expect(empty.unavailable).toBe(true);
    expect(empty.measured).toBeNull();
    expect(empty.gate).toBeNull();
    expect(empty.ok).toBe(true); // honest gap is exit 0, not a FAIL
    expect(empty.reason).toContain("no genre-labeled embeddings");
    // junk labels with no scoring family count as unevaluable, not measurable
    const junkOnly = regateGenre(
      stateWith([
        {
          video_id: "a",
          genre: "dj tools",
          duration_s: 200,
          artist: null,
          vec_json: vec(1),
        },
      ]),
    );
    expect(junkOnly.unavailable).toBe(true);
  });

  test("measures through the shared LOO harness when the population exists", () => {
    // four distinct families, tight same-family clusters → high agreement
    const rows = [
      { genre: "House", seed: 1 },
      { genre: "Tech House", seed: 1.2 },
      { genre: "Techno", seed: 2 },
      { genre: "Peak Techno", seed: 2.2 },
      { genre: "Trance", seed: 3 },
      { genre: "Uplifting Trance", seed: 3.2 },
      { genre: "Drum & Bass", seed: 4 },
      { genre: "Jungle", seed: 4.2 },
    ].map((r, i) => ({
      video_id: `t${i}`,
      genre: r.genre,
      duration_s: 200,
      artist: null,
      vec_json: vec(r.seed),
    }));
    const r = regateGenre(stateWith(rows));
    expect(r.unavailable).toBe(false);
    expect(r.measured).not.toBeNull();
    expect(r.evaluated).toBeGreaterThan(0);
    expect(r.gate).not.toBeNull();
    expect(r.gate?.requiredPercent).toBe(65);
    expect(r.gate?.dimension).toBe("genre");
    expect(r.ok).toBe(r.gate?.passed ?? false);
  });

  test("duration guard rides the same harness rule (out-of-band rows drop)", () => {
    const rows = [
      {
        video_id: "in",
        genre: "House",
        duration_s: 200,
        artist: null,
        vec_json: vec(1),
      },
      {
        video_id: "ad",
        genre: "Techno",
        duration_s: 5,
        artist: null,
        vec_json: vec(9),
      },
    ];
    const seeds = genreEvalSeeds(stateWith(rows));
    // both rows enter the seed list; the harness's band drops the ad
    expect(seeds.seeds).toHaveLength(2);
    expect(seeds.durations.find((d) => d.videoId === "ad")?.durationS).toBe(5);
  });
});

describe("regate effnet (#169)", () => {
  test("honestly unavailable — never a manufactured pass", () => {
    const r = regateEffnet();
    expect(r.unavailable).toBe(true);
    expect(r.measured).toBeNull();
    expect(r.gate).toBeNull();
    expect(r.ok).toBe(true); // exit 0 with the reason, per the roadmap rule
    expect(r.reason).toContain("effnet reference ledger");
    expect(r.reason).toContain("not populated");
  });
});

describe("regate() envelope parity — consumers never branch on dimension", () => {
  test("genre result carries the same top-level keys as bpm", () => {
    const report = regate(stateWith([]), "genre");
    expect(report.command).toBe("regate");
    expect(report.detector).toBe("ledger");
    expect(report.gate.passPercent).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.unavailable).toBe(true);
    expect(report.error).toContain("no genre-labeled embeddings");
  });

  test("effnet result reports unavailable with its reason", () => {
    const report = regate(stateWith([]), "effnet");
    expect(report.unavailable).toBe(true);
    expect(report.ok).toBe(true);
    expect(report.error).toContain("effnet reference ledger");
  });

  test("unknown dimension still errors loudly (unchanged contract)", () => {
    const report = regate(stateWith([]), "key");
    expect(report.ok).toBe(false);
    expect(report.error).toContain("unknown re-gate dimension");
  });
});
