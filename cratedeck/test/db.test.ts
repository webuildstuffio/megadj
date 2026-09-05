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
    db.setNickname(UUID_A, "Resident Crate");
    db.setPhoto(UUID_A, "/tmp/p");
    expect(db.getDrive(UUID_A)!.nickname).toBe("Resident Crate");
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

  it("setSnapshot skips an identical re-scan (only taken_at differs)", () => {
    db.upsertDrive({
      id: UUID_A,
      volume_uuid: UUID_A,
      name: "X",
      mounted: true,
    });
    const base = {
      kind: "full" as const,
      track_count: 100,
      file_count: 120,
      dj: { genres: [{ name: "House", count: 40 }] },
    };
    const t1: SnapshotData = { ...base, taken_at: 1000 };
    const t2: SnapshotData = { ...base, taken_at: 2000 };
    db.setSnapshot(UUID_A, t1);
    const firstCount = db.snapshots(UUID_A).length;
    db.setSnapshot(UUID_A, t2); // identical content → skip
    expect(db.snapshots(UUID_A).length).toBe(firstCount);
    expect(db.getDrive(UUID_A)!.last_snapshot_json).toContain("1000");
  });

  it("setSnapshot still writes when content actually changes", () => {
    db.upsertDrive({
      id: UUID_A,
      volume_uuid: UUID_A,
      name: "X",
      mounted: true,
    });
    db.setSnapshot(UUID_A, {
      kind: "light",
      taken_at: 1000,
      file_count: 10,
    } as SnapshotData);
    db.setSnapshot(UUID_A, {
      kind: "light",
      taken_at: 2000,
      file_count: 11,
    } as SnapshotData);
    expect(db.snapshots(UUID_A).length).toBe(2);
    expect(db.latestSnapshots().get(UUID_A)!.file_count).toBe(11);
  });

  // regression: the old dedupe compared with JSON.stringify's replacer
  // ARRAY (top-level key list), which filters keys at every depth — nested
  // objects stringified as {} and any same-length nested change was
  // silently swallowed (stale fleet tables, wrong verify-freshness/parity).
  it("setSnapshot detects a nested-only change between scans", () => {
    db.upsertDrive({
      id: UUID_A,
      volume_uuid: UUID_A,
      name: "X",
      mounted: true,
    });
    const base = {
      kind: "full" as const,
      track_count: 2,
      file_count: 2,
      playlists: [{ name: "Warmup", entries: 1, parent: null }],
      playlist_entries: [
        { playlist_name: "Warmup", track_path: "a.mp3" },
        { playlist_name: "Warmup", track_path: "b.mp3" },
      ],
      tracks: [
        { path: "a.mp3", title: "Old Title", artist: "A" },
        { path: "b.mp3", title: "Other", artist: "B" },
      ],
    };
    const t1: SnapshotData = { ...base, taken_at: 1000 } as SnapshotData;
    const t2: SnapshotData = {
      ...base,
      // same array lengths; only nested values changed (user re-analyzed in
      // rekordbox + moved a playlist membership)
      taken_at: 2000,
      playlists: [{ name: "Warmup", entries: 2, parent: null }],
      playlist_entries: [
        { playlist_name: "Warmup", track_path: "a.mp3" },
        { playlist_name: "Warmup", track_path: "c.mp3" },
      ],
      tracks: [
        { path: "a.mp3", title: "New Title (Extended Mix)", artist: "A" },
        { path: "b.mp3", title: "Other", artist: "B" },
      ],
    } as SnapshotData;
    db.setSnapshot(UUID_A, t1);
    db.setSnapshot(UUID_A, t2); // must NOT be treated as a no-op
    expect(db.snapshots(UUID_A).length).toBe(2);
    expect(db.latestSnapshots().get(UUID_A)!.playlists?.[0]?.entries).toBe(2);
    expect(db.latestSnapshots().get(UUID_A)!.tracks?.[0]?.title).toBe(
      "New Title (Extended Mix)",
    );
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
      message: null,
      phase: null,
      eta_seconds: null,
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
      message: null,
      phase: null,
      eta_seconds: null,
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

  it("latestChecksum returns real changed-count, null when never run", () => {
    db.upsertDrive({
      id: UUID_A,
      volume_uuid: UUID_A,
      name: "X",
      mounted: true,
    });
    expect(db.latestChecksum(UUID_A)).toBeNull(); // never run
    const base = {
      id: "j3",
      drive_id: UUID_A,
      kind: "checksum" as const,
      progress: 1,
      message: null,
      phase: null,
      eta_seconds: null,
      error: null,
      result_json: null,
      log_path: null,
      created_at: 1,
      started_at: 1,
    };
    db.insertJob({ ...base, status: "running" as const, finished_at: null });
    db.updateJob("j3", {
      status: "done",
      finished_at: 9,
      result_json: JSON.stringify({ hashed: 100, changed: ["a.wav"] }),
    });
    expect(db.latestChecksum(UUID_A)).toEqual({ ran_at: 9, changed: 1 });
  });

  it("setSnapshot prunes snapshot history (disk-burn guard)", () => {
    db.upsertDrive({
      id: UUID_A,
      volume_uuid: UUID_A,
      name: "X",
      mounted: true,
    });
    for (let i = 0; i < 25; i++) {
      db.setSnapshot(UUID_A, {
        kind: "light",
        taken_at: 1_000 + i,
        file_count: i,
      });
    }
    expect(db.snapshots(UUID_A).length).toBeLessThanOrEqual(20);
    // newest kept, oldest dropped
    expect(db.snapshots(UUID_A).at(-1)?.taken_at).toBe(1_024);
  });
});

describe("inferRole", () => {
  it("maps known volume names", () => {
    expect(inferRole("DJMASTER")).toBe("master");
    expect(inferRole("DJMIRROR")).toBe("mirror");
    expect(inferRole("CRATE_OF_DOOM")).toBe("library");
    expect(inferRole("SANDISK")).toBe("unknown");
  });
});
