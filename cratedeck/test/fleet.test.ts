// fleet.test.ts — pure engine tests (coverage/redundancy/diff) + DB
// round-trips for the fleet tables (setSnapshot → queries).
import { describe, it, expect, beforeEach } from "bun:test";
import {
  coverage,
  redundancy,
  diff,
  trackLocations,
  type TrackRow,
  type PlaylistEntryRow,
  type ManifestRow,
} from "../src/fleet";
import { DB } from "../src/db";
import type { SnapshotData } from "../shared/types";

const A = "drive-a";
const B = "drive-b";

function tr(
  drive: string,
  path: string,
  over: Partial<TrackRow> = {},
): TrackRow {
  return {
    drive_id: drive,
    path,
    title: path.replace(/\.[a-z0-9]+$/i, ""),
    artist: "Artist",
    bpm: 128,
    key: null,
    duration_ms: 300_000,
    playlist_names: [],
    ...over,
  };
}

function inv(...rows: TrackRow[]): Map<string, TrackRow[]> {
  const m = new Map<string, TrackRow[]>();
  for (const r of rows)
    (m.get(r.drive_id) ?? m.set(r.drive_id, []).get(r.drive_id)!).push(r);
  return m;
}

describe("coverage", () => {
  it("counts copies per unique track across drives", () => {
    const r = coverage(
      inv(
        tr(A, "house/one.mp3"),
        tr(A, "house/two.mp3"),
        tr(B, "house/one.mp3"),
      ),
      2,
    );
    expect(r.drives.map((d) => d.id)).toEqual([A, B]);
    expect(r.totals.unique_tracks).toBe(2);
    const one = r.rows.find((x) => x.identity.path === "house/one.mp3")!;
    expect(one.copies).toBe(2);
    expect(one.at_risk).toBe(false);
    const two = r.rows.find((x) => x.identity.path === "house/two.mp3")!;
    expect(two.copies).toBe(1);
    expect(two.at_risk).toBe(true);
    expect(r.at_risk.map((x) => x.identity.path)).toEqual(["house/two.mp3"]);
    expect(r.totals.fully_redundant).toBe(1);
  });

  it("flags everything at_risk when the fleet has one drive", () => {
    const r = coverage(inv(tr(A, "x.mp3"), tr(A, "y.mp3")), 2);
    expect(r.at_risk.length).toBe(2);
  });

  it("skips drives with empty inventories", () => {
    const m = new Map<string, TrackRow[]>();
    m.set(A, [tr(A, "x.mp3")]);
    m.set(B, []);
    const r = coverage(m, 2);
    expect(r.drives.map((d) => d.id)).toEqual([A]);
  });

  it("merges metadata from later drives into one identity row", () => {
    const r = coverage(
      inv(
        tr(A, "one.mp3", { title: null, artist: null }),
        tr(B, "one.mp3", { title: "One", artist: "Real" }),
      ),
      2,
    );
    expect(r.rows[0]!.identity.title).toBe("One");
    expect(r.rows[0]!.identity.artist).toBe("Real");
  });

  it("trackLocations finds by path and by artist-title", () => {
    const rows = inv(
      tr(A, "a/one.mp3", { title: "One", artist: "Alpha" }),
      tr(B, "b/one remix.mp3", { title: "One", artist: "Alpha" }),
    );
    expect(trackLocations(rows, "a/one.mp3", null)?.drives).toEqual([A]);
    // path miss → meta join catches the retitled-path copy
    expect(trackLocations(rows, null, "Alpha - One")?.drives).toEqual([A, B]);
    expect(trackLocations(rows, null, "nope - nothing")).toBeNull();
  });

  it("trackLocations falls back to substring when nothing exact matches", () => {
    const rows = inv(
      tr(A, "house/three.mp3", { title: "Three", artist: "Alpha" }),
      tr(B, "house/three.mp3", { title: "Three", artist: "Alpha" }),
    );
    // title fragment
    expect(trackLocations(rows, "three", "three")?.drives).toEqual([A, B]);
    // exact still wins over substring when both could match
    expect(trackLocations(rows, "house/three.mp3", "junk")?.drives).toEqual([
      A,
      B,
    ]);
    // substring on artist too
    expect(trackLocations(rows, null, "alph")?.drives).toEqual([A, B]);
  });
});

describe("redundancy", () => {
  const rows = inv(
    tr(A, "safe.mp3"),
    tr(A, "thin.mp3"),
    tr(A, "alone.mp3"),
    tr(B, "safe.mp3"),
    tr(B, "thin.mp3"),
  );
  const entries = new Map<string, PlaylistEntryRow[]>([
    [
      A,
      [
        { drive_id: A, playlist_name: "Party", track_path: "safe.mp3" },
        { drive_id: A, playlist_name: "Party", track_path: "thin.mp3" },
        { drive_id: A, playlist_name: "Party", track_path: "alone.mp3" },
        { drive_id: A, playlist_name: "Solo", track_path: "alone.mp3" },
      ],
    ],
    [
      B,
      [
        { drive_id: B, playlist_name: "Party", track_path: "safe.mp3" },
        { drive_id: B, playlist_name: "Party", track_path: "thin.mp3" },
      ],
    ],
  ]);

  it("passes fully protected playlists and fails single-drive tracks", () => {
    const r = redundancy(rows, entries, 2);
    const party = r.playlists.find((p) => p.playlist === "Party")!;
    expect(party.verdict).toBe("fail"); // alone.mp3 on 1 drive
    expect(party.unique_tracks).toBe(3);
    expect(party.protected_tracks).toBe(2);
    expect(r.overall).toBe("fail");
    const solo = r.playlists.find((p) => p.playlist === "Solo")!;
    expect(solo.verdict).toBe("fail");
  });

  it("passes when everything meets the floor", () => {
    const rich = inv(
      tr(A, "safe.mp3"),
      tr(B, "safe.mp3"),
      tr(A, "thin.mp3"),
      tr(B, "thin.mp3"),
      tr(A, "alone.mp3"),
      tr(B, "alone.mp3"),
    );
    const r = redundancy(rich, entries, 2);
    expect(r.overall).toBe("pass");
    expect(r.playlists.find((p) => p.playlist === "Party")!.verdict).toBe(
      "pass",
    );
  });

  it("unioned entries include tracks whose rows exist on any drive", () => {
    const r = redundancy(rows, entries, 2);
    const party = r.playlists.find((p) => p.playlist === "Party")!;
    // thin.mp3 is on both, alone.mp3 only on A — the union is audited
    expect(party.tracks.map((t) => t.copies).sort()).toEqual([1, 2, 2]);
  });

  it("unknown when no playlist data", () => {
    const r = redundancy(rows, new Map(), 2);
    expect(r.overall).toBe("unknown");
  });
});

describe("diff", () => {
  it("classifies added/removed and ignores identical", () => {
    const r = diff(
      "A",
      [tr(A, "keep.mp3"), tr(A, "gone.mp3")],
      null,
      "B",
      [tr(B, "keep.mp3"), tr(B, "new.mp3")],
      null,
    );
    expect(r.added.map((x) => x.path)).toEqual(["new.mp3"]);
    expect(r.removed.map((x) => x.path)).toEqual(["gone.mp3"]);
    expect(r.changed).toEqual([]);
    expect(r.summary).toBe("+1 added · −1 removed");
  });

  it("detects byte changes from manifests", () => {
    const man = (drive: string, path: string, bytes: number): ManifestRow => ({
      drive_id: drive,
      path,
      bytes,
      mtime_ms: 1,
    });
    const r = diff(
      "A",
      [tr(A, "same.mp3"), tr(A, "diff.mp3")],
      [man(A, "same.mp3", 100), man(A, "diff.mp3", 100)],
      "B",
      [tr(B, "same.mp3"), tr(B, "diff.mp3")],
      [man(B, "same.mp3", 100), man(B, "diff.mp3", 222)],
    );
    expect(r.added.length).toBe(0);
    expect(r.removed.length).toBe(0);
    expect(r.changed.map((x) => x.path)).toEqual(["diff.mp3"]);
    expect(r.changed[0]!.bytes_a).toBe(100);
    expect(r.changed[0]!.bytes_b).toBe(222);
  });

  it("meta-joins the same track at different paths", () => {
    const r = diff(
      "A",
      [tr(A, "old path/song.mp3", { title: "Song", artist: "Duo" })],
      null,
      "B",
      [tr(B, "new path/song.mp3", { title: "Song", artist: "Duo" })],
      null,
    );
    expect(r.added.length).toBe(0);
    expect(r.removed.length).toBe(0);
  });
});

// ---- DB round-trips ----------------------------------------------------------

let db: DB;
beforeEach(() => {
  db = new DB(
    `/tmp/cratedeck-fleet-test-${Date.now()}-${Math.random().toString(36).slice(2)}/db.sqlite`,
  );
});

function snapWith(over: Partial<SnapshotData> = {}): SnapshotData {
  return {
    kind: "full",
    taken_at: Date.now(),
    tracks: [
      {
        path: "house/one.mp3",
        title: "One",
        artist: "Alpha",
        bpm: 128,
        key: "8A",
        duration_ms: 300_000,
      },
      {
        path: "house/two.mp3",
        title: "Two",
        artist: "Alpha",
        bpm: 130,
        key: null,
        duration_ms: 280_000,
      },
    ],
    playlist_entries: [
      { playlist_name: "Party", track_path: "house/one.mp3" },
    ],
    manifest: [{ path: "house/one.mp3", bytes: 1, mtime_ms: 2 }],
    ...over,
  };
}

describe("db fleet tables", () => {
  it("persists snapshot track/playlist/manifest data and queries it back", () => {
    db.upsertDrive({ id: A, volume_uuid: A, name: "X", mounted: true });
    db.setSnapshot(A, snapWith());
    const invs = db.fleetInventories();
    expect(invs.get(A)!.length).toBe(2);
    expect(invs.get(A)![0]!.title).toBe("One");
    const entries = db.fleetPlaylistEntries();
    expect(entries.get(A)![0]!.playlist_name).toBe("Party");
    const mans = db.fleetManifests();
    expect(mans.get(A)![0]!.bytes).toBe(1);
  });

  it("replaces (not appends) rows on rescan", () => {
    db.upsertDrive({ id: A, volume_uuid: A, name: "X", mounted: true });
    db.setSnapshot(A, snapWith());
    db.setSnapshot(A, snapWith({ taken_at: Date.now() + 1 }));
    // identical content is skipped by setSnapshot, so force a real change
    db.setSnapshot(
      A,
      snapWith({
        taken_at: Date.now() + 2,
        tracks: snapWith().tracks!.slice(0, 1),
      }),
    );
    expect(db.fleetInventories().get(A)!.length).toBe(1);
  });

  it("round-trips two drives for the API shapes", () => {
    db.upsertDrive({ id: A, volume_uuid: A, name: "X", mounted: true });
    db.upsertDrive({ id: B, volume_uuid: B, name: "Y", mounted: true });
    db.setSnapshot(A, snapWith());
    db.setSnapshot(
      B,
      snapWith({
        taken_at: Date.now() + 5,
        tracks: [snapWith().tracks![0]!],
      }),
    );
    const cov = coverage(db.fleetInventories(), 2);
    expect(cov.totals.unique_tracks).toBe(2);
    expect(cov.at_risk.map((r) => r.identity.path)).toEqual([
      "house/two.mp3",
    ]);
    const red = redundancy(
      db.fleetInventories(),
      db.fleetPlaylistEntries(),
      2,
    );
    expect(red.playlists[0]!.playlist).toBe("Party");
    const d = diff(
      "A",
      db.fleetInventories([A]).get(A)!,
      db.fleetManifests([A]).get(A) ?? null,
      "B",
      db.fleetInventories([B]).get(B)!,
      db.fleetManifests([B]).get(B) ?? null,
    );
    expect(d.removed.map((r) => r.path)).toEqual(["house/two.mp3"]);
  });

  it("empty fleet tables → empty maps (no crash)", () => {
    expect(db.fleetInventories().size).toBe(0);
    expect(db.fleetPlaylistEntries().size).toBe(0);
    expect(db.fleetManifests().size).toBe(0);
  });
});
