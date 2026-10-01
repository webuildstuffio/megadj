/**
 * energy-features.test.ts — Tests for energy v3.1 DB schema + parsing.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  migrateEnergyTables,
  upsertEnergyFeatures,
  loadAllEnergyFeatures,
  energyFeatureCount,
  parseExtractLine,
  extractResultToRow,
  type EnergyFeatureRow,
} from "./energy-features";

let db: Database;

afterEach(() => {
  db?.close();
});

function openDb(): Database {
  db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL;");
  migrateEnergyTables(db);
  return db;
}

function fullRow(overrides: Partial<EnergyFeatureRow> = {}): EnergyFeatureRow {
  return {
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
    ...overrides,
  };
}

// --------------- schema ---------------

describe("energy_features schema", () => {
  test("migration is idempotent", () => {
    const d = openDb();
    migrateEnergyTables(d);
    migrateEnergyTables(d);
    expect(energyFeatureCount(d)).toBe(0);
  });

  test("energy_reference table is also created", () => {
    const d = openDb();
    const tables = d
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("energy_features");
    expect(names).toContain("energy_reference");
  });

  test("upsert + load round-trip", () => {
    const d = openDb();
    upsertEnergyFeatures(d, fullRow());
    expect(energyFeatureCount(d)).toBe(1);
    const rows = loadAllEnergyFeatures(d);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.videoId).toBe("v1");
    expect(rows[0]!.bpm).toBe(128);
    expect(rows[0]!.aggressive).toBe(0.6);
    expect(rows[0]!.lowDropContrast).toBe(false);
  });

  test("upsert replaces existing row", () => {
    const d = openDb();
    upsertEnergyFeatures(d, fullRow());
    upsertEnergyFeatures(d, fullRow({ bpm: 140, aggressive: 0.8 }));
    expect(energyFeatureCount(d)).toBe(1);
    const rows = loadAllEnergyFeatures(d);
    expect(rows[0]!.bpm).toBe(140);
    expect(rows[0]!.aggressive).toBe(0.8);
  });

  test("lowDropContrast false → 0, true → 1 round-trip", () => {
    const d = openDb();
    upsertEnergyFeatures(d, fullRow({ videoId: "f", lowDropContrast: false }));
    upsertEnergyFeatures(d, fullRow({ videoId: "t", lowDropContrast: true }));
    const rows = loadAllEnergyFeatures(d);
    const f = rows.find((r) => r.videoId === "f");
    const t = rows.find((r) => r.videoId === "t");
    expect(f!.lowDropContrast).toBe(false);
    expect(t!.lowDropContrast).toBe(true);
  });

  test("loadAllEnergyFeatures returns [] on empty table", () => {
    const d = openDb();
    expect(loadAllEnergyFeatures(d)).toEqual([]);
  });

  test("upsert with null fields", () => {
    const d = openDb();
    upsertEnergyFeatures(d, fullRow({ aggressive: null, engagement: null }));
    const rows = loadAllEnergyFeatures(d);
    expect(rows[0]!.aggressive).toBeNull();
    expect(rows[0]!.engagement).toBeNull();
  });

  test("multiple rows load in order", () => {
    const d = openDb();
    for (let i = 0; i < 5; i++) {
      upsertEnergyFeatures(d, fullRow({ videoId: `v${i}`, bpm: 100 + i }));
    }
    expect(energyFeatureCount(d)).toBe(5);
    const rows = loadAllEnergyFeatures(d);
    expect(rows).toHaveLength(5);
  });
});

// --------------- parseExtractLine ---------------

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
    expect(r!.error).toBeUndefined();
  });

  test("error line", () => {
    const line = JSON.stringify({ path: "/a/b.mp3", error: "too short" });
    const r = parseExtractLine(line);
    expect(r).not.toBeNull();
    expect(r!.error).toBe("too short");
    expect(r!.features).toBeUndefined();
  });

  test("error takes priority over features", () => {
    const line = JSON.stringify({
      path: "/a.mp3",
      error: "something broke",
      features: { bpm: 128 },
    });
    const r = parseExtractLine(line);
    expect(r).not.toBeNull();
    expect(r!.error).toBe("something broke");
  });

  test("empty line → null", () => {
    expect(parseExtractLine("")).toBeNull();
    expect(parseExtractLine("   ")).toBeNull();
    expect(parseExtractLine("\n")).toBeNull();
  });

  test("invalid JSON → null", () => {
    expect(parseExtractLine("{bad json")).toBeNull();
    expect(parseExtractLine("not json at all")).toBeNull();
  });

  test("missing path → null", () => {
    expect(parseExtractLine(JSON.stringify({ bpm: 128 }))).toBeNull();
  });

  test("non-string path → null", () => {
    expect(parseExtractLine(JSON.stringify({ path: 42 }))).toBeNull();
  });

  test("path with no features and no error → error result", () => {
    const r = parseExtractLine(JSON.stringify({ path: "/a.mp3" }));
    expect(r).not.toBeNull();
    expect(r!.error).toBe("missing features");
  });

  test("features = null → error result", () => {
    const r = parseExtractLine(
      JSON.stringify({ path: "/a.mp3", features: null }),
    );
    expect(r).not.toBeNull();
    expect(r!.error).toBe("missing features");
  });
});

// --------------- extractResultToRow ---------------

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
    expect(row.hfEnergyReLufs).toBe(-20);
    expect(row.lowDropContrast).toBe(true);
    expect(row.dropStartS).toBe(60);
    expect(row.dropEndS).toBe(90);
  });

  test("lowDropContrast false", () => {
    const row = extractResultToRow("vid2", {
      onsets_per_beat: 1,
      bpm: 90,
      hf_energy_re_lufs: -25,
      low_energy_re_lufs: -20,
      crest_factor: -8,
      spectral_flux: 0.1,
      lufs_drop: -18,
      spectral_centroid: 2000,
      aggressive: 0.1,
      engagement: 0.2,
      approachability: 0.9,
      arousal_drop: 3.0,
      drop_start_s: 30,
      drop_end_s: 60,
      drop_contrast_db: 2,
      low_drop_contrast: false,
    });
    expect(row.lowDropContrast).toBe(false);
  });
});
