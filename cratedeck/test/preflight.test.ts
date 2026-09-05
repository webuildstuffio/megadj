import { describe, expect, it } from "bun:test";
import {
  buildPreflight,
  preflightForDrive,
  type PreflightInput,
} from "../src/preflight";
import type { Drive, SnapshotData } from "../shared/types";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

function drive(over: Partial<Drive> = {}): Drive {
  return {
    id: "d1",
    volume_uuid: "u1",
    name: "DJMASTER",
    nickname: null,
    photo_path: null,
    capacity_bytes: 1_000_000_000_000,
    fs: "exfat",
    vendor: null,
    model: null,
    usb_serial: null,
    role: "master",
    first_seen_at: 0,
    last_seen_at: NOW,
    last_port_key: null,
    plug_count: 3,
    mounted: true,
    state: "mounted",
    last_snapshot_json: null,
    predecessor_id: null,
    verify_report_json: null,
    ...over,
  };
}

function snap(over: Partial<SnapshotData> = {}): SnapshotData {
  return {
    kind: "full",
    taken_at: NOW - DAY,
    capacity_bytes: 1_000_000_000_000,
    free_bytes: 500_000_000_000,
    file_count: 3500,
    track_count: 3500,
    grid_coverage: 1,
    pdb_live_rows: 3500,
    onelibrary_rows: 3500,
    db_mtime: NOW - DAY,
    pdb_mtime: NOW - DAY,
    ...over,
  } as SnapshotData;
}

function input(over: Partial<PreflightInput> = {}): PreflightInput {
  return {
    drive: drive(),
    snapshot: snap(),
    latestVerify: { ran_at: NOW - DAY, ok: true },
    bench: [],
    latestChecksum: null,
    ledgerFiles: 0,
    masterSnapshot: null,
    isMirror: false,
    now: NOW,
    ...over,
  };
}

function byId(res: ReturnType<typeof preflightForDrive>, id: string) {
  return res.checks.find((c) => c.id === id);
}

describe("preflight (B12)", () => {
  it("clean drive with data on every check → ready", () => {
    const r = preflightForDrive(
      input({
        latestChecksum: { ran_at: NOW - DAY, changed: 0 },
        ledgerFiles: 3500,
        bench: [{ ran_at: NOW - 2 * DAY, seq_mbps: 90 }],
      }),
    );
    expect(r.overall).toBe("ready");
    expect(r.blockers).toEqual([]);
  });

  it("dual-db mismatch is a blocker (players see a stale library)", () => {
    const r = preflightForDrive(
      input({ snapshot: snap({ pdb_live_rows: 3400 }) }),
    );
    expect(r.overall).toBe("not-ready");
    expect(r.blockers.some((b) => b.startsWith("Hardware library"))).toBe(true);
  });

  it("failed verify is a blocker", () => {
    const r = preflightForDrive(
      input({ latestVerify: { ran_at: NOW - DAY, ok: false } }),
    );
    expect(r.overall).toBe("not-ready");
  });

  it("verify older than a week warns even when it passed", () => {
    const r = preflightForDrive(
      input({ latestVerify: { ran_at: NOW - 8 * DAY, ok: true } }),
    );
    expect(byId(r, "verify")?.status).toBe("warn");
    expect(r.overall).toBe("attention");
  });

  it("library changed after the last verify → warn, not stale-pass", () => {
    const r = preflightForDrive(
      input({
        snapshot: snap({ db_mtime: NOW - 3_600_000 }),
      }),
    );
    expect(byId(r, "verify")?.status).toBe("warn");
  });

  it("benchmark drop >40% between runs fails (B13's rule)", () => {
    const r = preflightForDrive(
      input({
        bench: [
          { ran_at: NOW - 2 * DAY, seq_mbps: 100 },
          { ran_at: NOW - DAY, seq_mbps: 55 },
        ],
      }),
    );
    expect(byId(r, "speed")?.status).toBe("fail");
    expect(r.overall).toBe("not-ready");
  });

  it("single slow benchmark run fails on the absolute CDJ floor", () => {
    const r = preflightForDrive(
      input({ bench: [{ ran_at: NOW - DAY, seq_mbps: 20 }] }),
    );
    expect(byId(r, "speed")?.status).toBe("fail");
  });

  it("bitrot: checksum job reporting changed files blocks the drive", () => {
    const r = preflightForDrive(
      input({
        ledgerFiles: 3500,
        latestChecksum: { ran_at: NOW - DAY, changed: 2 },
      }),
    );
    expect(r.overall).toBe("not-ready");
    expect(byId(r, "bitrot")?.detail).toContain("2 file(s)");
  });

  it("low free space: <5% fails, <15% warns", () => {
    const fail = preflightForDrive(
      input({ snapshot: snap({ free_bytes: 30_000_000_000 }) }),
    );
    expect(byId(fail, "space")?.status).toBe("fail");
    const warn = preflightForDrive(
      input({ snapshot: snap({ free_bytes: 100_000_000_000 }) }),
    );
    expect(byId(warn, "space")?.status).toBe("warn");
    expect(warn.overall).toBe("attention");
  });

  it("grid coverage: 99%+ pass, 90–99% warn, <90% fail", () => {
    expect(
      byId(
        preflightForDrive(input({ snapshot: snap({ grid_coverage: 0.995 }) })),
        "grids",
      )?.status,
    ).toBe("pass");
    expect(
      byId(
        preflightForDrive(input({ snapshot: snap({ grid_coverage: 0.95 }) })),
        "grids",
      )?.status,
    ).toBe("warn");
    expect(
      byId(
        preflightForDrive(input({ snapshot: snap({ grid_coverage: 0.8 }) })),
        "grids",
      )?.status,
    ).toBe("fail");
  });

  it("mirror behind the master: ≤20 files warns, more fails", () => {
    const base = { isMirror: true, masterSnapshot: snap({ file_count: 3520 }) };
    const warn = preflightForDrive(input(base));
    expect(byId(warn, "mirror")?.status).toBe("warn");
    const fail = preflightForDrive(
      input({ ...base, masterSnapshot: snap({ file_count: 3600 }) }),
    );
    expect(byId(fail, "mirror")?.status).toBe("fail");
    expect(fail.overall).toBe("not-ready");
  });

  it("no data at all → unknown, never a fake ready", () => {
    const r = preflightForDrive(
      input({
        snapshot: null,
        latestVerify: null,
        bench: [],
        latestChecksum: null,
        ledgerFiles: 0,
      }),
    );
    expect(r.overall).toBe("unknown");
    expect(r.checks).toEqual([]);
  });

  it("report aggregates across drives: worst wins, unknown never healthy", () => {
    const good = input();
    const bad = input({
      drive: drive({ id: "d2", name: "DJMIRROR", role: "mirror" }),
      snapshot: snap({ pdb_live_rows: 1 }),
    });
    const rep = buildPreflight([good, bad], NOW);
    expect(rep.overall).toBe("not-ready");
    expect(rep.summary).toContain("NOT gig-safe");
    expect(rep.mountedCount).toBe(2);
  });

  it("unmounted drives are excluded from the fleet verdict", () => {
    const rep = buildPreflight(
      [
        input(),
        input({
          drive: drive({
            id: "d2",
            name: "DJMIRROR",
            role: "mirror",
            mounted: false,
          }),
          snapshot: null,
          latestVerify: null,
        }),
      ],
      NOW,
    );
    expect(rep.mountedCount).toBe(1);
    expect(rep.overall).toBe("ready");
  });
});
