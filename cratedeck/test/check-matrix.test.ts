// check_matrix.test.ts — the tier matrix is the enforcement SSOT, so the
// tests DERIVE expectations from CHECK_APPLIES itself (the repo census
// rule: no hardcoded floors that pass while the source drifts). The
// mutation check: flip one matrix cell and the derived assertions fail.
import { describe, expect, test } from "bun:test";
import {
  CHECK_APPLIES,
  checkApplies,
  driveTier,
  omittedChecks,
  TIER_EXPLANATION,
  type CheckId,
} from "../shared/check_matrix";
import { preflightForDrive } from "../src/preflight";
import { driveBadges } from "../shared/badges";
import type { Drive, HealthCheck, SnapshotData } from "../shared/types";

const ALL_IDS = Object.keys(CHECK_APPLIES) as CheckId[];

describe("check matrix (tier SSOT)", () => {
  test("every CheckId has a row for BOTH tiers", () => {
    for (const id of ALL_IDS) {
      expect(CHECK_APPLIES[id].archive).toBeBoolean();
      expect(CHECK_APPLIES[id].gig).toBeBoolean();
    }
  });

  test("data-integrity checks apply to EVERY tier (they are never omitted)", () => {
    const integrity: CheckId[] = [
      "verify",
      "bitrot",
      "junk",
      "space",
      "dupes",
      "artwork",
    ];
    for (const id of integrity) {
      expect(CHECK_APPLIES[id].archive).toBe(true);
      expect(CHECK_APPLIES[id].gig).toBe(true);
    }
  });

  test("player-facing checks are gig-only (omitted on archive)", () => {
    const gigOnly: CheckId[] = [
      "dual-db",
      "grids",
      "mirror",
      "speed",
      "players",
    ];
    for (const id of gigOnly) {
      expect(CHECK_APPLIES[id].archive).toBe(false);
      expect(CHECK_APPLIES[id].gig).toBe(true);
    }
  });

  test("omittedChecks(archive) ∪ omittedChecks(gig) = all ids, disjoint", () => {
    const arch = omittedChecks("shelf");
    const gig = omittedChecks("master");
    expect([...arch].sort()).toEqual(
      ALL_IDS.filter((id) => !CHECK_APPLIES[id].archive).sort(),
    );
    expect([...gig].sort()).toEqual([]);
    expect(new Set([...arch, ...gig]).size).toBe(arch.length + gig.length);
  });

  test("driveTier maps shelf→archive, everything else→gig", () => {
    expect(driveTier("shelf")).toBe("archive");
    for (const r of ["master", "mirror", "library", "unknown", undefined]) {
      expect(driveTier(r)).toBe("gig");
    }
  });

  test("tier explanations are non-empty product sentences", () => {
    for (const t of ["archive", "gig"] as const) {
      expect(TIER_EXPLANATION[t].length).toBeGreaterThan(40);
    }
  });
});

// ---- derived integration: preflight + badges honor the matrix -------------

function drive(over: Partial<Drive> = {}): Drive {
  return {
    id: "x",
    volume_uuid: "x",
    name: "STICK",
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

const FULL_SNAP: SnapshotData = {
  kind: "light",
  taken_at: 1,
  file_count: 3500,
  track_count: 3500,
  grid_coverage: 1,
  pdb_live_rows: 3500,
  onelibrary_rows: 3500,
  free_bytes: 64e9,
  capacity_bytes: 128e9,
};

/** The derived law: for ANY role, the set of check ids in a preflight
 *  result must EQUAL the applicable ids that had data — no more (omitted
 *  checks must not render), no fewer (applicable checks must not vanish). */
function applicableIds(role: string): CheckId[] {
  return ALL_IDS.filter((id) => checkApplies(id, role));
}

describe("surfaces derive from the matrix (derived, not hardcoded)", () => {
  for (const role of ["shelf", "master", "unknown"] as const) {
    test(`preflight[${role}] emits exactly the applicable checks`, () => {
      const r = preflightForDrive({
        drive: drive({ role }),
        snapshot: FULL_SNAP,
        latestVerify: { ran_at: Date.now(), ok: true },
        bench: [{ ran_at: 1, seq_mbps: 90 }],
        latestChecksum: { ran_at: 1, changed: 0 },
        ledgerFiles: 10,
        masterSnapshot: null,
        isMirror: false,
        now: Date.now(),
      });
      const got = r.checks.map((c: HealthCheck) => c.id).sort();
      // preflight has no junk/dupes/artwork builders; mirror needs a master
      // snapshot (null here); players needs the players verdict (omitted
      // input); speed is quiet-when-fast (90 MB/s > CDJ floor) — intersect
      // the derived law accordingly
      const want = applicableIds(role)
        .filter(
          (id) =>
            ![
              "junk",
              "dupes",
              "artwork",
              "mirror",
              "players",
              "speed",
            ].includes(id),
        )
        .sort();
      expect(got).toEqual(want);
    });
  }

  test("badges[shelf] never contain gig-tier signals when verify passes", () => {
    const snap = { ...FULL_SNAP, grid_coverage: 0, db_mtime: 999 };
    const b = driveBadges(
      drive({
        role: "shelf",
        name: "SHELF1",
        last_snapshot_json: JSON.stringify(snap),
      }),
      { latestVerify: { ran_at: 1, ok: true } },
    );
    expect(b.some((x) => x.label.startsWith("grids"))).toBe(false);
    expect(b.some((x) => x.label === "changed since verify")).toBe(false);
    expect(b.some((x) => x.label === "archive ready")).toBe(true);
  });
});
