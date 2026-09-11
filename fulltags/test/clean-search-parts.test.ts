import { describe, expect, test } from "bun:test";
import { cleanSearchParts } from "../src/art-sources";
import { cleanArtist } from "../../tools/fetch-lib";

/** Sep 11 regression: junk-composed artist/title strings reached the SC
 *  search keys and the uploader scorer — every query poisoned, 13 pool
 *  tracks matched loose junk and embedded the same "DJ ONLY" banner. */
describe("cleanSearchParts", () => {
  test("strips composed junk from artist AND title", () => {
    const r = cleanSearchParts(
      "UnknownArtist · UnknownAlbum · Tvardovsky",
      "UnknownArtist · UnknownAlbum · Depths Of Consciousness",
    );
    expect(r.artist).toBe("Tvardovsky");
    expect(r.title).toBe("Depths Of Consciousness");
  });

  test("clean input passes through untouched", () => {
    const r = cleanSearchParts("Nalin & Kane", "Beachball (Original Mix)");
    expect(r.artist).toBe("Nalin & Kane");
    expect(r.title).toBe("Beachball (Original Mix)");
  });

  test("all-junk artist → null (never search 'UnknownArtist')", () => {
    const r = cleanSearchParts("UnknownArtist · UnknownAlbum · ", "X");
    expect(r.artist).toBeNull();
  });
});

describe("cleanArtist (fetch-lib DB guard)", () => {
  test("un-bakes composed junk DB rows", () => {
    expect(cleanArtist("UnknownArtist · UnknownAlbum · Audiojack")).toBe(
      "Audiojack",
    );
  });

  test("bare junk → null", () => {
    expect(cleanArtist("UnknownArtist")).toBeNull();
    expect(cleanArtist("Unknown Artist")).toBeNull();
    expect(cleanArtist(null)).toBeNull();
    expect(cleanArtist("")).toBeNull();
  });

  test("real artist untouched", () => {
    expect(cleanArtist("Stephan Bodzin")).toBe("Stephan Bodzin");
  });
});
