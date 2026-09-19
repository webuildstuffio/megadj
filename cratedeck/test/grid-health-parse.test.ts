// grid_health_parse.test.ts — #167 GA-05c: the CLI-summary → wire-payload
// boundary. The subprocess summary is an external boundary even when
// megadj produced it: every field checked, malformed summaries fail the
// job (never a silently empty/healthy card), and the buckets census is
// complete or rejected.
import { describe, it, expect } from "bun:test";
import { summarizeGridHealth } from "../src/grid-health-parse";

/** A faithful copy of `megadj rb-grid-triage --json`'s summary shape
 *  (GridTriageResult in src/rekordbox/grid-triage.ts). */
function cliSummary(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    command: "rb-grid-triage",
    mount: "/Volumes/SHELF1",
    db: "/Volumes/SHELF1/PIONEER/Master/master.db",
    compareDrive: null,
    total: 2,
    audited: 2,
    buckets: {
      "A-OK": 1,
      SHIFT: 1,
      PHASE: 0,
      TEMPO: 0,
      DRIFT: 0,
      CHAOS: 0,
    },
    synced: null,
    syncIssues: null,
    noAnlz: 0,
    noLedger: 0,
    noGrid: 0,
    offenders: [
      {
        id: 10,
        path: "/Contents/Artist/Track.aiff",
        cls: "SHIFT",
        anchorDeltaMs: 42,
        phaseBeats: 0,
        detail: "|anchor| > 10 ms",
      },
    ],
    ok: true,
    ...over,
  };
}

describe("grid-health parse (#167)", () => {
  it("maps the CLI summary onto the wire payload with all six buckets", () => {
    const p = summarizeGridHealth(cliSummary(), "d1", "Stick A");
    expect(p.driveId).toBe("d1");
    expect(p.driveName).toBe("Stick A");
    expect(p.mount).toBe("/Volumes/SHELF1");
    expect(p.ok).toBe(true);
    expect(p.ranAt).toBeTruthy();
    expect(Object.keys(p.buckets).toSorted()).toEqual(
      ["A-OK", "SHIFT", "PHASE", "TEMPO", "DRIFT", "CHAOS"].toSorted(),
    );
    expect(p.buckets["A-OK"]).toBe(1);
    expect(p.buckets.SHIFT).toBe(1);
    expect(p.offenders).toHaveLength(1);
    expect(p.offenders[0]!.cls).toBe("SHIFT");
    expect(p.offenders[0]!.anchorDeltaMs).toBe(42);
  });

  it("rejects a failed CLI run (ok:false) — never a fake clean card", () => {
    expect(() =>
      summarizeGridHealth(
        cliSummary({ ok: false, error: "no master DB at /x" }),
        "d",
        "D",
      ),
    ).toThrow(/no master DB/);
  });

  it("rejects non-object and bucket-less summaries", () => {
    expect(() => summarizeGridHealth(null, "d", "D")).toThrow();
    expect(() => summarizeGridHealth("nope", "d", "D")).toThrow();
    expect(() =>
      summarizeGridHealth(cliSummary({ buckets: undefined }), "d", "D"),
    ).toThrow(/buckets/);
  });

  it("coerces hostile field types instead of trusting the boundary", () => {
    const p = summarizeGridHealth(
      cliSummary({
        total: "lots",
        audited: -5,
        mount: "",
        compareDrive: 7,
        offenders: [
          "junk",
          { path: "/Contents/x.mp3", cls: "NO-GRID" },
          { cls: "NO-GRID" }, // no path → dropped
        ],
      }),
      "d",
      "D",
    );
    expect(p.total).toBe(0);
    expect(p.audited).toBe(0);
    expect(p.mount).toBe("unknown");
    expect(p.compareDrive).toBeNull();
    expect(p.offenders).toHaveLength(1);
    expect(p.offenders[0]!.id).toBe(0);
  });

  it("keeps compare-active counts (synced/syncIssues) as null-or-int", () => {
    const p = summarizeGridHealth(
      cliSummary({ synced: 30, syncIssues: 2, compareDrive: "STICK1" }),
      "d",
      "D",
    );
    expect(p.synced).toBe(30);
    expect(p.syncIssues).toBe(2);
    expect(p.compareDrive).toBe("STICK1");
  });
});
