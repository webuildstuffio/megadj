// verify_report.test.ts — parseVerifyReport turns usb_verify.py's text output
// into a fully-explained per-check report. These tests pin the contract: every
// failing check carries a meaning + fix, passes are included (not silent),
// and the check ids stay stable for the UI/CLI.
import { describe, expect, it } from "bun:test";
import { parseVerifyReport, verifyDeltas } from "../src/jobs";

const PASS_OUTPUT = `
=== databases ===
export.pdb=3521 tracks vs OneLibrary DB=3521 tracks
  tracks: 3521
  playlists: 42
  entries: 1210
=== files ===
  missing audio: 0
  missing analysis: 0
  ANLZ missing at hash path AND at DB path: 0
  no BPM: 0
  bad length: 0
  bad grids (generated): 0
  pioneer-native variance (informational): 3
  dangling: 0
  artist FK bad: 0
FINAL: ALL PASS
`;

const FAIL_OUTPUT = `
=== databases ===
export.pdb=3400 tracks vs OneLibrary DB=3521 tracks
  tracks: 3521
  playlists: 42
  entries: 1210
=== files ===
  missing audio: 2
  missing analysis: 5
  ANLZ missing at hash path AND at DB path: 1
  no BPM: 3
  bad length: 1
  bad grids (generated): 7
  dangling: 4
  artist FK bad: 2
=== cross-drive ===
DB byte-identical: false
ANLZ full hash parity: 3/82000 mismatches
audio hash spot-check (40): 2 mismatches
FINAL: FAILED: 6 checks
`;

describe("parseVerifyReport", () => {
  it("all-pass output: every check present and passing", () => {
    const r = parseVerifyReport(PASS_OUTPUT, true, "FINAL: ALL PASS", 95);
    expect(r.ok).toBe(true);
    expect(r.duration_s).toBe(95);
    expect(r.checks.length).toBeGreaterThanOrEqual(4);
    for (const c of r.checks) {
      expect(c.status).toBe("pass");
      expect(c.meaning.length).toBeGreaterThan(10);
    }
    // every check is documented (meaning) even when passing
    const ids = r.checks.map((c) => c.id);
    expect(ids).toContain("dual-db");
    expect(ids).toContain("audio-files");
    expect(ids).toContain("anlz");
    // stats captured
    expect(r.stats.tracks).toBe(3521);
    expect(r.stats.playlists).toBe(42);
    expect(r.stats.pioneer_variance).toBe(3);
  });

  it("failing output: failing checks carry meaning + fix", () => {
    const r = parseVerifyReport(
      FAIL_OUTPUT,
      false,
      "FINAL: FAILED: 6 checks",
      180,
    );
    expect(r.ok).toBe(false);
    const bad = r.checks.filter((c) => c.status !== "pass");
    expect(bad.length).toBeGreaterThanOrEqual(5);
    for (const c of bad) {
      expect(c.fix).toBeTruthy();
      expect(c.meaning.length).toBeGreaterThan(10);
    }
    const dual = r.checks.find((c) => c.id === "dual-db");
    expect(dual?.status).toBe("fail");
    expect(dual?.detail).toContain("3521");
    // cross-drive checks present
    const ids = r.checks.map((c) => c.id);
    expect(ids).toContain("db-parity");
    expect(ids).toContain("anlz-parity");
    expect(ids).toContain("audio-parity");
  });

  it("anlz warn threshold: a few missing is warn, many is fail", () => {
    const few = PASS_OUTPUT.replace(
      "missing analysis: 0",
      "missing analysis: 3",
    );
    const rFew = parseVerifyReport(few, false, "FINAL: FAILED", 60);
    expect(rFew.checks.find((c) => c.id === "anlz")?.status).toBe("warn");
    const many = PASS_OUTPUT.replace(
      "missing analysis: 0",
      "missing analysis: 500",
    );
    const rMany = parseVerifyReport(many, false, "FINAL: FAILED", 60);
    expect(rMany.checks.find((c) => c.id === "anlz")?.status).toBe("fail");
  });

  it("every non-pass check carries meaning + fix (contract for UI/CLI printers)", () => {
    const r = parseVerifyReport(FAIL_OUTPUT, false, "FINAL: FAILED", 1);
    const f = r.checks.filter((c) => c.status !== "pass");
    expect(f.length).toBeGreaterThan(0);
    for (const x of f) {
      expect(x.meaning).toBeTruthy();
      expect(x.fix).toBeTruthy();
    }
  });

  it("single-drive run has no cross-drive checks", () => {
    const r = parseVerifyReport(PASS_OUTPUT, true, "FINAL: ALL PASS", 10);
    const ids = r.checks.map((c) => c.id);
    expect(ids).not.toContain("db-parity");
    expect(ids).not.toContain("anlz-parity");
    expect(ids).not.toContain("audio-parity");
  });
});

// ---- structured payload (VERIFY_JSON line) ----------------------------------

const JSON_PAYLOAD: VerifyJsonLike = {
  drives: {
    MASTER: {
      pdb_tracks: 3521,
      onelibrary_tracks: 3521,
      tracks: 3521,
      playlists: 42,
      playlist_entries: 1210,
      dangling_entries: 0,
      artist_fk_bad: 0,
      missing_anlz: ["/Contents/YTMusic Liked/A - B.mp3"],
      no_bpm: ["/Contents/YTMusic Liked/C - D.mp3"],
    },
  },
  db_identical: true,
  anlz_total: 82000,
  anlz_mismatches: [],
  audio_mismatches: [],
  fails: [],
};

interface VerifyJsonLike {
  drives: Record<string, Record<string, unknown>>;
  [k: string]: unknown;
}

function jsonOut(payload: VerifyJsonLike): string {
  return (
    "\n=== per-drive ===\n(human output present but parser prefers JSON)\nVERIFY_JSON: " +
    JSON.stringify(payload) +
    "\nFINAL: ALL PASS\n"
  );
}

describe("parseVerifyReport: structured payload", () => {
  it("parses the VERIFY_JSON line and attaches offenders", () => {
    const r = parseVerifyReport(
      jsonOut(JSON_PAYLOAD),
      true,
      "FINAL: ALL PASS",
      88,
    );
    expect(r.stats.tracks).toBe(3521);
    expect(r.stats.playlists).toBe(42);
    const anlz = r.checks.find((c) => c.id === "anlz");
    expect(anlz?.status).toBe("warn");
    expect(anlz?.offenders).toEqual(["/Contents/YTMusic Liked/A - B.mp3"]);
    expect(anlz?.offender_count).toBe(1);
    const fields = r.checks.find((c) => c.id === "fields");
    expect(fields?.offenders).toEqual(["/Contents/YTMusic Liked/C - D.mp3"]);
    // cross-drive parsed from JSON, not the (absent) human text
    const dbp = r.checks.find((c) => c.id === "db-parity");
    expect(dbp?.status).toBe("pass");
  });

  it("2-drive payloads aggregate counts", () => {
    const two: VerifyJsonLike = {
      ...JSON_PAYLOAD,
      drives: {
        MASTER: { tracks: 100, missing_files: ["/Contents/x.mp3"] },
        MIRROR: {
          tracks: 100,
          missing_files: ["/Contents/y.mp3", "/Contents/z.mp3"],
        },
      },
      db_identical: false,
      anlz_total: 10,
      anlz_mismatches: ["/P0100/DEADBEEF/ANLZ0000.DAT"],
      audio_mismatches: ["/Contents/rip.mp3"],
    };
    const r = parseVerifyReport(jsonOut(two), false, "FINAL: FAILED", 90);
    const audio = r.checks.find((c) => c.id === "audio-files");
    expect(audio?.detail).toContain("3 of 200");
    expect(audio?.offender_count).toBe(3);
    expect(r.checks.find((c) => c.id === "db-parity")?.status).toBe("fail");
    const ap = r.checks.find((c) => c.id === "anlz-parity");
    expect(ap?.status).toBe("fail");
    expect(ap?.offenders).toEqual(["/P0100/DEADBEEF/ANLZ0000.DAT"]);
  });

  it("offender lists cap at 50 but keep the true total", () => {
    const many = Array.from({ length: 60 }, (_, i) => `/Contents/t${i}.mp3`);
    const p: VerifyJsonLike = {
      ...JSON_PAYLOAD,
      drives: { MASTER: { tracks: 100, missing_anlz: many } },
    };
    const r = parseVerifyReport(jsonOut(p), false, "FINAL: FAILED", 5);
    const anlz = r.checks.find((c) => c.id === "anlz")!;
    expect(anlz.offenders!.length).toBe(50);
    expect(anlz.offender_count).toBe(60);
  });

  it("malformed JSON line falls back to regex parsing", () => {
    const out =
      "\nexport.pdb=99 tracks vs OneLibrary DB=99 tracks\n  tracks: 99\nVERIFY_JSON: {broken\nFINAL: ALL PASS\n";
    const r = parseVerifyReport(out, true, "FINAL: ALL PASS", 3);
    expect(r.stats.tracks).toBe(99);
    expect(r.checks.find((c) => c.id === "dual-db")?.status).toBe("pass");
  });

  it("null drive entries never crash the parse (structurally-broken payload)", () => {
    // usb_verify.py output drift or a truncated drain() can produce a
    // VALID json line with a null drive value — the FINAL verdict and all
    // checks must survive via the regex fallback, not throw.
    const out =
      'VERIFY_JSON: {"drives": {"DJX": null}}\nexport.pdb=77 tracks vs OneLibrary DB=77 tracks\n  tracks: 77\nFINAL: ALL PASS\n';
    const r = parseVerifyReport(out, true, "FINAL: ALL PASS", 2);
    expect(r.stats.tracks).toBe(77);
    expect(r.checks.find((c) => c.id === "dual-db")?.status).toBe("pass");
  });
});

// ---- deltas vs previous run -------------------------------------------------

describe("verifyDeltas", () => {
  it("computes +N worse and −N better per check", () => {
    const prev = parseVerifyReport(
      jsonOut(JSON_PAYLOAD),
      false,
      "FINAL: FAILED",
      10,
    );
    const worse: VerifyJsonLike = {
      ...JSON_PAYLOAD,
      drives: {
        MASTER: {
          ...JSON_PAYLOAD.drives.MASTER,
          missing_anlz: [
            "/Contents/YTMusic Liked/A - B.mp3",
            "/Contents/YTMusic Liked/E - F.mp3",
            "/Contents/YTMusic Liked/G - H.mp3",
          ],
        },
      },
    };
    const next = parseVerifyReport(jsonOut(worse), false, "FINAL: FAILED", 10);
    const deltas = verifyDeltas(prev, next);
    const anlz = deltas.find((d) => d.check_id === "anlz");
    expect(anlz?.delta).toBe(2);
    // unchanged checks are omitted entirely (noise reduction)
    expect(deltas.find((d) => d.check_id === "fields")).toBeUndefined();
  });

  it("no previous report → no deltas", () => {
    const next = parseVerifyReport(
      jsonOut(JSON_PAYLOAD),
      true,
      "FINAL: ALL PASS",
      5,
    );
    expect(verifyDeltas(null, next)).toEqual([]);
  });
});
