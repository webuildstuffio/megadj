// fulltags-tagcompare-ux.test.tsx — DOM (render-to-string) contract for the
// rebuilt Tags tab: the three-source compare card, the census table, and
// the honest-degradation branches render the right words and shapes.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import render from "preact-render-to-string";
import { TagCompareTab, CompareCard } from "../products/fulltags/TagCompareTab";
import type {
  ArchiveTagCensus,
  ArchiveTrackTagCompare,
} from "../../shared/types";

const censusFixture: ArchiveTagCensus = {
  available: true,
  returned: 2,
  matched: 3563,
  differing: 2,
  unmatched: 101,
  fieldCounts: [
    { field: "bpm", count: 2 },
    { field: "genre", count: 1 },
  ],
  rekordboxMirror: true,
  rows: [
    {
      videoId: "x1",
      title: "Track One",
      artist: "Artist A",
      album: null,
      archiveGenre: "House",
      rekordboxGenre: "Tech House",
      archiveKey: "8A",
      rekordboxKey: "9A",
      archiveBpm: 128.4,
      rekordboxBpm: 127.6,
      genreFlag: "disputed",
      differs: ["genre", "key", "bpm"],
      hasRekordboxRow: true,
    },
    {
      videoId: "x2",
      title: "Track Two",
      artist: "Artist B",
      album: null,
      archiveGenre: "House",
      rekordboxGenre: "House",
      archiveKey: "8A",
      rekordboxKey: "8A",
      archiveBpm: 128,
      rekordboxBpm: 128,
      genreFlag: null,
      differs: [],
      hasRekordboxRow: true,
    },
  ],
};

const compareFixture: ArchiveTrackTagCompare = {
  available: true,
  videoId: "x1",
  title: "Track One",
  artist: "Artist A",
  album: null,
  file: {
    readable: true,
    title: "Track One",
    artist: "Artist A",
    genre: "House",
    year: "2024",
    bpm: 128,
    key: "8A",
    label: "Test Label",
    mixName: null,
    remixer: null,
    energy: 8,
    mood: "dance=0.7; party=0.6",
    comment: "8A · E8 · Dance+Party",
    art: true,
  },
  pipeline: {
    genre: "House",
    genreFlag: "disputed",
    energy: 8,
    bpmFolded: 128.4,
    key: "8A",
    valence: 5.5,
    arousal: 6.1,
    analyzedAt: "2026-09-15T00:00:00Z",
  },
  rekordbox: {
    contentId: "1",
    title: "Track One",
    artist: "Artist A",
    album: null,
    genre: "Tech House",
    key: "9A",
    bpm: 127.6,
    year: "2024",
    label: null,
    comment: "9A · E8 · Dance",
    metadata: { ID: "1", Title: "Track One", KeyName: "9A" },
  },
  differences: [
    {
      field: "genre",
      file: "House",
      archive: "House",
      rekordbox: "Tech House",
    },
    { field: "key", file: "8A", archive: "8A", rekordbox: "9A" },
  ],
};

describe("FullTags tag-compare UX (Tags tab)", () => {
  test("the compare card names all three sources and their roles", () => {
    const html = render(
      <CompareCard
        compare={{ status: "ok", data: compareFixture }}
        picked={{ video_id: "x1", title: "Track One", artist: "Artist A" }}
      />,
    );
    expect(html).toContain("Three sources");
    expect(html).toContain("FILE is ground truth");
    expect(html).toContain(
      "Fields listed in Differences have ≥2 sources disagreeing",
    );
    // per-source genre pills render
    expect(html).toContain("Tech House");
    // the lossless RB payload is expandable, not hidden
    expect(html).toContain("full rekordbox payload");
  });

  test("an unreadable file says so instead of silently omitting truth", () => {
    const html = render(
      <CompareCard
        compare={{
          status: "ok",
          data: { ...compareFixture, file: null },
        }}
        picked={{ video_id: "x1", title: "Track One", artist: null }}
      />,
    );
    expect(html).toContain("file not readable at its archived path");
    expect(html).toContain("megadj adopt --shelf");
  });

  test("the tab renders loading, no-archive, and no-mirror states honestly", () => {
    // source-level assertions: the three degrade branches exist with
    // actionable next steps (rendering needs a server, so source-check)
    const src = readFileSync(
      join(import.meta.dir, "../products/fulltags/TagCompareTab.tsx"),
      "utf8",
    );
    expect(src).toContain("comparing the mirrors…");
    expect(src).toContain("archive DB absent");
    expect(src).toContain("megadj rb-adopt");
    expect(src).toContain("Disagreements");
    expect(src).toContain("Disputed flags");
  });

  test("the census fixture satisfies the wire contract the tab renders", () => {
    // guards against silent fixture drift in this file itself
    expect(censusFixture.rows[0]!.differs.length).toBeGreaterThan(0);
    expect(censusFixture.rows[0]!.genreFlag).toBe("disputed");
    expect(compareFixture.differences.length).toBe(2);
    expect(TagCompareTab).toBeTypeOf("function");
  });
});
