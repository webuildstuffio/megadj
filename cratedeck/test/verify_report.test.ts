// verify_report.test.ts — parseVerifyReport turns usb_verify.py's text output
// into a fully-explained per-check report. These tests pin the contract: every
// failing check carries a meaning + fix, passes are included (not silent),
// and the check ids stay stable for the UI/CLI.
import { describe, expect, it } from "bun:test";
import { parseVerifyReport } from "../src/jobs";
import { findingsOf } from "../src/jobs";

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
    const r = parseVerifyReport(FAIL_OUTPUT, false, "FINAL: FAILED: 6 checks", 180);
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
    const few = PASS_OUTPUT.replace("missing analysis: 0", "missing analysis: 3");
    const rFew = parseVerifyReport(few, false, "FINAL: FAILED", 60);
    expect(rFew.checks.find((c) => c.id === "anlz")?.status).toBe("warn");
    const many = PASS_OUTPUT.replace("missing analysis: 0", "missing analysis: 500");
    const rMany = parseVerifyReport(many, false, "FINAL: FAILED", 60);
    expect(rMany.checks.find((c) => c.id === "anlz")?.status).toBe("fail");
  });

  it("findingsOf maps non-pass checks to the legacy finding shape", () => {
    const r = parseVerifyReport(FAIL_OUTPUT, false, "FINAL: FAILED", 1);
    const f = findingsOf(r);
    expect(f.length).toBe(r.checks.filter((c) => c.status !== "pass").length);
    for (const x of f) expect(x.fix).toBeTruthy();
  });

  it("single-drive run has no cross-drive checks", () => {
    const r = parseVerifyReport(PASS_OUTPUT, true, "FINAL: ALL PASS", 10);
    const ids = r.checks.map((c) => c.id);
    expect(ids).not.toContain("db-parity");
    expect(ids).not.toContain("anlz-parity");
    expect(ids).not.toContain("audio-parity");
  });
});
