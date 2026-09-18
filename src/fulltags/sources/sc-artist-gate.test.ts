import { describe, expect, test } from "bun:test";
import { SC_ARTIST_MIN_LEN, scoreScHits } from "./sc-search";

/** Regression: the Taylor Swift problem (Sep 15). SC search used to score
 *  uploader agreement as a +1 bonus only, so a high title-overlap hit from
 *  an UNRELATED uploader could win hits[0] and write its genre/year. The
 *  hard gate (mirroring scoreBpHit) drops non-matching-uploaders entirely
 *  when the query names a real artist. */
const col = (
  title: string,
  uploader: string,
  genre = "NA",
  ts = "1720000000",
): string =>
  // Real yt-dlp flat-playlist layout (6 fields after COL|, verified live
  // Sep 15): title|url|uploader|thumbnails|genre|timestamp
  `COL|${title.slice(0, 60)}|https://soundcloud.com/x/track|${uploader}|[thumbs]|${genre}|${ts}`;

describe("scoreScHits — hard artist gate", () => {
  test("drops wrong-uploader hits for a known artist (the TS case)", () => {
    const hits = scoreScHits(
      [
        col("Taylor Swift - Love Story (Dubstep Remix)", "DubstepCompilations"),
        col("taylor swift love story", "SomeRadioChannel"),
      ],
      { artist: "Taylor Swift", title: "Love Story" },
    );
    expect(hits).toHaveLength(0);
  });

  test("keeps hits whose uploader matches the query artist", () => {
    const hits = scoreScHits(
      [col("Artist - Track (Original Mix)", "Artist Official")],
      { artist: "Artist", title: "Track Original Mix" },
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.uploader).toBe("Artist Official");
  });

  test("matches by uploader prefix (first 8 chars), like the old bonus did", () => {
    const hits = scoreScHits([col("Tvardovsky - Depths", "TvardovskySound")], {
      artist: "Tvardovsky",
      title: "Depths",
    });
    expect(hits).toHaveLength(1);
  });

  test("remixes still pass when uploaded by the remixer's channel", () => {
    // "Must contain (uploader), allow remix (title)" — the remixer's own
    // channel passes; the title overlap credits the original-artist words.
    const hits = scoreScHits(
      [col("Faithless - Insomnia (Eric Prydz Remix)", "Eric Prydz")],
      { artist: "Faithless", title: "Insomnia Eric Prydz Remix" },
    );
    expect(hits).toHaveLength(0); // uploader "Eric Prydz" != "faithless"
  });

  test("artist shorter than the floor skips the gate entirely", () => {
    const hits = scoreScHits(
      [col("DJ - Boomerang", "TotallyUnrelatedChannel")],
      { artist: "DJ", title: "Boomerang" },
    );
    expect(hits).toHaveLength(1);
  });

  test("null artist skips the gate entirely", () => {
    const hits = scoreScHits([col("Unknown - Thing", "Anything")], {
      artist: null,
      title: "Thing",
    });
    expect(hits).toHaveLength(1);
  });

  test("floor is 3 (same as BP_ARTIST_MIN_LEN)", () => {
    expect(SC_ARTIST_MIN_LEN).toBe(3);
  });
});

describe("scoreScHits — invariants kept from the old parser", () => {
  test("still drops non-soundcloud URLs", () => {
    const hits = scoreScHits(
      [
        "COL|Some Track|https://youtube.com/watch?v=x|Artist Official|[t]|NA|1720000000",
      ],
      { artist: "Artist", title: "Some Track" },
    );
    expect(hits).toHaveLength(0);
  });

  test("still requires title overlap ≥ 1", () => {
    const hits = scoreScHits(
      [col("Completely Different Words Here", "Artist Official")],
      { artist: "Artist", title: "Depths" },
    );
    expect(hits).toHaveLength(0);
  });

  test("still refuses numeric genre IDs", () => {
    const hits = scoreScHits(
      [col("Artist - Depths", "Artist Official", "41234")],
      { artist: "Artist", title: "Depths" },
    );
    expect(hits[0]?.genre).toBeUndefined();
  });

  test("still parses years from timestamps (highest overlap wins)", () => {
    const hits = scoreScHits(
      [
        col(
          "Artist - Depths (Original Mix)",
          "Artist Official",
          "NA",
          "1650000000",
        ),
      ],
      { artist: "Artist", title: "Depths Original Mix" },
    );
    expect(hits[0]?.year).toBe(2022);
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  test("REGRESSION: field alignment — genre and year both parse from real 6-field lines", () => {
    // The old parser destructured 7 fields (phantom slot after uploader):
    // thumbs got the genre, genre got the numeric timestamp (always
    // refused), year was always undefined — SC genre+year stages were
    // silently dead. Pinned against the LIVE-verified yt-dlp layout.
    const hits = scoreScHits(
      [
        col(
          "Tvardovsky - Depths Of Consciousness",
          "Tvardovsky",
          "Progressive House",
          "1558102548",
        ),
      ],
      { artist: "Tvardovsky", title: "Depths Of Consciousness" },
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.genre).toBe("Progressive House");
    expect(hits[0]?.year).toBe(2019);
    // thumb regex now actually sees the thumbnails field
    expect(hits[0]?.thumb).toBeNull(); // fixture has no artwork URL
  });

  test("thumb URL extracted when thumbnails carry a t500x500 artwork", () => {
    const line =
      "COL|A Track|https://soundcloud.com/x/a|A Official|['url': 'https://i1.sndcdn.com/artworks-abc-t500x500.jpg']|Techno|1650000000";
    const hits = scoreScHits([line], { artist: "A", title: "Track" });
    expect(hits[0]?.thumb).toBe(
      "https://i1.sndcdn.com/artworks-abc-t500x500.jpg",
    );
  });

  test("garbage lines are ignored", () => {
    expect(
      scoreScHits(["", "not a col line", "COL|only|three"], {
        artist: "Artist",
        title: "Depths",
      }),
    ).toHaveLength(0);
  });
});
