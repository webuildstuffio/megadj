import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { HygieneStore } from "./store";
import type { Finding } from "./types";
import { newFindingId } from "./types";

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: newFindingId(),
    kind: "byte-twin",
    severity: "safe",
    status: "open",
    paths: ["/V/Contents/A/keep.mp3", "/V/Contents/B/lose.mp3"],
    bytes: [100, 100],
    md5s: ["aa", "aa"],
    fps: [],
    evidence: { nameSimilarity: 1 },
    proposedAction: { type: "quarantine-loser" },
    keeperPath: "/V/Contents/A/keep.mp3",
    walkToken: "tok",
    autoSafe: true,
    createdAt: "2026-09-10T00:00:00.000Z",
    decidedAt: null,
    appliedAt: null,
    validation: null,
    ...over,
  };
}

function store(): HygieneStore {
  return new HygieneStore(new Database(":memory:"));
}

describe("HygieneStore", () => {
  test("roundtrips a finding losslessly", () => {
    const s = store();
    const f = finding({
      proposedAction: {
        type: "merge-folders",
        into: "/x",
        renames: { a: "b" },
      },
      fps: ["fp1", "fp1"],
      evidence: { custom: { nested: true } },
    });
    s.upsert([f]);
    const got = s.get(f.id);
    expect(got).toEqual(f);
  });

  test("natural-key re-run with identical evidence keeps id + status", () => {
    const s = store();
    const f = finding();
    s.upsert([f]);
    s.decide(f.id, true);
    // a re-run detects the same group — new id object, same natural key
    const rerun = finding({ ...f, id: newFindingId() });
    const { written, reopened } = s.upsert([rerun]);
    expect(written).toBe(0);
    expect(reopened).toBe(0);
    const got = s.get(f.id);
    expect(got?.status).toBe("confirmed");
    expect(got?.id).toBe(f.id); // original id stable for consumers
  });

  test("changed evidence resets status to open and RE-OPENS dismissed", () => {
    const s = store();
    const f = finding();
    s.upsert([f]);
    s.decide(f.id, false); // dismissed
    expect(s.get(f.id)?.status).toBe("dismissed");
    // same group (same natural key: keeper + first loser), different
    // evidence — the loser's md5 changed on disk
    const changed = finding({
      ...f,
      id: newFindingId(),
      md5s: ["aa", "bb"],
      bytes: [100, 100],
    });
    const { written, reopened } = s.upsert([changed]);
    expect(written).toBe(1);
    expect(reopened).toBe(1);
    const got = s.get(f.id);
    expect(got?.status).toBe("open");
    expect(got?.md5s[1]).toBe("bb");
  });

  test("decide enforces the status machine", () => {
    const s = store();
    const f = finding();
    s.upsert([f]);
    expect(s.decide(f.id, true)).toBe(true);
    // confirmed is terminal for decide() — no double-decide
    expect(s.decide(f.id, false)).toBe(false);
    expect(s.decide("nope", true)).toBe(false);
  });
  test("markApplied requires confirmed status and stores the receipt", () => {
    const s = store();
    const f = finding();
    s.upsert([f]);
    const f2 = finding({
      paths: ["/V/Contents/A/k2.mp3", "/V/Contents/B/l2.mp3"],
      keeperPath: "/V/Contents/A/k2.mp3",
    });
    s.upsert([f2]);
    const receipt = {
      ranAt: "now",
      keepersPresent: 1,
      keepersMissing: [],
      fpMismatches: [],
      shelfDelta: { before: 10, after: 9, quarantined: 1 },
      ok: true,
    };
    // open → applied is NOT a legal jump
    expect(s.markApplied(f.id, receipt)).toBe(false);
    s.decide(f.id, true);
    expect(s.markApplied(f.id, receipt)).toBe(true);
    const got = s.get(f.id);
    expect(got?.status).toBe("applied");
    expect(got?.validation?.ok).toBe(true);
    // a !ok receipt flips to failed
    s.decide(f2.id, true);
    s.markApplied(f2.id, { ...receipt, ok: false });
    expect(s.get(f2.id)?.status).toBe("failed");
  });

  test("list filters by status/kind/severity", () => {
    const s = store();
    s.upsert([
      finding(),
      finding({
        kind: "acoustic-twin",
        severity: "likely",
        md5s: [null, null],
        paths: ["/V/Contents/A/k3.mp3", "/V/Contents/B/l3.mp3"],
        keeperPath: "/V/Contents/A/k3.mp3",
      }),
      finding({
        severity: "review",
        paths: ["/V/Contents/A/k4.mp3", "/V/Contents/B/l4.mp3"],
        keeperPath: "/V/Contents/A/k4.mp3",
      }),
    ]);
    expect(s.list({ kind: "byte-twin" }).length).toBe(2);
    expect(s.list({ severity: "likely" }).length).toBe(1);
    expect(s.list({ status: "open" }).length).toBe(3);
  });
});
