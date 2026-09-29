/**
 * bar-features.test.ts — Tests for per-bar feature store (B2.1).
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  barFeatureCount,
  barFeatureTrackIds,
  loadBarFeatures,
  migrateBarFeaturesTable,
  upsertBarFeatures,
  type TrackBarFeatures,
} from "./bar-features";

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrateBarFeaturesTable(db);
});

afterEach(() => {
  db.close();
});

function makeTrack(
  videoId: string,
  barCount: number,
  pcaVersion = "v1",
): TrackBarFeatures {
  return {
    videoId,
    pcaVersion,
    barCount,
    bars: Array.from({ length: barCount }, (_, i) => ({
      barIndex: i,
      startTime: i * 2.0,
      endTime: (i + 1) * 2.0,
      embedding: `emb-${i}`,
      lufs: -14 + i * 0.5,
      onsetDensity: 3 + i * 0.1,
      lowBandShare: 0.3 + i * 0.01,
      spectralFlux: 0.5 + i * 0.02,
    })),
  };
}

describe("migrateBarFeaturesTable", () => {
  test("creates table idempotently", () => {
    migrateBarFeaturesTable(db);
    migrateBarFeaturesTable(db);
    const tables = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='bar_features'",
      )
      .all();
    expect(tables).toHaveLength(1);
  });
});

describe("upsertBarFeatures", () => {
  test("inserts bars for a track", () => {
    const track = makeTrack("vid1", 10);
    const count = upsertBarFeatures(db, track);
    expect(count).toBe(10);
  });

  test("replaces on re-insert", () => {
    upsertBarFeatures(db, makeTrack("vid1", 10));
    upsertBarFeatures(db, makeTrack("vid1", 5));
    const loaded = loadBarFeatures(db, "vid1");
    expect(loaded).not.toBeNull();
    expect(loaded!.barCount).toBe(5);
  });

  test("returns 0 for empty bars", () => {
    expect(
      upsertBarFeatures(db, {
        videoId: "vid1",
        pcaVersion: "v1",
        barCount: 0,
        bars: [],
      }),
    ).toBe(0);
  });
});

describe("loadBarFeatures", () => {
  test("returns null for missing track", () => {
    expect(loadBarFeatures(db, "nonexistent")).toBeNull();
  });

  test("round-trips all fields", () => {
    const track = makeTrack("vid1", 3);
    upsertBarFeatures(db, track);
    const loaded = loadBarFeatures(db, "vid1")!;
    expect(loaded.videoId).toBe("vid1");
    expect(loaded.pcaVersion).toBe("v1");
    expect(loaded.barCount).toBe(3);
    expect(loaded.bars[0]!.startTime).toBe(0);
    expect(loaded.bars[0]!.endTime).toBe(2);
    expect(loaded.bars[0]!.embedding).toBe("emb-0");
    expect(loaded.bars[0]!.lufs).toBe(-14);
    expect(loaded.bars[2]!.barIndex).toBe(2);
  });
});

describe("barFeatureCount", () => {
  test("counts distinct tracks", () => {
    expect(barFeatureCount(db)).toBe(0);
    upsertBarFeatures(db, makeTrack("vid1", 5));
    upsertBarFeatures(db, makeTrack("vid2", 3));
    expect(barFeatureCount(db)).toBe(2);
  });
});

describe("barFeatureTrackIds", () => {
  test("returns sorted track IDs", () => {
    upsertBarFeatures(db, makeTrack("z-vid", 2));
    upsertBarFeatures(db, makeTrack("a-vid", 2));
    expect(barFeatureTrackIds(db)).toEqual(["a-vid", "z-vid"]);
  });
});
