import { afterEach, describe, expect, test } from "bun:test";
import type { ArchiveState } from "../../archive/state";
import { genre } from "./genre";

describe("genre command JSON boundary", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  test("pre-validates every stored vector before --apply mutates a track", async () => {
    const updates: string[] = [];
    const state = {
      genreSeeds: () => ({
        seeds: [{ video_id: "seed", genre: "House", vec_json: "[1,0]" }],
        queries: [
          { video_id: "would-write", title: "First", vec_json: "[1,0]" },
          { video_id: "corrupt", title: "Second", vec_json: "not-json" },
        ],
      }),
      updateGenre: (videoId: string) => updates.push(videoId),
    } as unknown as ArchiveState;

    await expect(genre({ state, apply: true })).rejects.toThrow(
      "genre query corrupt has invalid vec_json",
    );
    expect(updates).toEqual([]);
  });

  test("rejects syntactically valid non-vector JSON with row context", async () => {
    const state = {
      genreSeeds: () => ({
        seeds: [{ video_id: "bad-seed", genre: "House", vec_json: '[1,"x"]' }],
        queries: [],
      }),
      updateGenre: () => {
        throw new Error("must not write");
      },
    } as unknown as ArchiveState;

    await expect(genre({ state, apply: true })).rejects.toThrow(
      "genre seed bad-seed has invalid vec_json: expected a non-empty array of finite numbers",
    );
  });

  test("genre --eval sets exit code 1 when agreement is below target", async () => {
    const state = {
      evalPopulation: () => [
        { video_id: "a", genre: "House", vec_json: "[1,0]", duration_s: 300 },
        { video_id: "b", genre: "House", vec_json: "[1,0]", duration_s: 300 },
        { video_id: "c", genre: "Bass", vec_json: "[0,1]", duration_s: 300 },
      ],
    } as unknown as ArchiveState;

    await genre({ state, eval: true });

    expect(process.exitCode).toBe(1);
  });

  test("genre --eval sets exit code 0 when agreement passes the gate", async () => {
    const state = {
      evalPopulation: () => [
        { video_id: "a", genre: "House", vec_json: "[1,0]", duration_s: 300 },
        { video_id: "b", genre: "House", vec_json: "[1,0]", duration_s: 300 },
        { video_id: "c", genre: "House", vec_json: "[1,0]", duration_s: 300 },
      ],
    } as unknown as ArchiveState;

    await genre({ state, eval: true });

    expect(process.exitCode).toBe(0);
  });

  test("--eval --artist-disjoint adds the artist_disjoint block", async () => {
    const state = {
      evalPopulation: () => [
        {
          video_id: "a",
          genre: "House",
          vec_json: "[1,0]",
          duration_s: 300,
          artist: "X",
        },
        {
          video_id: "b",
          genre: "House",
          vec_json: "[1,0]",
          duration_s: 300,
          artist: "Y",
        },
        {
          video_id: "c",
          genre: "House",
          vec_json: "[1,0]",
          duration_s: 300,
          artist: "Z",
        },
      ],
    } as unknown as ArchiveState;
    // capture the JSON summary via console.log interception
    const logged: string[] = [];
    const orig = console.log;
    console.log = (line: string) => logged.push(String(line));
    try {
      await genre({ state, eval: true, artistDisjoint: true });
    } finally {
      console.log = orig;
    }
    const parsed = JSON.parse(logged.at(-1)!) as Record<string, unknown>;
    expect(parsed.command).toBe("genre");
    expect(parsed.artist_disjoint).toBeDefined();
    expect((parsed.artist_disjoint as Record<string, unknown>).evaluated).toBe(
      3,
    );
  });

  test("--eval --probe adds the probe block with delta vs kNN", async () => {
    const state = {
      evalPopulation: () => [
        {
          video_id: "a",
          genre: "House",
          vec_json: "[1,0]",
          duration_s: 300,
          artist: "X",
        },
        {
          video_id: "b",
          genre: "House",
          vec_json: "[1,0]",
          duration_s: 300,
          artist: "Y",
        },
        {
          video_id: "c",
          genre: "Bass",
          vec_json: "[0,1]",
          duration_s: 300,
          artist: "Z",
        },
      ],
    } as unknown as ArchiveState;
    const logged: string[] = [];
    const orig = console.log;
    console.log = (line: string) => logged.push(String(line));
    try {
      await genre({ state, eval: true, probe: true });
    } finally {
      console.log = orig;
    }
    const parsed = JSON.parse(logged.at(-1)!) as Record<string, unknown>;
    expect(parsed.probe).toBeDefined();
    const probe = parsed.probe as Record<string, unknown>;
    expect(probe.evaluated).toBe(3);
    expect(typeof probe.accuracy).toBe("number");
    expect(typeof probe.deltaVsKnn).toBe("number");
  });

  test("--eval --diagnostics adds the Tier-0 block", async () => {
    const state = {
      evalPopulation: () => [
        {
          video_id: "a",
          genre: "House",
          vec_json: "[1,0]",
          duration_s: 300,
          artist: "X",
        },
        {
          video_id: "b",
          genre: "House",
          vec_json: "[1,0]",
          duration_s: 300,
          artist: "X",
        },
        {
          video_id: "c",
          genre: "Bass",
          vec_json: "[0,1]",
          duration_s: 300,
          artist: "Y",
        },
      ],
    } as unknown as ArchiveState;
    const logged: string[] = [];
    const orig = console.log;
    console.log = (line: string) => logged.push(String(line));
    try {
      await genre({ state, eval: true, diagnostics: true });
    } finally {
      console.log = orig;
    }
    const parsed = JSON.parse(logged.at(-1)!) as Record<string, unknown>;
    const diag = parsed.diagnostics as Record<string, unknown>;
    expect(diag).toBeDefined();
    expect(diag.labelErrors).toBeDefined();
    expect(diag.artistOverlap).toBeDefined();
    expect(diag.hubness).toBeDefined();
    expect(diag.confusion).toBeDefined();
  });

  test("--eval --refold adds the umbrella-arbitration A/B block", async () => {
    // 'Dance' rows are umbrella (abstain under the refold); 'House' rows
    // are a coherent cluster either way.
    const state = {
      evalPopulation: () => [
        {
          video_id: "a",
          genre: "House",
          vec_json: "[1,0]",
          duration_s: 300,
        },
        {
          video_id: "b",
          genre: "House",
          vec_json: "[1,0]",
          duration_s: 300,
        },
        {
          video_id: "c",
          genre: "House",
          vec_json: "[0.99,0.02]",
          duration_s: 300,
        },
        {
          video_id: "u",
          genre: "Dance",
          vec_json: "[1,0]",
          duration_s: 300,
        },
        {
          video_id: "v",
          genre: "House",
          vec_json: "[0,1]",
          duration_s: 300,
        },
      ],
    } as unknown as ArchiveState;
    const logged: string[] = [];
    const orig = console.log;
    console.log = (line: string) => logged.push(String(line));
    try {
      await genre({ state, eval: true, refold: true });
    } finally {
      console.log = orig;
    }
    const parsed = JSON.parse(logged.at(-1)!) as Record<string, unknown>;
    const rf = parsed.refold as Record<string, unknown>;
    expect(rf).toBeDefined();
    // baseline population 5; the one plain-'Dance' row abstains
    expect(rf.evaluated).toBe(4);
    expect(rf.abstained).toBe(1);
    expect(typeof rf.agreement).toBe("number");
    expect(typeof rf.deltaVsBaseline).toBe("number");
  });

  test("standalone --refold proposes canonicalizations and skips umbrella", async () => {
    const updates: { videoId: string; to: string }[] = [];
    const state = {
      labeledPopulation: () => [
        { video_id: "keep", genre: "House" },
        { video_id: "split-me", genre: "Electronic/House" },
        { video_id: "umbrella", genre: "EDM" },
        { video_id: "junk", genre: "Music" },
      ],
      updateGenre: (videoId: string, to: string) =>
        updates.push({ videoId, to }),
    } as unknown as ArchiveState;
    const logged: string[] = [];
    const orig = console.log;
    console.log = (line: string) => logged.push(String(line));
    try {
      await genre({ state, refold: true });
    } finally {
      console.log = orig;
    }
    const parsed = JSON.parse(logged.at(-1)!) as Record<string, unknown>;
    expect(parsed.mode).toBe("refold");
    expect(parsed.changes).toBe(1); // only split-me
    expect(parsed.applied).toBe(false);
    // dry run: nothing written
    expect(updates).toEqual([]);
  });

  test("umbrella rows get casing-only fixes carried, value changes refused", async () => {
    const updates: { videoId: string; to: string }[] = [];
    const state = {
      labeledPopulation: () => [
        { video_id: "lower", genre: "edm" },
        { video_id: "screaming", genre: "DANCE" },
        // a real value change: EDM → House must NEVER happen here
        { video_id: "value-ok", genre: "EDM" },
      ],
      updateGenre: (videoId: string, to: string) =>
        updates.push({ videoId, to }),
    } as unknown as ArchiveState;
    const logged: string[] = [];
    const orig = console.log;
    console.log = (line: string) => logged.push(String(line));
    try {
      await genre({ state, refold: true, apply: true });
    } finally {
      console.log = orig;
    }
    expect(updates).toEqual([
      { videoId: "lower", to: "EDM" },
      { videoId: "screaming", to: "Dance" },
    ]);
    const parsed = JSON.parse(logged.at(-1)!) as Record<string, unknown>;
    expect(parsed.umbrellaKept).toBe(0);
    expect(parsed.changes).toBe(2);
  });

  test("umbrella SPLIT outcomes are canonicalized (case-twin leak, super-sure)", async () => {
    const updates: { videoId: string; to: string }[] = [];
    const state = {
      labeledPopulation: () => [
        // both tokens umbrella → resolves to bare "Dance"; the SPLIT is
        // still canonicalization and must write (case-twin pair killed)
        { video_id: "twin-a", genre: "Dance/electronic" },
        { video_id: "twin-b", genre: "Dance/Electronic" },
        // bare umbrella, no split, already-casing-canonical → kept honest
        { video_id: "plain", genre: "Dance" },
      ],
      updateGenre: (videoId: string, to: string) =>
        updates.push({ videoId, to }),
    } as unknown as ArchiveState;
    const logged: string[] = [];
    const orig = console.log;
    console.log = (line: string) => logged.push(String(line));
    try {
      await genre({ state, refold: true, apply: true });
    } finally {
      console.log = orig;
    }
    expect(updates).toEqual([
      { videoId: "twin-a", to: "Dance" },
      { videoId: "twin-b", to: "Dance" },
    ]);
    const parsed = JSON.parse(logged.at(-1)!) as Record<string, unknown>;
    // bare "Dance" hits the label===input branch first (already canonical)
    expect(parsed.umbrellaKept).toBe(0);
    expect(parsed.alreadyCanonical).toBe(1);
  });

  test("--flag dry run writes nothing; --apply sets disputed + clears healthy", async () => {
    const flags = new Map<string, string | null>();
    // coherent house cluster + one mislabeled EDM row in it: its 3 house
    // neighbours vote unanimously → disputed. k=2 keeps the vote small:
    // the EDM row's 2 nearest are both house (agreement 1.0).
    const state = {
      evalPopulation: () => [
        {
          video_id: "bad",
          genre: "EDM",
          vec_json: "[1,0]",
          duration_s: 300,
        },
        {
          video_id: "h1",
          genre: "House",
          vec_json: "[1,0.01]",
          duration_s: 300,
        },
        {
          video_id: "h2",
          genre: "House",
          vec_json: "[1,0.02]",
          duration_s: 300,
        },
        {
          video_id: "h3",
          genre: "House",
          vec_json: "[0.99,0.03]",
          duration_s: 300,
        },
        // far corner: split neighbourhood, no quorum
        {
          video_id: "mixed",
          genre: "Bass",
          vec_json: "[0,1]",
          duration_s: 300,
        },
        {
          video_id: "mixed2",
          genre: "Techno",
          vec_json: "[0,0.9]",
          duration_s: 300,
        },
      ],
      setGenreFlag: (videoId: string, flag: "disputed" | null) =>
        flags.set(videoId, flag),
    } as unknown as ArchiveState;

    // dry: nothing written
    const logged: string[] = [];
    const orig = console.log;
    console.log = (line: string) => logged.push(String(line));
    try {
      await genre({ state, flag: true, k: 2 });
    } finally {
      console.log = orig;
    }
    expect(flags.size).toBe(0);
    let parsed = JSON.parse(logged.at(-1)!) as Record<string, unknown>;
    expect(parsed.mode).toBe("flag");
    expect(parsed.disputed).toBe(1);
    expect(parsed.applied).toBe(false);

    // apply: bad → disputed, the rest → cleared (null)
    console.log = (line: string) => logged.push(String(line));
    try {
      await genre({ state, flag: true, apply: true, k: 2 });
    } finally {
      console.log = orig;
    }
    parsed = JSON.parse(logged.at(-1)!) as Record<string, unknown>;
    expect(parsed.applied).toBe(true);
    expect(flags.get("bad")).toBe("disputed");
    expect(flags.get("h1")).toBeNull();
    expect(flags.get("h2")).toBeNull();
    expect(flags.get("h3")).toBeNull();
    expect(flags.get("mixed")).toBeNull();
    expect(flags.get("mixed2")).toBeNull();
  });

  test("--refold and --flag are mutually exclusive (exit 2, zero work)", async () => {
    const state = {
      evalPopulation: () => [],
      updateGenre: () => {
        throw new Error("must not write");
      },
    } as unknown as ArchiveState;
    await genre({ state, refold: true, flag: true });
    expect(process.exitCode).toBe(2);
  });

  test("--eval --refold gates on the ARBITRATION readout (post-refold semantics)", async () => {
    // baseline arm: 2/4 gated agreement (50%) — would fail a baseline gate.
    // arbitration arm: umbrella rows out, remaining population agrees.
    const state = {
      evalPopulation: () => [
        { video_id: "a", genre: "House", vec_json: "[1,0]", duration_s: 300 },
        { video_id: "b", genre: "House", vec_json: "[1,0]", duration_s: 300 },
        {
          video_id: "c",
          genre: "House",
          vec_json: "[0.99,0.02]",
          duration_s: 300,
        },
        {
          video_id: "u",
          genre: "Dance",
          vec_json: "[0,1]",
          duration_s: 300,
        },
        {
          video_id: "v",
          genre: "House",
          vec_json: "[0,1]",
          duration_s: 300,
        },
      ],
    } as unknown as ArchiveState;
    const logged: string[] = [];
    const orig = console.log;
    console.log = (line: string) => logged.push(String(line));
    try {
      await genre({ state, eval: true, refold: true });
    } finally {
      console.log = orig;
    }
    const parsed = JSON.parse(logged.at(-1)!) as Record<string, unknown>;
    const rf = parsed.refold as Record<string, unknown>;
    // the arbitration arm must clear the bar even when the baseline cannot
    expect(rf.agreement).toBeGreaterThanOrEqual(0.65);
    expect(parsed.pass).toBe(true);
    expect(process.exitCode).toBe(0);
  });

  test("standalone --refold --apply writes only changed rows", async () => {
    const updates: { videoId: string; to: string }[] = [];
    const state = {
      labeledPopulation: () => [
        { video_id: "split-me", genre: "R&B/Soul" },
        { video_id: "umbrella", genre: "edm" },
      ],
      updateGenre: (videoId: string, to: string) =>
        updates.push({ videoId, to }),
    } as unknown as ArchiveState;
    const orig = console.log;
    console.log = () => {};
    try {
      await genre({ state, refold: true, apply: true });
    } finally {
      console.log = orig;
    }
    // the umbrella row gets only its CASING carried ("edm" → "EDM"):
    // display hygiene, not a genre rewrite — the label value is preserved
    expect(updates).toEqual([
      { videoId: "split-me", to: "R&B" },
      { videoId: "umbrella", to: "EDM" },
    ]);
  });
});
