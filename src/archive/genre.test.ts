// genre.test.ts — embedding-kNN genre inference (the "ID3 genre is
// unreliable" answer): family collapse, unusable-seed filtering, split-
// vote honesty, and determinism. Pure-engine coverage; the DB round-trip
// (embeddings ledger) is similar.test.ts's job.
import { describe, expect, test } from "bun:test";
import {
  genreFamily,
  inferGenre,
  normalizeGenre,
  type GenreSeed,
} from "./similar";

const seed = (id: string, genre: string, v: number[]): GenreSeed => ({
  videoId: id,
  genre,
  vec: v,
});

describe("normalizeGenre", () => {
  test("lowercases, takes the first comma token, strips parentheticals", () => {
    expect(normalizeGenre("Deep House")).toBe("deep house");
    expect(normalizeGenre("Progressive House, EDM, Big Room")).toBe(
      "progressive house",
    );
    expect(normalizeGenre("Melodic Techno (Peak Time)")).toBe("melodic techno");
  });
  test("junk labels are unusable (null), never vote", () => {
    expect(normalizeGenre("Music")).toBeNull();
    expect(normalizeGenre("unknown")).toBeNull();
    expect(normalizeGenre("fixme")).toBeNull();
    expect(normalizeGenre("")).toBeNull();
    expect(normalizeGenre("  ")).toBeNull();
  });
});

describe("genreFamily", () => {
  test("sub-genres collapse to the family the embedding space clusters", () => {
    expect(genreFamily("Deep House")).toBe("house");
    expect(genreFamily("progressive house")).toBe("house");
    expect(genreFamily("Nu-Disco")).toBe("house");
    expect(genreFamily("UK Garage")).toBe("house");
    expect(genreFamily("Melodic Techno")).toBe("techno");
    expect(genreFamily("drum and bass")).toBe("bass");
    expect(genreFamily("Dubstep")).toBe("bass");
    expect(genreFamily("Bass House")).toBe("bass"); // bass-music usage, pre-house
    expect(genreFamily("Hip-Hop")).toBe("hiphop");
    expect(genreFamily("Big Room")).toBe("edm");
    expect(genreFamily("Synthpop")).toBe("pop");
    expect(genreFamily("Amapiano")).toBe("groove");
  });
  test("junk and off-genre labels never vote (null)", () => {
    expect(genreFamily("Music")).toBeNull();
    expect(genreFamily("Comedy")).toBeNull();
    expect(genreFamily("Audiobook")).toBeNull();
  });
  test("families are mutually exclusive — no label matches two regexes", () => {
    // every label here resolves via the FIRST matching family regex; the
    // guard asserts no LATER regex also claims it (future edits adding
    // overlapping patterns like /bass/ after /house/ would fail here).
    // "bass house" style ambiguities are resolved by table ORDER, so the
    // label list only contains first-match-unambiguous labels.
    for (const label of [
      "house",
      "deep house",
      "disco",
      "garage",
      "techno",
      "melodic techno",
      "trance",
      "psytrance",
      "hip hop",
      "hip-hop",
      "trap",
      "edm",
      "bass",
      "dubstep",
      "drum and bass",
      "jungle",
      "pop",
      "rock",
      "indie",
      "r&b",
      "funk",
      "soul",
      "amapiano",
      "dancehall",
      "ambient",
      "jazz",
      "lofi",
    ]) {
      const fam = genreFamily(label);
      expect(fam).not.toBeNull();
      for (const [re, other] of [
        [
          /drum ?and ?bass|jungle|breakbeat|breaks|bass|dubstep|footwork|juke/,
          "bass",
        ],
        [/(?<!bass |afro )house|disco|garage|boogie/, "house"],
        [/techno|melodic/, "techno"],
        [/trance|psy/, "trance"],
        [/hip ?[- ]?hop|rap|trap/, "hiphop"],
        [/edm|electro|big ?room|future (?!bass)|hardstyle|bounce/, "edm"],
        [/pop|rock|indie|alternative|punk|metal|folk|singer/, "pop"],
        [
          /r ?& ?b|soul|funk|amapiano|afrobeat|afro ?house|reggaeton|latin|dancehall|reggae/,
          "groove",
        ],
        [
          /jazz|blues|ambient|downtempo|lofi|lo ?fi|classical|soundtrack/,
          "mood",
        ],
      ] as [RegExp, string][]) {
        if (other === fam) continue;
        expect(re.test(label)).toBe(false);
      }
    }
  });
});

describe("inferGenre (pure kNN vote)", () => {
  const houseVec = [1, 0, 0];
  const technoVec = [0, 1, 0];
  const seeds: GenreSeed[] = [
    seed("a", "Deep House", [0.98, 0.05, 0]),
    seed("b", "house", [0.96, 0.1, 0]),
    seed("c", "Nu-Disco", [0.94, 0.12, 0.02]),
    seed("d", "Melodic Techno", [0.05, 0.97, 0.1]),
    seed("e", "techno", [0.1, 0.95, 0.05]),
    seed("f", "Hip-Hop", [0, 0.1, 0.98]),
    seed("g", "Music", [0.99, 0, 0]), // junk label — never votes
  ];

  test("a clean neighbourhood decides (house cluster)", () => {
    const v = inferGenre(seeds, houseVec, 5, 0.6);
    expect(v.inferred).toBe("house");
    expect(v.agreement).toBeGreaterThanOrEqual(0.6);
  });

  test("sub-genre labels collapse before voting (deep house → house)", () => {
    const v = inferGenre(seeds, [1, 0.02, 0], 3, 0.6);
    expect(v.genre).toBe("house");
  });

  test("a split neighbourhood stays honest (null, not a guess)", () => {
    // 2 house + 2 techno + 1 hiphop nearest → no 60% majority anywhere
    const mixed: GenreSeed[] = [
      seed("a", "house", [0.9, 0.1, 0]),
      seed("b", "deep house", [0.85, 0.2, 0]),
      seed("c", "techno", [0.15, 0.9, 0]),
      seed("d", "melodic techno", [0.2, 0.85, 0.05]),
      seed("e", "Hip-Hop", [0, 0.15, 0.9]),
    ];
    const v = inferGenre(mixed, [0.45, 0.45, 0.3], 5, 0.6);
    expect(v.inferred).toBeNull();
    // the winning family is still reported (transparency)
    expect(v.genre.length).toBeGreaterThan(0);
  });

  test("junk seed labels are excluded from the vote entirely", () => {
    // only the junk seed is near this vector — nothing usable votes
    const v = inferGenre([seed("g", "Music", [1, 0, 0])], houseVec);
    expect(v.inferred).toBeNull();
  });

  test("deterministic: same input → same vote", () => {
    const a = inferGenre(seeds, technoVec);
    const b = inferGenre(seeds, technoVec);
    expect(a).toEqual(b);
  });

  test("empty seeds / zero vector degrade to undecided, never throw", () => {
    expect(inferGenre([], houseVec).inferred).toBeNull();
    expect(inferGenre(seeds, [], 5).inferred).toBeNull();
  });
});
