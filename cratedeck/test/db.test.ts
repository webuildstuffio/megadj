import { describe, it, expect, beforeEach } from "bun:test";
import { DB, inferRole } from "../src/db";
import type { SnapshotData } from "../shared/types";

let db: DB;
beforeEach(() => {
  db = new DB(
    `/tmp/cratedeck-test-${Date.now()}-${Math.random().toString(36).slice(2)}/db.sqlite`,
  );
});

const UUID_A = "1111-2222-3333";
const UUID_B = "4444-5555-6666";

describe("db drives", () => {
  it("inserts a new drive on first sight and updates on re-sight", () => {
    db.upsertDrive({
      id: UUID_A,
      volume_uuid: UUID_A,
      name: "DJMASTER",
      mounted: true,
    });
    const d1 = db.getDrive(UUID_A)!;
    expect(d1.first_seen_at).toBeGreaterThan(0);
    expect(d1.plug_count).toBe(1);
    expect(d1.role).toBe("master");

    db.upsertDrive({
      id: UUID_A,
      name: "DJMASTER",
      mounted: true,
      capacity_bytes: 128,
    });
    const d2 = db.getDrive(UUID_A)!;
    expect(d2.plug_count).toBe(1); // upsert of same sighting doesn't bump
    expect(d2.capacity_bytes).toBe(128);
    expect(d2.first_seen_at).toBe(d1.first_seen_at);
  });

  it("distinguishes two identical drives by uuid", () => {
    db.upsertDrive({
      id: UUID_A,
      volume_uuid: UUID_A,
      name: "CRATE1",
      mounted: true,
    });
    db.upsertDrive({
      id: UUID_B,
      volume_uuid: UUID_B,
      name: "CRATE1",
      mounted: true,
    });
    expect(db.allDrives().length).toBe(2);
  });

  it("setMounted ghosts a drive", () => {
    db.upsertDrive({
      id: UUID_A,
      volume_uuid: UUID_A,
      name: "X",
      mounted: true,
    });
    db.setMounted(UUID_A, false);
    expect(db.getDrive(UUID_A)!.mounted).toBe(false);
  });

  it("nickname and photo persist", () => {
    db.upsertDrive({
      id: UUID_A,
      volume_uuid: UUID_A,
      name: "X",
      mounted: true,
    });
    db.setNickname(UUID_A, "OLDBACKUP");
    db.setPhoto(UUID_A, "/tmp/p");
    expect(db.getDrive(UUID_A)!.nickname).toBe("OLDBACKUP");
  });
});

describe("db snapshots", () => {
  it("stores and retrieves latest snapshot", () => {
    db.upsertDrive({
      id: UUID_A,
      volume_uuid: UUID_A,
      name: "X",
      mounted: true,
    });
    const snap: SnapshotData = { kind: "light", taken_at: 1, file_count: 10 };
    db.setSnapshot(UUID_A, snap);
    const snap2: SnapshotData = { kind: "light", taken_at: 2, file_count: 12 };
    db.setSnapshot(UUID_A, snap2);
    const latest = db.latestSnapshots().get(UUID_A)!;
    expect(latest.file_count).toBe(12);
    expect(db.snapshots(UUID_A).length).toBe(2);
  });
});

describe("db jobs", () => {
  it("job lifecycle + orphan reaping", () => {
    db.upsertDrive({
      id: UUID_A,
      volume_uuid: UUID_A,
      name: "X",
      mounted: true,
    });
    const job = {
      id: "j1",
      drive_id: UUID_A,
      kind: "verify" as const,
      status: "running" as const,
      progress: 0.5,
      error: null,
      result_json: null,
      log_path: null,
      created_at: 1,
      started_at: 2,
      finished_at: null,
    };
    db.insertJob(job);
    expect(db.activeJobs().length).toBe(1);
    expect(db.reapOrphanJobs()).toBe(1);
    expect(db.activeJobs().length).toBe(0);
    expect(db.getJob("j1")!.status).toBe("interrupted");
  });

  it("latestVerify parses verdict", () => {
    db.upsertDrive({
      id: UUID_A,
      volume_uuid: UUID_A,
      name: "X",
      mounted: true,
    });
    const base = {
      id: "j2",
      drive_id: UUID_A,
      kind: "verify" as const,
      progress: 1,
      error: null,
      result_json: null,
      log_path: null,
      created_at: 1,
      started_at: 1,
    };
    db.insertJob({ ...base, status: "running" as const, finished_at: null });
    db.updateJob("j2", {
      status: "done",
      finished_at: 5,
      result_json: JSON.stringify({ verdict: "pass" }),
    });
    expect(db.latestVerify(UUID_A)).toEqual({ ran_at: 5, ok: true });
  });
});

describe("inferRole", () => {
  it("maps known volume names", () => {
    expect(inferRole("DJMASTER")).toBe("master");
    expect(inferRole("djmirror")).toBe("mirror");
    expect(inferRole("CRATE_OF_DOOM")).toBe("library");
    expect(inferRole("SANDISK")).toBe("unknown");
  });
});
