import { describe, it, expect } from "bun:test";
import { driveBadges, syncBadge, rankBadges } from "../shared/badges";
import type { Badge, Drive, SnapshotData } from "../shared/types";

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
    verify_report_json: null,
    link_bps: null,
    ...over,
  };
}

describe("badges", () => {
  it("ghost when unmounted", () => {
    const b = driveBadges(drive({ mounted: false, state: "ghost" }));
    expect(b[0]?.key).toBe("ghost");
  });

  it("SHELF: verify-failed beats archive-ready; no grids badge; no changed-since", () => {
    // the Sep 10 complaint: the shelf card showed "changed since verify"
    // + "grids 0%" — gig-stick badges on archive storage
    const snap: SnapshotData = {
      kind: "light",
      taken_at: 1,
      file_count: 3550,
      grid_coverage: 0,
      db_mtime: 10_000, // changed long after verify
      pdb_mtime: 10_000,
    };
    const b = driveBadges(
      drive({
        role: "shelf",
        name: "SHELF1",
        last_snapshot_json: JSON.stringify(snap),
      }),
      { latestVerify: { ran_at: 5_000, ok: false } },
    );
    expect(b.some((x) => x.key === "attn" && x.label === "verify failed")).toBe(
      true,
    );
    expect(b.some((x) => x.label === "changed since verify")).toBe(false);
    expect(b.some((x) => x.label.startsWith("grids"))).toBe(false);
  });

  it("SHELF: passing verify reads archive-ready regardless of db churn", () => {
    const snap: SnapshotData = {
      kind: "light",
      taken_at: 1,
      file_count: 3550,
      db_mtime: 10_000,
      pdb_mtime: 0,
    };
    const b = driveBadges(
      drive({
        role: "shelf",
        name: "SHELF1",
        last_snapshot_json: JSON.stringify(snap),
      }),
      { latestVerify: { ran_at: 5_000, ok: true } },
    );
    expect(b.some((x) => x.label === "archive ready")).toBe(true);
    expect(b.some((x) => x.label === "changed since verify")).toBe(false);
  });

  it("gig sticks keep changed-since + grids badges (matrix is shelf-only)", () => {
    const snap: SnapshotData = {
      kind: "light",
      taken_at: 1,
      file_count: 3500,
      grid_coverage: 0.9,
      db_mtime: 10_000,
    };
    const b = driveBadges(drive({ last_snapshot_json: JSON.stringify(snap) }), {
      latestVerify: { ran_at: 5_000, ok: true },
    });
    expect(b.some((x) => x.label === "changed since verify")).toBe(true);
    expect(b.some((x) => x.label === "grids 90%")).toBe(true);
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

  // USB link class badges (Sep 10 sweep: SHELF1's 6h relocate question)
  it("USB3 link shows a good badge at 5G", () => {
    const b = driveBadges(drive({ link_bps: 5_000_000_000 }));
    expect(b.some((x) => x.label === "USB3" && x.tone === "good")).toBe(true);
  });

  it("10G link shows the fast label", () => {
    const b = driveBadges(drive({ link_bps: 10_000_000_000 }));
    expect(b.some((x) => x.label === "USB3 10G")).toBe(true);
  });

  it("USB2 link is a warn badge, not a silent pass", () => {
    const b = driveBadges(drive({ link_bps: 480_000_000 }));
    expect(b.some((x) => x.label === "USB 2.0 link" && x.tone === "warn")).toBe(
      true,
    );
  });

  it("no link data = no link badge (honest unknown)", () => {
    const b = driveBadges(drive({ link_bps: null }));
    expect(b.some((x) => x.label.includes("USB"))).toBe(false);
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

  // REGRESSION (fallback-slop pass): a corrupt snapshot blob used to throw
  // inside driveBadges — one bad row 500'd every /api/status and /api/drives
  // request (the whole drive rail). Corruption must surface as a badge.
  it("corrupt snapshot blob → visible badge, not a throw", () => {
    const d = drive({ last_snapshot_json: "{corrupt json" });
    expect(() => driveBadges(d, {})).not.toThrow();
    const badges = driveBadges(d, {});
    expect(
      badges.some((b) => b.key === "attn" && b.label === "snapshot corrupt"),
    ).toBe(true);
  });

  it("snapshot blob parsing to a non-object → corrupt badge, not a throw", () => {
    const d = drive({ last_snapshot_json: "null" });
    expect(() => driveBadges(d, {})).not.toThrow();
    expect(driveBadges(d, {}).some((b) => b.label === "snapshot corrupt")).toBe(
      true,
    );
  });

  it("syncBadge on corrupt blob → corrupt badge (never a false in-sync)", () => {
    const b = syncBadge(
      drive({ role: "mirror", last_snapshot_json: "garbage{" }),
      masterSnap,
    );
    expect(b?.key).toBe("attn");
    expect(b?.label).toBe("snapshot corrupt");
  });

  it("null blob is absent, not corrupt", () => {
    const badges = driveBadges(drive(), {});
    expect(badges.some((b) => b.label === "snapshot corrupt")).toBe(false);
  });
});

describe("rankBadges", () => {
  const b = (key: Badge["key"], label?: string): Badge => ({
    key,
    label: label ?? key,
    tone: "muted",
  });

  it("ranks failures above warnings above ready — worst first", () => {
    const { top } = rankBadges(
      [b("ready"), b("attn", "verify failed"), b("stale"), b("insync")],
      3,
    );
    expect(top.map((x) => x.key)).toEqual(["attn", "stale", "insync"]);
  });

  it("caps at 3 and counts the overflow", () => {
    const r = rankBadges(
      [b("attn"), b("stale"), b("unknown"), b("insync"), b("ready")],
      3,
    );
    expect(r.top).toHaveLength(3);
    expect(r.extra).toHaveLength(2);
    expect(r.extra.map((x) => x.key)).toEqual(["insync", "ready"]);
  });

  it("equal ranks keep insertion order (stable)", () => {
    const { top } = rankBadges([b("attn", "first"), b("attn", "second")], 3);
    expect(top.map((x) => x.label)).toEqual(["first", "second"]);
  });

  it("fewer than cap → nothing dropped", () => {
    const r = rankBadges([b("ready")], 3);
    expect(r.top).toHaveLength(1);
    expect(r.extra).toHaveLength(0);
  });
});
