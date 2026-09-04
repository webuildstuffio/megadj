import { describe, it, expect } from "bun:test";
import { driveBadges, syncBadge } from "../shared/badges";
import type { Drive, SnapshotData } from "../shared/types";

function drive(over: Partial<Drive> = {}): Drive {
  return {
    id: "x",
    volume_uuid: "x",
    name: "CRATE",
    nickname: null,
    photo_path: null,
    capacity_bytes: 128e9,
    fs: "FAT32",
    vendor: null,
    model: null,
    usb_serial: null,
    role: "unknown",
    first_seen_at: 1,
    last_seen_at: 2,
    last_port_key: null,
    plug_count: 1,
    mounted: true,
    state: "mounted",
    last_snapshot_json: null,
    predecessor_id: null,
    ...over,
  };
}

describe("badges", () => {
  it("ghost when unmounted", () => {
    const b = driveBadges(drive({ mounted: false, state: "ghost" }));
    expect(b[0].key).toBe("ghost");
  });

  it("attn on junk in latest scan", () => {
    const snap: SnapshotData = {
      kind: "light",
      taken_at: 1,
      file_count: 5,
      junk: {
        zero_byte: ["bad.m4a"],
        case_collisions: [],
        orphan_resource_forks: 0,
      },
    };
    const b = driveBadges(drive({ last_snapshot_json: JSON.stringify(snap) }));
    expect(b.some((x) => x.key === "attn")).toBe(true);
  });

  it("ready when verified after last change", () => {
    const snap: SnapshotData = {
      kind: "full",
      taken_at: 1,
      db_mtime: 100,
      pdb_mtime: 100,
    };
    const b = driveBadges(drive({ last_snapshot_json: JSON.stringify(snap) }), {
      latestVerify: { ran_at: 200, ok: true },
    });
    expect(b.some((x) => x.key === "ready")).toBe(true);
  });

  it("stale when changed since verify", () => {
    const snap: SnapshotData = {
      kind: "full",
      taken_at: 1,
      db_mtime: 300,
      pdb_mtime: 100,
    };
    const b = driveBadges(drive({ last_snapshot_json: JSON.stringify(snap) }), {
      latestVerify: { ran_at: 200, ok: true },
    });
    expect(b.some((x) => x.key === "stale")).toBe(true);
  });

  it("attn when verify failed", () => {
    const snap: SnapshotData = { kind: "full", taken_at: 1, db_mtime: 100 };
    const b = driveBadges(drive({ last_snapshot_json: JSON.stringify(snap) }), {
      latestVerify: { ran_at: 200, ok: false },
    });
    expect(b.some((x) => x.key === "attn" && x.label === "verify failed")).toBe(
      true,
    );
  });

  it("never-verified when no verify history", () => {
    const snap: SnapshotData = { kind: "light", taken_at: 1, file_count: 3 };
    const b = driveBadges(drive({ last_snapshot_json: JSON.stringify(snap) }));
    expect(b.some((x) => x.key === "unknown")).toBe(true);
  });

  it("grid coverage badge", () => {
    const snap: SnapshotData = {
      kind: "full",
      taken_at: 1,
      grid_coverage: 0.93,
    };
    const b = driveBadges(drive({ last_snapshot_json: JSON.stringify(snap) }));
    expect(b.some((x) => x.key === "stale" && x.label === "grids 93%")).toBe(
      true,
    );
  });
});

describe("syncBadge", () => {
  const masterSnap: SnapshotData = {
    kind: "light",
    taken_at: 1,
    file_count: 100,
  };

  it("in-sync for superset mirror", () => {
    const mine: SnapshotData = { kind: "light", taken_at: 1, file_count: 157 };
    const b = syncBadge(
      drive({ role: "mirror", last_snapshot_json: JSON.stringify(mine) }),
      masterSnap,
    );
    expect(b?.key).toBe("insync");
  });

  it("behind with missing count", () => {
    const mine: SnapshotData = { kind: "light", taken_at: 1, file_count: 80 };
    const b = syncBadge(
      drive({ role: "mirror", last_snapshot_json: JSON.stringify(mine) }),
      masterSnap,
    );
    expect(b?.key).toBe("behind");
    expect(b?.label).toContain("20");
  });

  it("unknown without data", () => {
    const b = syncBadge(drive({ role: "mirror" }), masterSnap);
    expect(b?.key).toBe("unknown");
  });
});
