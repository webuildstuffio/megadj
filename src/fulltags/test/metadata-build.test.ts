import { describe, expect, test } from "bun:test";
import { guessFromFreeText } from "../genre/genre-vocab";
import {
  buildMetadata,
  cleanYouTubeTitle,
  extractComposer,
  scInfoToYtdlpInfo,
} from "../write/metadata-build";

describe("cleanYouTubeTitle", () => {
  test("strips official-audio noise", () => {
    expect(cleanYouTubeTitle("Let Her Go (Official Audio)")).toBe("Let Her Go");
    expect(cleanYouTubeTitle("P2 [Official Lyric Video]")).toBe("P2");
    expect(cleanYouTubeTitle("Fade Away (Official Video)")).toBe("Fade Away");
    expect(cleanYouTubeTitle("Used To (Official Visualizer)")).toBe("Used To");
  });

  test("normalizes smart quotes and whitespace", () => {
    expect(cleanYouTubeTitle("Rich “And” Blind")).toBe('Rich "And" Blind');
    expect(cleanYouTubeTitle("too   many    spaces")).toBe("too many spaces");
  });

  test("keeps feat. formatting normalized", () => {
    expect(cleanYouTubeTitle("Go Dumb (feat. blackbear)")).toBe(
      "Go Dumb (ft. blackbear)",
    );
  });

  test("handles null", () => {
    expect(cleanYouTubeTitle(null)).toBeNull();
    expect(cleanYouTubeTitle(undefined)).toBeNull();
  });
});

describe("guessFromFreeText (the free-text regex guess)", () => {
  test("detects hip-hop", () => {
    expect(guessFromFreeText(["Juice WRLD - rap track"])).toBe("Hip-Hop");
  });
  test("detects house", () => {
    expect(guessFromFreeText(["Deep House Mix 2023"])).toBe("House");
  });
  test("word-boundary match ignores substrings", () => {
    // "Soulji" must NOT match the soul pattern.
    expect(
      guessFromFreeText(["Karma Fields - You and Me (Soulji Remix) [House]"]),
    ).toBe("House");
    // "Sunset" must not match "set"-based mix heuristics — no Mix genre now.
    expect(guessFromFreeText(["Chill Sunset Vibes"])).toBe("Chill / Lo-Fi");
  });
  test("returns null on no match", () => {
    expect(guessFromFreeText(["something random"])).toBeNull();
  });
});

describe("extractComposer", () => {
  test("pulls producer credits", () => {
    const desc = "Producer: Heavy Keyzz\nProducer: SEVEN\nWriter: someone";
    expect(extractComposer(desc)).toBe("Heavy Keyzz, SEVEN");
  });
  test("handles 'Produced by' variant", () => {
    expect(extractComposer("Produced by John Cunningham")).toBe(
      "John Cunningham",
    );
  });
  test("dedupes and caps at 3", () => {
    const desc =
      "Producer: A\nProducer: A\nProducer: B\nProducer: C\nProducer: D";
    expect(extractComposer(desc)).toBe("A, B, C");
  });
  test("null when no credits", () => {
    expect(extractComposer("no credits here")).toBeNull();
    expect(extractComposer(null)).toBeNull();
  });
});

describe("buildMetadata", () => {
  test("assembles full metadata from ytdlp info", () => {
    const meta = buildMetadata({
      title: "Fade Away (Official Audio)",
      artist: "The Kid LAROI",
      album: "Fade Away",
      release_date: "20200416",
      description: "Producer: Heavy Keyzz",
      webpage_url: "https://music.youtube.com/watch?v=x",
      genre: "Music",
    });
    expect(meta.title).toBe("Fade Away");
    expect(meta.artist).toBe("The Kid LAROI");
    expect(meta.album).toBe("Fade Away");
    expect(meta.date).toBe("2020");
    expect(meta.composer).toBe("Heavy Keyzz");
    expect(meta.comment).toContain("music.youtube.com");
  });

  test("falls back gracefully on sparse info", () => {
    const meta = buildMetadata({ title: "Unknown Track" });
    expect(meta.title).toBe("Unknown Track");
    expect(meta.artist).toBeNull();
    // #61: no "Music" mint — an unknown genre stays null (honest gap;
    // fetch fills it later from SC/Beatport).
    expect(meta.genre).toBeNull();
  });

  test("keeps a real genre the regex table can't match", () => {
    // The mint used to REPLACE genuine raw genres with "Music"; a raw
    // non-"Music" genre must survive untouched.
    expect(buildMetadata({ title: "X", genre: "Kuduro" }).genre).toBe("Kuduro");
  });

  test("refuses the literal Music placeholder", () => {
    // YouTube-tier category "Music" is not a genre — must not pass through.
    expect(buildMetadata({ title: "X", genre: "Music" }).genre).toBeNull();
  });
});

describe("scInfoToYtdlpInfo (#258 — the SC payload shape bridge)", () => {
  test("uploader becomes artist when artist is absent (live SC shape)", () => {
    // Measured live Sep 19: SC gives uploader="Porter Robinson", no artist.
    const mapped = scInfoToYtdlpInfo({
      title: "Shelter",
      uploader: "Porter Robinson",
      timestamp: 1470950832,
    });
    expect(mapped.artist).toBe("Porter Robinson");
    expect(mapped.upload_date).toBe("20160811");
    expect(mapped.uploader).toBe("Porter Robinson");
  });

  test("an explicit artist is never overwritten", () => {
    const mapped = scInfoToYtdlpInfo({
      title: "X",
      artist: "Real Artist",
      uploader: "Reuploader Channel",
    });
    expect(mapped.artist).toBe("Real Artist");
  });

  test("existing upload_date wins over timestamp", () => {
    const mapped = scInfoToYtdlpInfo({
      title: "X",
      upload_date: "20200101",
      timestamp: 1470950832,
    });
    expect(mapped.upload_date).toBe("20200101");
  });

  test("missing/bad timestamp leaves upload_date undefined", () => {
    const mapped = scInfoToYtdlpInfo({ title: "X" });
    expect(mapped.upload_date).toBeUndefined();
    expect(
      scInfoToYtdlpInfo({ title: "X", timestamp: 0 }).upload_date,
    ).toBeUndefined();
  });

  test("the mapped info builds real tags (artist + date land)", () => {
    const meta = buildMetadata(
      scInfoToYtdlpInfo({
        title: "Porter Robinson & Madeon - Shelter",
        uploader: "Porter Robinson",
        timestamp: 1470950832,
      }),
    );
    // #275: the title's "A - T" split names the TRACK artist (both
    // collaborators), which outranks the uploading channel's own name —
    // the BP artist gate can match it.
    expect(meta.artist).toBe("Porter Robinson & Madeon");
    expect(meta.date).toBe("2016");
  });

  test("#275: an imprint-channel upload takes the title's artist, not the channel", () => {
    // The paro incident live shape: Big Joy Records (label channel)
    // uploaded Surf Curse's track; the rip previously tagged
    // "Big Joy Records" as artist and every BP identity gate refused.
    const mapped = scInfoToYtdlpInfo({
      title: 'Surf Curse "Freaks"',
      uploader: "Big Joy Records",
    });
    // No " - " split in this title: uploader→artist is the only option
    // (honest, and fetch's BP self-heal corrects it later).
    expect(mapped.artist).toBe("Big Joy Records");

    const splitShape = scInfoToYtdlpInfo({
      title: "Gabss - She Freaks (Original Mix)",
      uploader: "Ⓜ️iSS Ⓜ️oni 7.8",
    });
    expect(splitShape.artist).toBe("Gabss");
  });

  test("#275: self-uploads keep uploader→artist (split artist == uploader)", () => {
    const mapped = scInfoToYtdlpInfo({
      title: "Mau P - TESLA",
      uploader: "Mau P",
    });
    expect(mapped.artist).toBe("Mau P");
  });

  test("#275: description album mention is recovered (Surf Curse live shape)", () => {
    const meta = buildMetadata({
      title: "Surf Curse - Freaks",
      description:
        '"Freaks" from the upcoming album "Buds" by Reno, Nevada\'s Surf Curse.',
    });
    expect(meta.album).toBe("Buds");
  });

  test("#275: 'X - Unknown Album' placeholders dissolve to honest null", () => {
    expect(
      buildMetadata({ title: "T", album: "Experts Only - Unknown Album" })
        .album,
    ).toBeNull();
    expect(buildMetadata({ title: "T", album: "Real Album" }).album).toBe(
      "Real Album",
    );
  });

  test("idempotent — mapping twice changes nothing", () => {
    const once = scInfoToYtdlpInfo({
      title: "X",
      uploader: "A",
      timestamp: 1470950832,
    });
    const twice = scInfoToYtdlpInfo(once);
    expect(twice).toStrictEqual(once);
  });
});

describe("junk-genre guard (Sep 19 organize audit)", () => {
  test("URL-shaped 'genres' are honest nulls — they minted garbage folders", () => {
    expect(buildMetadata({ genre: "https://djsoundtop.com" }).genre).toBeNull();
    expect(
      buildMetadata({ genre: "http://electronicfresh.com" }).genre,
    ).toBeNull();
  });

  test("JSON-blob genres (the thumbnails-array row) are nulls", () => {
    expect(
      buildMetadata({ genre: "[{'id': 'mini', 'url': 'https://…'}]" }).genre,
    ).toBeNull();
    expect(buildMetadata({ genre: '{"a":1}' }).genre).toBeNull();
  });

  test("overlong tag-soup and control bytes are nulls", () => {
    expect(buildMetadata({ genre: "x".repeat(61) }).genre).toBeNull();
    expect(buildMetadata({ genre: "Tech\u0000House" }).genre).toBeNull();
  });

  test("real genres still pass — the guard only kills junk (guess may refine)", () => {
    // "Tech House" passes the guard; guessFromFreeText may coarsen it to a
    // family bucket ("House") — that's the pre-existing inference policy,
    // not the junk guard. Kuduro isn't in the table and passes through raw.
    expect(buildMetadata({ genre: "Kuduro" }).genre).toBe("Kuduro");
  });
});

describe("artist-prefix stripping (#321 title contamination)", () => {
  test("SC-style 'Artist - Track' title strips when artist matches", () => {
    const meta = buildMetadata({
      title: "Skrillex - Bangarang",
      artist: "Skrillex",
    });
    expect(meta.title).toBe("Bangarang");
    expect(meta.artist).toBe("Skrillex");
  });

  test("case-insensitive artist match strips prefix", () => {
    const meta = buildMetadata({
      title: "DJ SNAKE - Corona Remix",
      artist: "DJ Snake",
    });
    expect(meta.title).toBe("Corona Remix");
  });

  test("does NOT strip when artist is a substring (not a prefix)", () => {
    const meta = buildMetadata({
      title: "Gabss - She Freaks (Original Mix)",
      artist: "Gabss",
    });
    expect(meta.title).toBe("She Freaks (Original Mix)");
  });

  test("does NOT strip when artist doesn't match", () => {
    const meta = buildMetadata({
      title: "Skrillex - Bangarang",
      artist: "Diplo",
    });
    expect(meta.title).toBe("Skrillex - Bangarang");
  });

  test("handles title with multiple dashes (remix suffix)", () => {
    const meta = buildMetadata({
      title: "Miss Monique - Melodic Techno Mix - Session 5",
      artist: "Miss Monique",
    });
    expect(meta.title).toBe("Melodic Techno Mix - Session 5");
  });

  test("no artist → title stays unchanged", () => {
    const meta = buildMetadata({ title: "Skrillex - Bangarang" });
    expect(meta.title).toBe("Skrillex - Bangarang");
  });

  test("plain title without dash stays unchanged", () => {
    const meta = buildMetadata({
      title: "Bangarang",
      artist: "Skrillex",
    });
    expect(meta.title).toBe("Bangarang");
  });

  test("SC pipeline end-to-end: title + artist separate cleanly", () => {
    const mapped = scInfoToYtdlpInfo({
      title: "Mau P - TESLA",
      uploader: "Mau P",
    });
    const meta = buildMetadata(mapped);
    expect(meta.artist).toBe("Mau P");
    expect(meta.title).toBe("TESLA");
  });
});
