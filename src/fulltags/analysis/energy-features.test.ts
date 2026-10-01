/**
 * energy-features.test.ts — Tests for energy v3.1 DB schema + parsing.
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  migrateEnergyTables,
  upsertEnergyFeatures,
  loadAllEnergyFeatures,
  energyFeatureCount,
  parseExtractLine,
  extractResultToRow,
} from "./energy-features";

function testDb(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL;");
  migrateEnergyTables(db);
  return db;
}

describe("energy_features schema", () => {
  test("migration is idempotent", () => {
    const db = testDb();
    migrateEnergyTables(db);
    expect(energyFeatureCount(db)).toBe(0);
    db.close();
  });

  test("upsert + load round-trip", () => {
    const db = testDb();
    upsertEnergyFeatures(db, {
      videoId: "v1",
      onsetsPerBeat: 2.5,
      bpm: 128,
      hfEnergyReLufs: -20,
      lowEnergyReLufs: -15,
      crestFactor: -5,
      spectralFlux: 0.3,
      lufsDrop: -14,
      spectralCentroid: 3000,
      aggressive: 0.6,
      engagement: 0.7,
      approachability: 0.4,
      arousalDrop: 6.5,
      dropStartS: 60,
      dropEndS: 90,
      dropContrastDb: 8,
      lowDropContrast: false,
    });
    expect(energyFeatureCount(db)).toBe(1);
    const rows = loadAllEnergyFeatures(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.videoId).toBe("v1");
    expect(rows[0]!.bpm).toBe(128);
    expect(rows[0]!.aggressive).toBe(0.6);
    expect(rows[0]!.lowDropContrast).toBe(false);
    db.close();
  });

  test("upsert replaces existing row", () => {
    const db = testDb();
    upsertEnergyFeatures(db, {
      videoId: "v1",
      onsetsPerBeat: 2.5,
      bpm: 128,
      hfEnergyReLufs: -20,
      lowEnergyReLufs: -15,
      crestFactor: -5,
      spectralFlux: 0.3,
      lufsDrop: -14,
      spectralCentroid: 3000,
      aggressive: 0.6,
      engagement: 0.7,
      approachability: 0.4,
      arousalDrop: 6.5,
      dropStartS: 60,
      dropEndS: 90,
      dropContrastDb: 8,
      lowDropContrast: false,
    });
    upsertEnergyFeatures(db, {
      videoId: "v1",
      onsetsPerBeat: 3.0,
      bpm: 140,
      hfEnergyReLufs: -18,
      lowEnergyReLufs: -12,
      crestFactor: -3,
      spectralFlux: 0.5,
      lufsDrop: -12,
      spectralCentroid: 4000,
      aggressive: 0.8,
      engagement: 0.9,
      approachability: 0.2,
      arousalDrop: 8.0,
      dropStartS: 50,
      dropEndS: 80,
      dropContrastDb: 12,
      lowDropContrast: false,
    });
    expect(energyFeatureCount(db)).toBe(1);
    const rows = loadAllEnergyFeatures(db);
    expect(rows[0]!.bpm).toBe(140);
    db.close();
  });
});

describe("parseExtractLine", () => {
  test("valid features line", () => {
    const line = JSON.stringify({
      path: "/a/b.mp3",
      features: {
        onsets_per_beat: 2.5,
        bpm: 128,
        hf_energy_re_lufs: -20,
        low_energy_re_lufs: -15,
        crest_factor: -5,
        spectral_flux: 0.3,
        lufs_drop: -14,
        spectral_centroid: 3000,
        aggressive: 0.6,
        engagement: 0.7,
        approachability: 0.4,
        arousal_drop: 6.5,
        drop_start_s: 60,
        drop_end_s: 90,
        drop_contrast_db: 8,
        low_drop_contrast: false,
      },
    });
    const r = parseExtractLine(line);
    expect(r).not.toBeNull();
    expect(r!.features).toBeDefined();
    expect(r!.features!.bpm).toBe(128);
  });

  test("error line", () => {
    const line = JSON.stringify({ path: "/a/b.mp3", error: "too short" });
    const r = parseExtractLine(line);
    expect(r).not.toBeNull();
    expect(r!.error).toBe("too short");
  });

  test("empty line → null", () => {
    expect(parseExtractLine("")).toBeNull();
    expect(parseExtractLine("   ")).toBeNull();
  });

  test("invalid JSON → null", () => {
    expect(parseExtractLine("{bad json")).toBeNull();
  });
});

describe("extractResultToRow", () => {
  test("maps snake_case → camelCase", () => {
    const row = extractResultToRow("vid1", {
      onsets_per_beat: 2.5,
      bpm: 128,
      hf_energy_re_lufs: -20,
      low_energy_re_lufs: -15,
      crest_factor: -5,
      spectral_flux: 0.3,
      lufs_drop: -14,
      spectral_centroid: 3000,
      aggressive: 0.6,
      engagement: 0.7,
      approachability: 0.4,
      arousal_drop: 6.5,
      drop_start_s: 60,
      drop_end_s: 90,
      drop_contrast_db: 8,
      low_drop_contrast: true,
    });
    expect(row.videoId).toBe("vid1");
    expect(row.onsetsPerBeat).toBe(2.5);
    expect(row.lowDropContrast).toBe(true);
  });
});
