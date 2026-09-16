import { describe, expect, test } from "bun:test";
import { refoldDetail, refoldLabel, scoringFamily } from "./genre-refold";
import {
  familyOf as genreFamily,
  isUmbrellaLabel,
  repairEscapes,
} from "../../fulltags/src/exports";

describe("repairEscapes", () => {
  test("decodes \\uXXXX artifacts", () => {
    expect(repairEscapes("Hip-hop \\u0026 rap")).toBe("Hip-hop & rap");
    expect(repairEscapes("r\\u0026b")).toBe("r&b");
  });

  test("leaves clean strings untouched", () => {
    expect(repairEscapes("Deep House")).toBe("Deep House");
  });
});

describe("refoldLabel (data half)", () => {
  test("title-cases lowercase labels", () => {
    expect(refoldLabel("house")).toBe("House");
    expect(refoldLabel("deep house")).toBe("Deep House");
    expect(refoldLabel("afro house")).toBe("Afro House");
  });

  test("splits multi-label strings and picks the primary", () => {
    expect(refoldLabel("Electronic/House")).toBe("House"); // umbrella loses
    expect(refoldLabel("Tech House/Tribal")).toBe("Tech House");
    expect(refoldLabel("Dance / Electro Pop")).toBe("Electro Pop");
    expect(refoldLabel("Hip Hop/Rap")).toBe("Hip-Hop");
  });

  test("specific labels outrank umbrella parents in splits", () => {
    expect(refoldLabel("Electronic/Techno")).toBe("Techno");
    expect(refoldLabel("Electronic/Tech House")).toBe("Tech House");
    // both tokens umbrella → the stored first token stays (deterministic)
    expect(refoldLabel("Dance & EDM")).toBe("Dance");
  });

  test("protects established &-compounds from splitting", () => {
    expect(refoldLabel("R&B")).toBe("R&B");
    expect(refoldLabel("R&B/Soul")).toBe("R&B");
    expect(refoldLabel("Drum & Bass")).toBe("Drum & Bass");
    expect(refoldLabel("Melodic House & Techno")).toBe(
      "Melodic House & Techno",
    );
    expect(refoldLabel("Hip-Hop & Rap")).toBe("Hip-Hop & Rap");
  });

  test("repairs escape artifacts during the split", () => {
    expect(refoldLabel("Hip-hop \\u0026 rap")).toBe("Hip-Hop & Rap");
  });

  test("strips parenthetical qualifiers before splitting", () => {
    expect(refoldLabel("Techno (Peak Time / Driving)")).toBe("Techno");
    expect(scoringFamily("Techno (Peak Time / Driving)")).toBe("techno");
  });

  test("collapses measured spelling variants", () => {
    expect(refoldLabel("hiphop")).toBe("Hip-Hop");
    expect(refoldLabel("nu disco")).toBe("Nu-Disco");
    expect(refoldLabel("Nu-Disco")).toBe("Nu-Disco");
  });

  test("ampersand in title-case fallbacks stays glued (never 'R&b'/'R & B')", () => {
    expect(refoldLabel("r&b soul")).toBe("R&B Soul");
    expect(refoldLabel("R&B Soul")).toBe("R&B Soul");
  });

  test("refuses junk: empty, placeholder, URL spam, word soup", () => {
    expect(refoldLabel("")).toBeNull();
    expect(refoldLabel("Music")).toBeNull();
    expect(refoldLabel("unknown")).toBeNull();
    expect(refoldLabel("fixme")).toBeNull();
    expect(refoldLabel("https://djsoundtop.com")).toBeNull();
    expect(refoldLabel("djsoundtop.com Top 100")).toBeNull();
    expect(
      refoldLabel("House electronic swedish european edm trance"),
    ).toBeNull();
    expect(
      refoldLabel(
        "Electronic uk garage edm future garage dance garage stutter house downtempo",
      ),
    ).toBeNull();
  });

  test("idempotent: canonical input is label-stable", () => {
    const once = refoldLabel("Deep House/Indie Dance/Nu Disco");
    expect(once).toBe("Deep House");
    // pass 2 on the output: same label, no split, no escapes
    const again = refoldDetail(once!);
    expect(again.label).toBe(once);
    expect(again.split).toBe(false);
    expect(again.escaped).toBe(false);
  });
});

describe("isUmbrellaLabel", () => {
  test("matches the measured parent-only labels", () => {
    expect(isUmbrellaLabel("EDM")).toBe(true);
    expect(isUmbrellaLabel("edm")).toBe(true);
    expect(isUmbrellaLabel("Dance")).toBe(true);
    expect(isUmbrellaLabel("Electronic")).toBe(true);
    expect(isUmbrellaLabel("Mainstage EDM")).toBe(true);
  });

  test("does NOT match sub-genres or hard-EDM (they keep families)", () => {
    expect(isUmbrellaLabel("House")).toBe(false);
    expect(isUmbrellaLabel("Tech House")).toBe(false);
    expect(isUmbrellaLabel("Hardtekk")).toBe(false);
    expect(isUmbrellaLabel("Big Room")).toBe(false);
    expect(isUmbrellaLabel("Nightcore")).toBe(false);
    expect(isUmbrellaLabel("Eurodance")).toBe(false);
  });
});

describe("scoringFamily (scoring half)", () => {
  test("plain umbrella labels abstain (null)", () => {
    expect(scoringFamily("EDM")).toBeNull();
    expect(scoringFamily("edm")).toBeNull();
    expect(scoringFamily("Dance")).toBeNull();
    expect(scoringFamily("Dance & EDM")).toBeNull();
    expect(scoringFamily("Electronic")).toBeNull();
    expect(scoringFamily("Mainstage EDM")).toBeNull();
  });

  test("hard-EDM and sub-genres keep their pinned families", () => {
    expect(scoringFamily("Eurodance")).toBe("edm");
    expect(scoringFamily("Nightcore")).toBe("edm");
    expect(scoringFamily("Big Room")).toBe("edm"); // pinned 'big ?room' regex
    expect(scoringFamily("Hardtekk")).toBe("techno");
    expect(scoringFamily("Deep House")).toBe("house");
    expect(scoringFamily("Melodic House & Techno")).toBe("house");
    expect(scoringFamily("Drum & Bass")).toBe("bass");
  });

  test("agrees with genreFamily everywhere the refold is a no-op", () => {
    for (const label of [
      "House",
      "Techno",
      "Trance",
      "Deep House",
      "Bass",
      "Hip-Hop",
      "Pop",
      "R&B",
      "Jazz",
      "Disco",
      "Dubstep",
      "Amapiano",
    ]) {
      expect(scoringFamily(label)).toBe(genreFamily(label));
    }
  });

  test("junk rows abstain consistently with the baseline (never usable)", () => {
    // normalizeGenre never accepted these as seeds either
    for (const junk of ["Music", "unknown", "fixme", ""]) {
      expect(scoringFamily(junk)).toBe(genreFamily(junk));
    }
  });
});
