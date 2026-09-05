import { describe, expect, it } from "bun:test";
import { driveCompatibility, playersFromConfig, PLAYERS } from "../src/players";
import type { SnapshotData } from "../shared/types";

function snap(over: Partial<SnapshotData> = {}): SnapshotData {
  return {
    kind: "full",
    taken_at: 1,
    pdb_live_rows: 3500,
    onelibrary_rows: 3500,
    ...over,
  } as SnapshotData;
}

describe("players (N75/N78)", () => {
  it("vendor matrix covers both library formats", () => {
    const device = PLAYERS.filter((p) => p.reads === "device");
    const onelib = PLAYERS.filter((p) => p.reads === "onelibrary");
    expect(device.length).toBeGreaterThanOrEqual(8); // XZ, 3000, RX3, RR, MK2, 700, NXS2, NXS
    expect(onelib.length).toBeGreaterThanOrEqual(4); // AZ, OPUS, OMNIS, 3000X
    expect(device.some((p) => p.name === "XDJ-XZ")).toBe(true);
    expect(onelib.some((p) => p.name === "XDJ-AZ")).toBe(true);
  });

  it("current dual-DB drive plays everywhere", () => {
    const c = driveCompatibility(snap());
    expect(c.unknown).toBe(false);
    expect(c.blocked).toEqual([]);
    expect(c.ok.length).toBe(PLAYERS.length);
  });

  it("stale pdb blocks device players with the measured reason", () => {
    const c = driveCompatibility(snap({ pdb_live_rows: 3000 }));
    expect(c.ok.every((p) => p.reads === "onelibrary")).toBe(true);
    const blockedNames = c.blocked.map((b) => b.player.name);
    expect(blockedNames).toContain("XDJ-XZ");
    expect(c.blocked[0]!.reason).toContain("stale");
    // and the OneLibrary half still reads fine
    expect(c.ok.map((p) => p.name)).toContain("XDJ-AZ");
  });

  it("small pdb drift within tolerance stays pass", () => {
    // 3480 vs 3500 = 0.57% — mid-sync drift, not a stale export
    const c = driveCompatibility(snap({ pdb_live_rows: 3480 }));
    expect(c.blocked).toEqual([]);
  });

  it("OneLibrary-only content is invisible to the XZ fleet", () => {
    const c = driveCompatibility(snap({ pdb_live_rows: 0 }));
    expect(c.ok.map((p) => p.name)).toEqual([
      "CDJ-3000X",
      "XDJ-AZ",
      "OPUS-QUAD",
      "OMNIS-DUO",
    ]);
    expect(c.ok.every((p) => p.reads === "onelibrary")).toBe(true);
    expect(c.blocked.length).toBe(PLAYERS.length - 4);
  });

  it("no db data → unknown, no fake verdict", () => {
    const c = driveCompatibility(null);
    expect(c.unknown).toBe(true);
    expect(c.ok).toEqual([]);
    expect(c.blocked).toEqual([]);
  });

  it("user-defined players extend the matrix; invalid entries are skipped", () => {
    expect(playersFromConfig({ "MY-XDJ": "device", junk: "wat" })).toEqual([
      { name: "MY-XDJ", reads: "device" },
    ]);
    expect(playersFromConfig(undefined)).toEqual([]);
    const c = driveCompatibility(snap({ onelibrary_rows: 0 }), [
      { name: "MY-XDJ", reads: "device" },
    ]);
    expect(c.ok.map((p) => p.name)).toContain("MY-XDJ");
  });
});
