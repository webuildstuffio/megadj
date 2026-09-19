import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { HygieneStore } from "./store";
import { newFindingId, type Finding } from "./types";
import { hygieneFinding } from "../../test-support/scan-rows";

const finding = (over: Partial<Finding> = {}): Finding =>
  hygieneFinding({
    kind: "byte-twin",
    severity: "safe",
    paths: ["/V/Contents/A/keep.mp3", "/V/Contents/B/lose.mp3"],
    bytes: [100, 100],
    md5s: ["aa", "aa"],
    fps: [],
    evidence: { nameSimilarity: 1 },
    keeperPath: "/V/Contents/A/keep.mp3",
    autoSafe: true,
    ...over,
  });

function store(): HygieneStore {
  return new HygieneStore(new Database(":memory:"));
}

describe("HygieneStore", () => {
  test("corrupt JSON rows are skipped instead of crashing the ledger", () => {
    const raw = new Database(":memory:");
    const s = new HygieneStore(raw);
    const good = finding();
    s.upsert([good]);
    raw.exec(
      `INSERT INTO hygiene_findings
       (id, kind, severity, status, paths, bytes, proposed_action,
        keeper_path, walk_token, auto_safe, created_at)
       VALUES ('bad', 'byte-twin', 'safe', 'open', '["/bad","/loser"]', '[1,1]',
        '{broken', '/bad', 'tok', 1, 'now')`,
    );

    expect(() => s.list()).not.toThrow();
    expect(s.list().map((f) => f.id)).toEqual([good.id]);
    expect(s.get("bad")).toBeNull();
  });

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

  // #9-class status bleed: the OLD natural key was (kind, keeper_path,
  // paths[1]) — null keeper + null loser for every singleton kind, so all
  // zero-byte/junk findings collapsed onto ONE row and a confirm on file
  // A silently absorbed file B's evidence on the next scan.
  test("singleton kinds key on their file — two files never share a row", () => {
    const s = store();
    const a = finding({
      kind: "zero-byte",
      severity: "likely",
      autoSafe: false,
      paths: ["/V/Contents/A/empty1.mp3"],
      bytes: [0],
      md5s: [null],
      keeperPath: null,
      proposedAction: { type: "delete-corrupt" },
    });
    const b = finding({
      kind: "zero-byte",
      severity: "likely",
      autoSafe: false,
      paths: ["/V/Contents/A/empty2.mp3"],
      bytes: [0],
      md5s: [null],
      keeperPath: null,
      proposedAction: { type: "delete-corrupt" },
    });
    s.upsert([a, b]);
    expect(s.list({ kind: "zero-byte" }).length).toBe(2);
    // deciding A must not touch B
    s.decide(a.id, true);
    expect(s.get(a.id)?.status).toBe("confirmed");
    expect(s.get(b.id)?.status).toBe("open");
    // a re-run of BOTH keeps B open (identical evidence → no rewrite)
    const rerun = s.upsert([
      finding({
        kind: "zero-byte",
        severity: "likely",
        autoSafe: false,
        id: a.id,
        paths: ["/V/Contents/A/empty1.mp3"],
        bytes: [0],
        md5s: [null],
        keeperPath: null,
        proposedAction: { type: "delete-corrupt" },
        createdAt: a.createdAt,
      }),
      b,
    ]);
    expect(rerun.written).toBe(0);
    expect(s.get(b.id)?.status).toBe("open");
    // B's evidence changes → only B re-opens/status resets; A untouched
    const bChanged = finding({
      kind: "zero-byte",
      severity: "likely",
      autoSafe: false,
      id: newFindingId(),
      paths: ["/V/Contents/A/empty2.mp3"],
      bytes: [512],
      md5s: [null],
      keeperPath: null,
      proposedAction: { type: "delete-corrupt" },
    });
    const second = s.upsert([bChanged]);
    expect(second.written).toBe(1);
    expect(s.get(a.id)?.status).toBe("confirmed");
    expect(s.get(a.id)?.paths[0]).toBe("/V/Contents/A/empty1.mp3");
  });

  test("schema rejects a concurrent duplicate singleton natural key", () => {
    const raw = new Database(":memory:");
    const s = new HygieneStore(raw);
    const singleton = finding({
      kind: "zero-byte",
      severity: "likely",
      autoSafe: false,
      paths: ["/V/Contents/A/empty.mp3"],
      bytes: [0],
      md5s: [null],
      keeperPath: null,
      proposedAction: { type: "delete-corrupt" },
    });
    s.upsert([singleton]);
    expect(() =>
      raw.exec(`INSERT INTO hygiene_findings
        (id, kind, severity, status, paths, bytes, proposed_action,
         keeper_path, walk_token, auto_safe, created_at)
       VALUES ('raw-duplicate', 'zero-byte', 'likely', 'open',
        '["/V/Contents/A/empty.mp3"]', '[0]', '{"type":"delete-corrupt"}',
        NULL, 'tok', 0, 'now')`),
    ).toThrow();
    expect(s.list({ kind: "zero-byte" })).toHaveLength(1);
  });

  test("migrates old singleton duplicates without discarding a decision", () => {
    const raw = new Database(":memory:");
    const initial = new HygieneStore(raw);
    expect(initial.list()).toHaveLength(0);
    raw.exec(`DROP INDEX idx_hygiene_natural;
      CREATE UNIQUE INDEX idx_hygiene_natural
        ON hygiene_findings(kind, json_extract(paths, '$[0]'), json_extract(paths, '$[1]'));
      INSERT INTO hygiene_findings
        (id, kind, severity, status, paths, bytes, proposed_action,
         keeper_path, walk_token, auto_safe, created_at, decided_at)
       VALUES
        ('decided', 'zero-byte', 'likely', 'confirmed',
         '["/V/Contents/A/empty.mp3"]', '[0]', '{"type":"delete-corrupt"}',
         NULL, 'tok', 0, '2026-09-01', '2026-09-02'),
        ('duplicate', 'zero-byte', 'likely', 'open',
         '["/V/Contents/A/empty.mp3"]', '[0]', '{"type":"delete-corrupt"}',
         NULL, 'tok', 0, '2026-09-03', NULL);`);
    const migrated = new HygieneStore(raw);
    expect(migrated.list({ kind: "zero-byte" })).toHaveLength(2);
    const rows = raw
      .query("SELECT id, status FROM hygiene_findings ORDER BY id")
      .all() as { id: string; status: string }[];
    expect(rows).toEqual([
      { id: "decided", status: "confirmed" },
      { id: "duplicate", status: "archived" },
    ]);
    expect(() =>
      raw.exec(`INSERT INTO hygiene_findings
        (id, kind, severity, status, paths, bytes, proposed_action,
         keeper_path, walk_token, auto_safe, created_at)
       VALUES ('new-duplicate', 'zero-byte', 'likely', 'open',
        '["/V/Contents/A/empty.mp3"]', '[0]', '{"type":"delete-corrupt"}',
        NULL, 'tok', 0, 'now')`),
    ).toThrow();
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
