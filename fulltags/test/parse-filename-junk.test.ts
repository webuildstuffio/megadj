import { describe, expect, test } from "bun:test";
import { parseFilename } from "../src/media-probe";

/** Sep 11 regression: pool-rip filenames composed by an upstream tool as
 *  `UnknownArtist · UnknownAlbum · <rest>` used to parse "UnknownArtist"
 *  as the ARTIST — which baked junk tags into files and made every SC
 *  search query junk keys (13 tracks then embedded one shared banner). */
describe("parseFilename — junk prefix stripping", () => {
  test("composed quarantine prefix is stripped before artist/title split", () => {
    const p = parseFilename(
      "UnknownArtist · UnknownAlbum · Tvardovsky - Depths Of Consciousness.mp3",
    );
    expect(p.artist).toBe("Tvardovsky");
    expect(p.title).toBe("Depths Of Consciousness");
  });

  test("prefix with real artist kept in the tail still parses", () => {
    const p = parseFilename(
      "UnknownArtist · UnknownAlbum · jam rumi - oasis midnights (original mix).aiff",
    );
    expect(p.artist).toBe("jam rumi");
    expect(p.title).toBe("oasis midnights (original mix)");
  });

  test("bare UnknownArtist - prefix (hyphen variant)", () => {
    const p = parseFilename("UnknownArtist - Some Track.mp3");
    expect(p.artist).toBeNull();
    expect(p.title).toBe("Some Track");
  });

  test("Unknown Artist with space and hyphen", () => {
    const p = parseFilename("Unknown Artist - Real Song.wav");
    expect(p.artist).toBeNull();
    expect(p.title).toBe("Real Song");
  });

  test("plain names parse exactly as before (no regression)", () => {
    expect(parseFilename("Nalin & Kane - Beachball.mp3")).toEqual({
      trackNo: null,
      artist: "Nalin & Kane",
      title: "Beachball",
    });
    expect(parseFilename("Track Only.mp3")).toEqual({
      trackNo: null,
      artist: null,
      title: "Track Only",
    });
    expect(parseFilename("01 - Intro.mp3")).toEqual({
      trackNo: 1,
      artist: null,
      title: "Intro",
    });
    expect(parseFilename("01 - CamelPhat - Hypercube.aiff")).toEqual({
      trackNo: 1,
      artist: "CamelPhat",
      title: "Hypercube",
    });
  });
});
