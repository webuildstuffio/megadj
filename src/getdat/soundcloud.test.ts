// soundcloud.test.ts — the pure SC acquisition seams (#255/#256/#257):
// source union, URL forms, the SC failure classes (404 = permanent-gone —
// the generic classifier used to retry dead slugs forever), format-id →
// kbps map, and the link-first extraction/decision rules. All pure — no
// spawn, no network.
import { describe, expect, test } from "bun:test";
import {
  SC_SOURCE,
  classifyScFailure,
  extractAcquisitionLinks,
  isPrivateUser404,
  isSoundCloudUrl,
  ripDecision,
  scExtractionArgs,
  scFormatKbps,
  scTrackIdFromUrl,
  scTrackUrl,
  scUserGateNeeded,
  type ScAcquisitionLink,
  type SyncSource,
} from "./soundcloud";

describe("SC URL forms (#255)", () => {
  test("isSoundCloudUrl accepts the real hosts", () => {
    expect(
      isSoundCloudUrl("https://soundcloud.com/meduza/sets/listening-house"),
    ).toBe(true);
    expect(
      isSoundCloudUrl(
        "https://soundcloud.com/porter-robinson/porter-robinson-madeon-shelter-5",
      ),
    ).toBe(true);
    expect(isSoundCloudUrl("https://www.soundcloud.com/someone/track")).toBe(
      true,
    );
    expect(isSoundCloudUrl("https://api.soundcloud.com/tracks/277870779")).toBe(
      true,
    );
  });

  test("isSoundCloudUrl rejects look-alikes and YT", () => {
    expect(isSoundCloudUrl("https://soundcloud.com.evil.example/track")).toBe(
      false,
    );
    expect(isSoundCloudUrl("https://music.youtube.com/watch?v=x")).toBe(false);
    expect(isSoundCloudUrl("not a url")).toBe(false);
  });

  test("scTrackUrl round-trips the numeric api permalink", () => {
    expect(scTrackUrl("277870779")).toBe(
      "https://api.soundcloud.com/tracks/277870779",
    );
    expect(scTrackIdFromUrl(scTrackUrl("42"))).toBe("42");
    expect(scTrackIdFromUrl("https://soundcloud.com/artist/slug")).toBeNull();
  });
});

describe("SC failure classes (#255 — dead slugs must not retry forever)", () => {
  // Live stderr shapes, captured Sep 19 (yt-dlp 2026.08.19):
  const permalink404 =
    "ERROR: [soundcloud] porter-robinson/shelter: Unable to download JSON metadata: HTTP Error 404: Not Found (caused by <HTTPError 404: Not Found>)";

  test("permalink 404 classifies permanent-gone", () => {
    expect(classifyScFailure(permalink404)).toBe("gone");
  });

  test("DRM/protected streams classify permanent (never retried)", () => {
    expect(
      classifyScFailure(
        "ERROR: [soundcloud] a/b: This track is not available (PROTECTED-CCS)",
      ),
    ).toBe("permanent");
    expect(
      classifyScFailure("ERROR: [soundcloud] a/b: DRM protected stream"),
    ).toBe("permanent");
  });

  test("throttle/network stays retryable (backoff owns it)", () => {
    expect(classifyScFailure("HTTP Error 429: Too Many Requests")).toBe(
      "retryable",
    );
    expect(classifyScFailure("connection reset by peer")).toBe("retryable");
    expect(classifyScFailure("")).toBe("retryable");
  });
});

describe("SC format ids (#255 — the SC bitrate map)", () => {
  test("the three live SC format ids map to their kbps", () => {
    expect(scFormatKbps("hls_aac_160k")).toBe(160);
    expect(scFormatKbps("hls_mp3_0_1")).toBe(128);
    expect(scFormatKbps("hls_aac_96k")).toBe(96);
  });

  test("unknown and YT ids fall through null (YT map owns them)", () => {
    expect(scFormatKbps("141")).toBeNull();
    expect(scFormatKbps("something_new")).toBeNull();
    expect(scFormatKbps(null)).toBeNull();
  });
});

describe("link-first extraction (#256)", () => {
  test("purchase_url surfaces first", () => {
    const links = extractAcquisitionLinks({
      purchase_url: "https://fanlink.to/shelter",
      description: "out now",
    });
    expect(links[0]?.kind).toBe("purchase_url");
    expect(links[0]?.url).toBe("https://fanlink.to/shelter");
  });

  test("free-download marker surfaces the download url", () => {
    const links = extractAcquisitionLinks({
      downloadable: true,
      download_url: "https://api-feed.soundcloud.com/media/download/x",
    });
    expect(links[0]?.kind).toBe("free_download");
  });

  test("description store + smart links are classified", () => {
    const links = extractAcquisitionLinks({
      description:
        "Buy: https://bandcamp.com/track/x. Stream: https://fanlink.to/shelter — video: https://youtu.be/fzQ6gRAEoy0, social: https://twitter.com/someone",
    });
    expect(links.map((l) => l.kind)).toStrictEqual([
      "description_store_link",
      "smart_link",
    ]);
    // The YouTube and social URLs never surface.
    expect(links.some((l) => l.url.includes("youtu"))).toBe(false);
    expect(links.some((l) => l.url.includes("twitter"))).toBe(false);
  });

  test("trailing punctuation is stripped, dedupe keeps first", () => {
    const links = extractAcquisitionLinks({
      description:
        "get it at https://lnk.to/track. or https://lnk.to/track, thanks",
    });
    expect(links.length).toBe(1);
    expect(links[0]?.url).toBe("https://lnk.to/track");
  });

  test("smarturl.it routes as smart_link (live Shelter shape, Sep 19)", () => {
    // Measured: the canonical Shelter description carries exactly these —
    // missing the host meant the biggest tracks silently ripped.
    const links = extractAcquisitionLinks({
      description:
        "Spotify: http://smarturl.it/ShelterSpotify \niTunes: http://smarturl.it/ShelterDownload",
    });
    expect(links.map((l) => l.kind)).toStrictEqual([
      "smart_link",
      "smart_link",
    ]);
    expect(links[0]?.url).toBe("http://smarturl.it/ShelterSpotify");
  });

  test("scExtractionArgs: mp3 fallback stream-copies, AAC extracts to m4a", () => {
    // mp3→m4a would be a lossy→lossy re-encode — the archive refuses
    // double transcodes. The mp3 fallback lands original bytes.
    expect(scExtractionArgs("hls_mp3_0_1")).toStrictEqual([]);
    expect(scExtractionArgs("hls_aac_160k")).toStrictEqual([
      "-x",
      "--audio-format",
      "m4a",
      "--audio-quality",
      "0",
    ]);
    expect(scExtractionArgs("hls_aac_96k")).toStrictEqual([
      "-x",
      "--audio-format",
      "m4a",
      "--audio-quality",
      "0",
    ]);
    // Unknown format: extract to m4a (the safe default for AAC-family).
    expect(scExtractionArgs(null)).toStrictEqual([
      "-x",
      "--audio-format",
      "m4a",
      "--audio-quality",
      "0",
    ]);
  });

  test("no links at all → empty (the rip case)", () => {
    expect(
      extractAcquisitionLinks({ description: "just vibes https://x.com/a" }),
    ).toStrictEqual([]);
    expect(extractAcquisitionLinks({})).toStrictEqual([]);
  });
});

describe("rip decision (#256 — surface beats rip unless forced)", () => {
  const link: ScAcquisitionLink = {
    kind: "purchase_url",
    url: "https://fanlink.to/x",
  };

  test("a link surfaces; no link rips", () => {
    expect(ripDecision([link], false)).toStrictEqual({
      action: "surface",
      link,
    });
    expect(ripDecision([], false)).toStrictEqual({
      action: "rip",
      link: null,
    });
  });

  test("force-rip rips even with a link present", () => {
    expect(ripDecision([link], true)).toStrictEqual({
      action: "rip",
      link: null,
    });
  });
});

describe("likes/user cookie gate (#258 — private 404s name the remedy)", () => {
  test("only the likes/user kinds need the gate", () => {
    const likes: SyncSource = {
      kind: "sc-likes",
      url: "https://soundcloud.com/x/likes",
      label: SC_SOURCE,
    };
    const user: SyncSource = {
      kind: "sc-user",
      url: "https://soundcloud.com/x/tracks",
      label: SC_SOURCE,
    };
    const track: SyncSource = {
      kind: "sc-track",
      url: "https://soundcloud.com/a/b",
      label: SC_SOURCE,
    };
    const ytm: SyncSource = { kind: "ytm-playlist", id: "LM", label: "liked" };
    expect(scUserGateNeeded(likes)).toBe(true);
    expect(scUserGateNeeded(user)).toBe(true);
    expect(scUserGateNeeded(track)).toBe(false);
    expect(scUserGateNeeded(ytm)).toBe(false);
  });

  test("the private-page 404 shape is recognized (live stderr, Sep 19)", () => {
    expect(
      isPrivateUser404(
        "ERROR: [soundcloud:user] nichm44: Unable to download JSON metadata: HTTP Error 404: Not Found (caused by <HTTPError 404: Not Found>)",
      ),
    ).toBe(true);
    // A plain track 404 is NOT the private-user shape.
    expect(
      isPrivateUser404("ERROR: [soundcloud] a/b: HTTP Error 404: Not Found"),
    ).toBe(false);
    expect(isPrivateUser404("connection reset")).toBe(false);
  });
});

describe("the SC source value stays the ledger constant", () => {
  test("SC_SOURCE is 'soundcloud' (the LOWQ floors key off it)", () => {
    expect(SC_SOURCE).toBe("soundcloud");
  });
});
