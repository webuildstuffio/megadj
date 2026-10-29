// rb #275 root-cause tests: the ripper/fetcher identity split. The paro
// incident (Sep 19): SC rips tagged the UPLOADING CHANNEL as artist
// ("Experts Only", "Big Joy Records") and minted "<artist> - Unknown
// Album" placeholders — the BP identity stage then artist-gated against
// the wrong name and refused every correct hit. These pins cover the
// download-time split (metadata-build) and the fetch-time self-heal
// (fetch-stages bpQueryArtist + stageBeatportIdentity correction).

import { describe, expect, test } from "bun:test";
import { buildMetadata, scInfoToYtdlpInfo, splitArtistFromTitle } from "../write/metadata-build";

describe("#275 splitArtistFromTitle (the download-time identity seam)", () => {
  test("splits on the first ' - ' only", () => {
    expect(splitArtistFromTitle("Gabss - She Freaks (Original Mix)")).toEqual({
      artist: "Gabss",
      track: "She Freaks (Original Mix)",
    });
    // later " - " boundaries stay in the track half
    expect(splitArtistFromTitle("GENESI & Equinøx - Chemistry - Truesoul")).toEqual({
      artist: "GENESI & Equinøx",
      track: "Chemistry - Truesoul",
    });
  });

  test("no separator / degenerate halves → null", () => {
    expect(splitArtistFromTitle('Surf Curse "Freaks"')).toBeNull();
    expect(splitArtistFromTitle("X - ")).toBeNull();
    expect(splitArtistFromTitle(" - Y")).toBeNull();
    expect(splitArtistFromTitle(undefined)).toBeNull();
    expect(splitArtistFromTitle("AC/DC - TNT")).toEqual({ artist: "AC/DC", track: "TNT" });
  });
});

describe("#275 scInfoToYtdlpInfo artist correction", () => {
  test("imprint-channel upload takes the title's artist (the paro shape)", () => {
    const mapped = scInfoToYtdlpInfo({
      title: "Tini Gessler - Come Around (Extended Mix)",
      uploader: "Experts Only",
    });
    expect(mapped.artist).toBe("Tini Gessler");
  });

  test("no-split title falls back to uploader→artist", () => {
    const mapped = scInfoToYtdlpInfo({ title: "Sofia", uploader: "Clairo" });
    expect(mapped.artist).toBe("Clairo");
  });
});

describe("#275 buildMetadata identity hygiene", () => {
  test("'X - Unknown Album' placeholders dissolve to honest undefined", () => {
    expect(
      buildMetadata({ title: "T", album: "Big Joy Records - Unknown Album" }).album,
    ).toBeUndefined();
  });

  test("real albums pass through untouched", () => {
    expect(buildMetadata({ title: "T", album: "Buds" }).album).toBe("Buds");
  });

  test("description without an album mention stays undefined", () => {
    expect(
      buildMetadata({ title: "T", description: "out now everywhere, shout out my mom" }).album,
    ).toBeUndefined();
  });
});
