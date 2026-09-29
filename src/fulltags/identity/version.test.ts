import { describe, expect, test } from "bun:test";
import {
  parseVersion,
  versionCompatible,
  type VersionIdentity,
} from "./version";

describe("parseVersion — remix patterns", () => {
  test("(Artist Remix)", () => {
    const v = parseVersion("Track Name (DJ Snake Remix)", "Original Artist");
    expect(v.versionType).toBe("remix");
    expect(v.versionArtists).toEqual(["DJ Snake"]);
    expect(v.baseTitle).toBe("track name");
    expect(v.originalArtists).toEqual(["Original Artist"]);
    expect(v.confidence).toBe(1.0);
  });

  test("[Artist Remix]", () => {
    const v = parseVersion("Track Name [DJ Snake Remix]", "Original Artist");
    expect(v.versionType).toBe("remix");
    expect(v.versionArtists).toEqual(["DJ Snake"]);
  });

  test("- Artist Remix (dash suffix)", () => {
    const v = parseVersion("Track Name - DJ Snake Remix", "Original Artist");
    expect(v.versionType).toBe("remix");
    expect(v.versionArtists).toEqual(["DJ Snake"]);
  });

  test("(Artist Re-Mix) hyphenated", () => {
    const v = parseVersion("Track (Afrojack Re-Mix)", "Someone");
    expect(v.versionType).toBe("remix");
    expect(v.versionArtists).toEqual(["Afrojack"]);
  });

  test("(Artist Rmx) abbreviation", () => {
    const v = parseVersion("Beat (Maceo Plex Rmx)", "Someone");
    expect(v.versionType).toBe("remix");
    expect(v.versionArtists).toEqual(["Maceo Plex"]);
  });
});

describe("parseVersion — edit / bootleg / flip / vip / rework / dub", () => {
  test("(Artist Edit)", () => {
    const v = parseVersion("Song (Purple Disco Machine Edit)", "Singer");
    expect(v.versionType).toBe("edit");
    expect(v.versionArtists).toEqual(["Purple Disco Machine"]);
  });

  test("(Artist Bootleg)", () => {
    const v = parseVersion("Song (Baauer Bootleg)", "Taylor Swift");
    expect(v.versionType).toBe("bootleg");
    expect(v.versionArtists).toEqual(["Baauer"]);
  });

  test("(Artist Flip)", () => {
    const v = parseVersion("Song (Valentino Khan Flip)", "Artist");
    expect(v.versionType).toBe("flip");
    expect(v.versionArtists).toEqual(["Valentino Khan"]);
  });

  test("(VIP) no artist", () => {
    const v = parseVersion("Song (VIP)", "Artist");
    expect(v.versionType).toBe("vip");
    expect(v.versionArtists).toEqual([]);
  });

  test("(Artist VIP)", () => {
    const v = parseVersion("Song (Skrillex VIP)", "Artist");
    expect(v.versionType).toBe("vip");
    expect(v.versionArtists).toEqual(["Skrillex"]);
  });

  test("(Artist Rework)", () => {
    const v = parseVersion("Song (Eats Everything Rework)", "Artist");
    expect(v.versionType).toBe("rework");
    expect(v.versionArtists).toEqual(["Eats Everything"]);
  });

  test("(Artist Dub Mix)", () => {
    const v = parseVersion("Song (Lee Burridge Dub Mix)", "Artist");
    expect(v.versionType).toBe("dub");
    expect(v.versionArtists).toEqual(["Lee Burridge"]);
  });

  test("(Artist Dub)", () => {
    const v = parseVersion("Song (Solomun Dub)", "Artist");
    expect(v.versionType).toBe("dub");
    expect(v.versionArtists).toEqual(["Solomun"]);
  });
});

describe("parseVersion — standard versions (no artist)", () => {
  test("(Extended Mix)", () => {
    const v = parseVersion("Song (Extended Mix)", "Artist");
    expect(v.versionType).toBe("extended");
    expect(v.versionArtists).toEqual([]);
  });

  test("(Original Mix)", () => {
    const v = parseVersion("Song (Original Mix)", "Artist");
    expect(v.versionType).toBe("original");
    expect(v.versionArtists).toEqual([]);
  });

  test("(Radio Edit)", () => {
    const v = parseVersion("Song (Radio Edit)", "Artist");
    expect(v.versionType).toBe("radio");
    expect(v.versionArtists).toEqual([]);
  });

  test("(Club Mix)", () => {
    const v = parseVersion("Song (Club Mix)", "Artist");
    expect(v.versionType).toBe("extended");
    expect(v.versionArtists).toEqual([]);
  });

  test("(Acoustic)", () => {
    const v = parseVersion("Song (Acoustic)", "Artist");
    expect(v.versionType).toBe("acoustic");
  });

  test("(Live at Wembley)", () => {
    const v = parseVersion("Song (Live at Wembley)", "Artist");
    expect(v.versionType).toBe("live");
  });

  test("(Instrumental)", () => {
    const v = parseVersion("Song (Instrumental)", "Artist");
    expect(v.versionType).toBe("instrumental");
  });

  test("(Acapella)", () => {
    const v = parseVersion("Song (Acapella)", "Artist");
    expect(v.versionType).toBe("acapella");
  });

  test("(A Cappella)", () => {
    const v = parseVersion("Song (A Cappella)", "Artist");
    expect(v.versionType).toBe("acapella");
  });
});

describe("parseVersion — featured artists", () => {
  test("feat. in title", () => {
    const v = parseVersion("Song feat. Singer (Extended Mix)", "DJ");
    expect(v.featured).toEqual(["Singer"]);
    expect(v.originalArtists).toEqual(["DJ"]);
  });

  test("ft. in title", () => {
    const v = parseVersion("Song ft. Singer", "DJ");
    expect(v.featured).toEqual(["Singer"]);
  });

  test("featuring in artist field", () => {
    const v = parseVersion("Song", "DJ featuring Singer");
    expect(v.featured).toEqual(["Singer"]);
    expect(v.originalArtists).toEqual(["DJ"]);
  });

  test("multiple featured artists", () => {
    const v = parseVersion("Song feat. A & B", "DJ");
    expect(v.featured).toContain("A");
    expect(v.featured).toContain("B");
  });
});

describe("parseVersion — plain titles (no brackets)", () => {
  test("plain title → original", () => {
    const v = parseVersion("Just A Song", "Artist");
    expect(v.versionType).toBe("original");
    expect(v.baseTitle).toBe("just a song");
    expect(v.rawVersion).toBeNull();
    expect(v.confidence).toBe(0.9);
  });
});

describe("parseVersion — multiple artists in artist field", () => {
  test("comma-separated", () => {
    const v = parseVersion("Song", "Artist A, Artist B");
    expect(v.originalArtists).toEqual(["Artist A", "Artist B"]);
  });

  test("& separated", () => {
    const v = parseVersion("Song", "A & B");
    expect(v.originalArtists).toContain("A");
    expect(v.originalArtists).toContain("B");
  });

  test("remixer removed from originalArtists", () => {
    const v = parseVersion("Song (DJ Snake Remix)", "Taylor Swift, DJ Snake");
    expect(v.originalArtists).toEqual(["Taylor Swift"]);
    expect(v.versionArtists).toEqual(["DJ Snake"]);
  });
});

describe("parseVersion — edge cases", () => {
  test("NFC normalization", () => {
    const v = parseVersion("Café (Remix)", "Artist");
    expect(v.baseTitle).toContain("café");
  });

  test("case insensitive matching", () => {
    const v = parseVersion("Song (SKRILLEX REMIX)", "Artist");
    expect(v.versionType).toBe("remix");
    expect(v.versionArtists).toEqual(["SKRILLEX"]);
  });

  test("empty inputs", () => {
    const v = parseVersion("", "");
    expect(v.versionType).toBe("original");
    expect(v.baseTitle).toBe("");
  });
});

describe("versionCompatible", () => {
  const original: VersionIdentity = {
    baseTitle: "song",
    originalArtists: ["Artist"],
    featured: [],
    versionType: "original",
    versionArtists: [],
    rawVersion: null,
    confidence: 1,
    parser: "regex",
  };

  const remix: VersionIdentity = {
    baseTitle: "song",
    originalArtists: ["Artist"],
    featured: [],
    versionType: "remix",
    versionArtists: ["DJ"],
    rawVersion: "DJ Remix",
    confidence: 1,
    parser: "regex",
  };

  const sameRemix: VersionIdentity = {
    baseTitle: "song",
    originalArtists: ["Artist"],
    featured: [],
    versionType: "remix",
    versionArtists: ["DJ"],
    rawVersion: "DJ Remix",
    confidence: 1,
    parser: "regex",
  };

  const differentRemix: VersionIdentity = {
    baseTitle: "song",
    originalArtists: ["Artist"],
    featured: [],
    versionType: "remix",
    versionArtists: ["Other DJ"],
    rawVersion: "Other DJ Remix",
    confidence: 1,
    parser: "regex",
  };

  const differentSong: VersionIdentity = {
    ...original,
    baseTitle: "other song",
  };

  test("exact — same version, same artist", () => {
    expect(versionCompatible(remix, sameRemix)).toBe("exact");
  });

  test("exact — both originals (no artist)", () => {
    expect(versionCompatible(original, { ...original })).toBe("exact");
  });

  test("sibling — same base, different version type", () => {
    expect(versionCompatible(original, remix)).toBe("sibling");
  });

  test("sibling — same base, different remix artist", () => {
    expect(versionCompatible(remix, differentRemix)).toBe("sibling");
  });

  test("reject — different base title", () => {
    expect(versionCompatible(original, differentSong)).toBe("reject");
  });
});
