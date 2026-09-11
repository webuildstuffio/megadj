// search.test.ts — ⌘K global search (B9): drive-name matching + payload
// shapes. The drive-hit path was a gap: searching a drive's name returned
// nothing unless a playlist inside it happened to match.
import { describe, it, expect, beforeEach } from "bun:test";
import { DB } from "../src/db";
import { Registry } from "../src/registry";
import { loadConfig } from "../src/config";
import type { SnapshotData } from "../shared/types";

let db: DB;
let reg: Registry;
beforeEach(() => {
  db = new DB(
    `/tmp/cratedeck-test-${Date.now()}-${Math.random().toString(36).slice(2)}/db.sqlite`,
  );
  // Real default config (env untouched in CI-style sandboxes) — the paths
  // this suite exercises never touch cfg beyond name comparisons, but a
  // fully-typed default beats an `as never` lie.
  reg = new Registry(
    loadConfig("/tmp/cratedeck-test-nonexistent"),
    db,
    () => {},
  );
});

function snapWith(over: Partial<SnapshotData>): SnapshotData {
  return {
    kind: "full",
    taken_at: Date.now(),
    track_count: 3,
    total_duration_ms: 600,
    playlists: [{ name: "YTMusic Liked", entries: 3, parent: null }],
    folders: [],
    grid_coverage: 0,
    onelibrary_rows: 3,
    pdb_live_rows: null,
    tracks: [],
    ...over,
  } as SnapshotData;
}

describe("registry.search", () => {
  beforeEach(() => {
    db.upsertDrive({
      id: "fp:A:0",
      volume_uuid: "A",
      name: "DJMASTER",
      mounted: true,
    });
    db.setSnapshot("fp:A:0", snapWith({}));
    db.upsertDrive({
      id: "fp:B:0",
      volume_uuid: "B",
      name: "MISC",
      mounted: false,
    });
    db.setNickname("fp:B:0", "Resident Crate");
  });

  it("finds a drive by its raw name", () => {
    const hits = reg.search("djmaster");
    expect(hits.length).toBe(1);
    expect(hits[0]!.drive_id).toBe("fp:A:0");
    expect(hits[0]!.matches[0]!.type).toBe("drive");
  });

  it("finds a drive by nickname (ghost drives too)", () => {
    const hits = reg.search("resident");
    expect(hits.length).toBe(1);
    expect(hits[0]!.drive_id).toBe("fp:B:0");
    expect(hits[0]!.mounted).toBe(false);
    expect(hits[0]!.matches[0]!.type).toBe("drive");
  });

  it("still finds playlists inside drives", () => {
    const hits = reg.search("liked");
    expect(hits.length).toBe(1);
    expect(hits[0]!.matches[0]!.type).toBe("playlist");
  });

  it("coalesces drive + playlist matches for one drive", () => {
    const hits = reg.search("crate"); // nickname AND 'YTMusic'? no — nickname only
    expect(hits.length).toBe(1);
    expect(hits[0]!.matches[0]!.type).toBe("drive");
  });

  it("returns [] for a no-hit query", () => {
    expect(reg.search("zzzz-nothing")).toEqual([]);
  });
});
