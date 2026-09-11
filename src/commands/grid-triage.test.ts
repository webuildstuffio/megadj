/**
 * rb-grid-triage tests — GA-03 triage + GA-04 full audit wiring.
 * Runs the pure core (`triageRow`, path resolution, ledger join) plus a
 * full-command pass against a fake mount: a temp "shelf" with a master
 * DB path present (rows injected via the test seam — no python) and
 * real ANLZ bytes built by fulltags/anlz.ts, plus a fake stick for the
 * byte-compare.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ArchiveState } from "../state";
import {
  anlzBpm,
  buildLedgerIndex,
  gridTriage,
  ledgerBeatsFor,
  resolveCollectionAnlz,
  triageRow,
  type MasterRow,
} from "./grid-triage";
import { buildAnlz, parseAnlzGrid } from "../../fulltags/src/anlz";

// ---- fixtures -------------------------------------------------------------

const step = 60000 / 128;
const anlzBeats = (n: number, startMs = 0) =>
  Array.from({ length: n }, (_, i) => ({
    num: (i % 4) + 1,
    bpmx100: 12800,
    timeMs: Math.round(startMs + i * step),
  }));
const ledgerBeats = (n: number, startS = 0) =>
  Array.from({ length: n }, (_, i) => startS + (i * step) / 1000);

/** Fake mount: shelf with a master DB + collection ANLZ tree, and a
 * Contents/ tree the ledger index can join against. */
function fakeShelf(): { shelf: string; anlzDir: string } {
  const shelf = mkdtempSync("/tmp/megadj-triage-shelf-");
  const anlzDir = join(shelf, "PIONEER", "Master", "share", "ANLZ");
  mkdirSync(anlzDir, { recursive: true });
  mkdirSync(join(shelf, "Contents", "Artist"), { recursive: true });
  writeFileSync(join(shelf, "PIONEER", "Master", "master.db"), "stub");
  return { shelf, anlzDir };
}

/** Register one downloaded track in a temp state whose file_path lives
 * under the given music dir (the ledger join key). */
/** Register one downloaded track in a temp state whose file_path lives
 * under the given music dir (the ledger join key). Uses the public
 * state API — no raw db access. */
function seedLedger(
  musicDir: string,
  rel: string,
  beats: number[],
): ArchiveState {
  const dir = mkdtempSync("/tmp/megadj-triage-db-");
  const state = new ArchiveState(join(dir, "db.sqlite"));
  state.upsertTrackFromPlaylist("v1", 1, "Track");
  state.markDownloaded("v1", {
    title: "Track",
    artist: "Artist",
    album: null,
    formatId: null,
    bitrateKbps: null,
    codec: null,
    filePath: join(musicDir, rel),
    fileSizeBytes: null,
    durationS: 300,
  });
  state.setBeatRecord({
    videoId: "v1",
    bpmRaw: 128,
    bpmFolded: 128,
    beats,
    downbeats: beats.filter((_, i) => i % 4 === 0),
    model: "beat_this",
    sourcePath: join(musicDir, rel),
  });
  return state;
}

// ---- pure core ------------------------------------------------------------

describe("anlzBpm", () => {
  test("median of the tempo column, ÷100", () => {
    expect(anlzBpm([{ bpmx100: 12800 }, { bpmx100: 12800 }])).toBe(128);
    expect(
      anlzBpm([{ bpmx100: 12799 }, { bpmx100: 12800 }, { bpmx100: 12801 }]),
    ).toBe(128);
    expect(anlzBpm([])).toBeNull();
  });
});

describe("resolveCollectionAnlz", () => {
  test("handles share-dir-relative and absolute shapes", () => {
    const { shelf, anlzDir } = fakeShelf();
    writeFileSync(join(anlzDir, "A.DAT"), "x");
    expect(resolveCollectionAnlz(shelf, "A.DAT")).toBe(join(anlzDir, "A.DAT"));
    expect(
      resolveCollectionAnlz(shelf, "/PIONEER/Master/share/ANLZ/A.DAT"),
    ).toBe(join(shelf, "PIONEER/Master/share/ANLZ/A.DAT"));
    expect(resolveCollectionAnlz(shelf, "missing.DAT")).toBeNull();
  });
});

describe("buildLedgerIndex + ledgerBeatsFor", () => {
  test("joins by shelf Contents rel path (NFC+casefold) then basename", () => {
    const musicDir = mkdtempSync("/tmp/megadj-triage-music-");
    mkdirSync(join(musicDir, "Artist"), { recursive: true });
    const state = seedLedger(
      musicDir,
      join("Artist", "Track.aiff"),
      ledgerBeats(16),
    );
    try {
      const prev = process.env.MEGADJ_MUSIC_DIR;
      process.env.MEGADJ_MUSIC_DIR = musicDir;
      try {
        const idx = buildLedgerIndex(state);
        expect(
          ledgerBeatsFor("/Contents/artist/track.AIFF", idx),
        ).not.toBeNull();
        expect(
          ledgerBeatsFor("/Contents/Other/Track.aiff", idx), // unique basename
        ).not.toBeNull();
        expect(ledgerBeatsFor("/Contents/zzz", idx)).toBeNull();
      } finally {
        if (prev === undefined) delete process.env.MEGADJ_MUSIC_DIR;
        else process.env.MEGADJ_MUSIC_DIR = prev;
      }
    } finally {
      state.close();
    }
  });
});

describe("triageRow", () => {
  const row: MasterRow = {
    id: 1,
    path: "/Contents/Artist/track.aiff",
    anlz: "A.DAT",
    hashDir: "P001/00000001",
  };

  test("missing collection sidecar → NO-ANLZ", () => {
    expect(
      triageRow({
        row,
        shelfAnlzBytes: null,
        stickAnlzBytes: null,
        compareActive: false,
        ledgerBeats: ledgerBeats(16),
      }).cls,
    ).toBe("NO-ANLZ");
  });

  test("SYNC wins over audit when sidecars differ (the triage rule)", () => {
    const shelf = buildAnlz({ path: row.path, beats: anlzBeats(16) });
    const stick = buildAnlz({ path: row.path, beats: anlzBeats(16, 50) });
    const t = triageRow({
      row,
      shelfAnlzBytes: shelf,
      stickAnlzBytes: stick,
      compareActive: true,
      ledgerBeats: ledgerBeats(16),
    });
    expect(t.cls).toBe("SYNC");
    expect(t.detail).toMatch(/re-export/u);
  });

  test("identical sidecars → full audit → A-OK", () => {
    const bytes = buildAnlz({ path: row.path, beats: anlzBeats(256) });
    const t = triageRow({
      row,
      shelfAnlzBytes: bytes,
      stickAnlzBytes: bytes,
      compareActive: true,
      ledgerBeats: ledgerBeats(256),
    });
    expect(t.cls).toBe("A-OK");
  });

  test("RB grid one beat late → PHASE with anchor ≈ 1 beat", () => {
    const bytes = buildAnlz({
      path: row.path,
      beats: anlzBeats(256, Math.round(step)),
    });
    const t = triageRow({
      row,
      shelfAnlzBytes: bytes,
      stickAnlzBytes: null,
      compareActive: false,
      ledgerBeats: ledgerBeats(256),
    });
    expect(t.cls).toBe("PHASE");
    expect(t.phaseBeats).toBe(1);
  });

  test("no ledger row → NO-LEDGER; gridless sidecar → NO-GRID", () => {
    const bytes = buildAnlz({ path: row.path, beats: anlzBeats(256) });
    expect(
      triageRow({
        row,
        shelfAnlzBytes: bytes,
        stickAnlzBytes: null,
        compareActive: false,
        ledgerBeats: null,
      }).cls,
    ).toBe("NO-LEDGER");
    expect(
      triageRow({
        row,
        shelfAnlzBytes: new Uint8Array([1, 2, 3]),
        stickAnlzBytes: null,
        compareActive: false,
        ledgerBeats: ledgerBeats(256),
      }).cls,
    ).toBe("NO-GRID");
  });

  test("decoded grid matches its own builder (sanity)", () => {
    const bytes = buildAnlz({ path: row.path, beats: anlzBeats(8) });
    const g = parseAnlzGrid(bytes);
    expect(g!.beats[0]!.bpmx100).toBe(12800);
  });
});

// ---- full command (rows injected, fake mount) -----------------------------

describe("gridTriage command", () => {
  test("audits rows end-to-end; missing DB is a visible failure", async () => {
    const { shelf, anlzDir } = fakeShelf();
    const musicDir = mkdtempSync("/tmp/megadj-triage-music2-");
    const prevMusic = process.env.MEGADJ_MUSIC_DIR;
    process.env.MEGADJ_MUSIC_DIR = musicDir;
    let state: ArchiveState | null = null;
    try {
      // missing DB → ok:false (never a fake pass)
      const missing = await gridTriage({
        mount: "/tmp/definitely-not-here",
        state: new ArchiveState(join(musicDir, "x.db")),
        rows: [],
        json: true,
      });
      expect(missing.ok).toBe(false);

      mkdirSync(join(musicDir, "Artist"), { recursive: true });
      state = seedLedger(
        musicDir,
        join("Artist", "Track.aiff"),
        ledgerBeats(256),
      );
      writeFileSync(
        join(anlzDir, "one.DAT"),
        buildAnlz({
          path: "/Contents/Artist/Track.aiff",
          beats: anlzBeats(256),
        }),
      );
      const rows: MasterRow[] = [
        {
          id: 10,
          path: "/Contents/Artist/Track.aiff",
          anlz: "one.DAT",
          hashDir: "P001/0000000A",
        },
      ];
      const r = await gridTriage({ mount: shelf, state, rows, json: true });
      expect(r.ok).toBe(true);
      expect(r.total).toBe(1);
      expect(r.audited).toBe(1);
      expect(r.buckets["A-OK"]).toBe(1);
    } finally {
      if (prevMusic === undefined) delete process.env.MEGADJ_MUSIC_DIR;
      else process.env.MEGADJ_MUSIC_DIR = prevMusic;
      state?.close();
    }
  });

  test("--compare counts differing sidecars as SYNC issues", async () => {
    const { shelf, anlzDir } = fakeShelf();
    const stick = mkdtempSync("/tmp/megadj-triage-stick-");
    const musicDir = mkdtempSync("/tmp/megadj-triage-music3-");
    const prevMusic = process.env.MEGADJ_MUSIC_DIR;
    process.env.MEGADJ_MUSIC_DIR = musicDir;
    let state: ArchiveState | null = null;
    try {
      mkdirSync(join(musicDir, "Artist"), { recursive: true });
      state = seedLedger(
        musicDir,
        join("Artist", "Track.aiff"),
        ledgerBeats(256),
      );
      writeFileSync(
        join(anlzDir, "one.DAT"),
        buildAnlz({
          path: "/Contents/Artist/Track.aiff",
          beats: anlzBeats(256),
        }),
      );
      // stick sidecar at the hash path — different anchor → SYNC issue
      const stickDir = join(stick, "PIONEER", "USBANLZ", "P001", "0000000A");
      mkdirSync(stickDir, { recursive: true });
      writeFileSync(
        join(stickDir, "ANLZ0000.DAT"),
        buildAnlz({
          path: "/Contents/Artist/Track.aiff",
          beats: anlzBeats(256, 30),
        }),
      );
      const rows: MasterRow[] = [
        {
          id: 11,
          path: "/Contents/Artist/Track.aiff",
          anlz: "one.DAT",
          hashDir: "P001/0000000A",
        },
      ];
      const r = await gridTriage({
        mount: shelf,
        state,
        rows,
        compareDrive: stick,
        json: true,
      });
      expect(r.ok).toBe(true);
      expect(r.syncIssues).toBe(1);
      expect(r.synced).toBe(0);
      expect(r.offenders[0]!.cls).toBe("SYNC");
    } finally {
      if (prevMusic === undefined) delete process.env.MEGADJ_MUSIC_DIR;
      else process.env.MEGADJ_MUSIC_DIR = prevMusic;
      state?.close();
    }
  });
});
