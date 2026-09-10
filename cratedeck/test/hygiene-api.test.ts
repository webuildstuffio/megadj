// hygiene_reader + /api/hygiene route contract tests (docs/shelf-
// hygiene-2026-09-09.md §5 P2). Two layers:
//   1. the reader degrades — a missing/corrupt/old-schema archive DB
//      answers EMPTY (never throws, never 500s /api/hygiene);
//   2. the route family honors the wire contract — filter params, the
//      census envelope, decision fan-out into ONE CLI call, and
//      enqueue-only semantics for scan/apply (no work in the request
//      leg).
// The fixture DB is a real sqlite file built with the engine's exact
// CREATE TABLE (src/hygiene/store.ts) so the reader walks real rows.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HygieneReader } from "../src/hygiene_reader";
import { makeHygieneRoutes } from "../src/hygiene_routes";

let dir: string;
function schema(db: Database): void {
  db.run(`
    CREATE TABLE hygiene_findings (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      paths TEXT NOT NULL,
      bytes TEXT NOT NULL,
      md5s TEXT,
      fps TEXT,
      evidence TEXT,
      proposed_action TEXT NOT NULL,
      keeper_path TEXT,
      walk_token TEXT NOT NULL,
      auto_safe INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      decided_at TEXT,
      applied_at TEXT,
      validation TEXT
    );
    CREATE INDEX idx_hygiene_status ON hygiene_findings(status, kind);
  `);
}

function insert(
  db: Database,
  o: {
    id: string;
    kind?: string;
    severity?: string;
    status?: string;
    paths?: string[];
    bytes?: number[];
    autoSafe?: boolean;
  },
): void {
  db.run(
    `INSERT INTO hygiene_findings
       (id, kind, severity, status, paths, bytes, proposed_action,
        keeper_path, walk_token, auto_safe, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      o.id,
      o.kind ?? "byte-twin",
      o.severity ?? "safe",
      o.status ?? "open",
      JSON.stringify(o.paths ?? [`/Volumes/SHELF1/Music/${o.id}.aiff`]),
      JSON.stringify(o.bytes ?? [1000, 1000]),
      JSON.stringify({ type: "quarantine-loser" }),
      o.paths?.[0] ?? `/Volumes/SHELF1/Music/${o.id}.aiff`,
      "wt-1",
      o.autoSafe === false ? 0 : 1,
      "2026-09-10T12:00:00Z",
    ],
  );
}

/** Build a fixture archive DB with N findings. */
function fixtureDb(
  name: string,
  n: number,
  opts?: {
    corrupt?: boolean;
    dropTable?: boolean;
  },
): string {
  const p = join(dir, name);
  if (opts?.corrupt) {
    writeFileSync(p, "this is definitely not sqlite");
    return p;
  }
  const db = new Database(p);
  if (!opts?.dropTable) {
    schema(db);
    for (let i = 0; i < n; i++) {
      insert(db, {
        id: `f${i}`,
        kind: i % 2 ? "acoustic-twin" : "byte-twin",
        severity: i % 3 === 0 ? "review" : "safe",
        status: i === 4 ? "confirmed" : "open",
        autoSafe: i % 3 !== 0,
      });
    }
  }
  db.close();
  return p;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

// -- 1. degrade ---------------------------------------------------------

test("reader: missing archive DB answers empty, never throws", () => {
  const r = new HygieneReader(join(dir, "does-not-exist.db"));
  expect(r.list()).toEqual([]);
  expect(r.counts().open).toBe(0);
  expect(r.badge()).toEqual({ open: 0, safe: 0, review: 0, info: 0 });
  const api = makeHygieneRoutes({
    reader: r,
    enqueue: () => ({ id: "j0" }),
    megadjCli: async () => ({ code: 0, stderr: "" }),
    json,
  });
  const res = api.list(new URL("http://x/api/hygiene"));
  expect(res.status).toBe(200);
  expect(res.status).toBe(200);
});

test("reader: corrupt archive DB degrades to empty with a logged boundary", () => {
  const p = fixtureDb("corrupt.db", 0, { corrupt: true });
  const r = new HygieneReader(p);
  expect(r.list()).toEqual([]);
  expect(r.counts().open).toBe(0);
});

test("reader: old-schema DB (no hygiene_findings table) degrades to empty", () => {
  const p = fixtureDb("old.db", 0, { dropTable: true });
  const r = new HygieneReader(p);
  expect(r.list()).toEqual([]);
  expect(r.counts().open).toBe(0);
});

test("reader: counts + badge derive from real rows", () => {
  const r = new HygieneReader(fixtureDb("live.db", 6));
  const c = r.counts();
  expect(c.open).toBe(5); // f4 is confirmed
  expect(c.confirmed).toBe(1);
  expect(c.review).toBe(2); // f0, f3
  expect(c.safe).toBe(3); // open && autoSafe
  expect(c.byKind["byte-twin"]).toBe(3);
  expect(c.byKind["acoustic-twin"]!).toBe(3);
  expect(r.badge()).toEqual({ open: 5, safe: 3, review: 2, info: 0 });
});

test("reader: filters (status/kind/severity) and confirmed-first order", () => {
  const r = new HygieneReader(fixtureDb("filter.db", 6));
  const confirmedOnly = r.list({ status: "confirmed" });
  expect(confirmedOnly.length).toBe(1);
  expect(confirmedOnly[0]!.id).toBe("f4");
  const reviewOnly = r.list({ severity: "review" });
  expect(reviewOnly.length).toBe(2);
  const all = r.list();
  expect(all[0]!.status).toBe("confirmed"); // confirmed sorts first
  expect(all.every((f) => f.id.length > 0)).toBe(true);
});

// -- 2. route contract --------------------------------------------------

type Captured = {
  enqueued: Array<"hygiene-scan" | "hygiene-apply">;
  cli: string[][];
};

function harness(reader: HygieneReader): {
  api: ReturnType<typeof makeHygieneRoutes>;
  cap: Captured;
} {
  const cap: Captured = { enqueued: [], cli: [] };
  const api = makeHygieneRoutes({
    reader,
    enqueue: (kind) => {
      cap.enqueued.push(kind);
      return { id: "job-1" };
    },
    megadjCli: async (args) => {
      cap.cli.push(args);
      return { code: 0, stderr: "" };
    },
    json,
  });
  return { api, cap };
}

test("routes: GET /api/hygiene honors status filter + census envelope", async () => {
  const { api } = harness(new HygieneReader(fixtureDb("route.db", 6)));
  const res = api.list(new URL("http://x/api/hygiene?status=confirmed"));
  const body = (await res.json()) as {
    findings: Array<{ id: string }>;
    counts: { open: number };
    walkToken: string | null;
  };
  expect(body.findings.length).toBe(1);
  expect(body.findings[0]!.id).toBe("f4");
  expect(body.counts.open).toBe(5); // census is UNfiltered — banner truth
  expect(body.walkToken).toBe("wt-1");
});

test("routes: scan/apply enqueue only (zero work in the request leg)", () => {
  const { api, cap } = harness(new HygieneReader(join(dir, "empty.db")));
  expect(api.scan().status).toBe(200);
  expect(api.apply().status).toBe(200);
  expect(cap.enqueued).toEqual(["hygiene-scan", "hygiene-apply"]);
});

test("routes: decide fans out N ids into ONE megadj CLI call", async () => {
  const { api, cap } = harness(new HygieneReader(join(dir, "empty.db")));
  const res = await api.decide(
    new Request("http://x/api/hygiene/decide", {
      method: "POST",
      body: JSON.stringify({ ids: ["a", "b", "c"], confirm: true }),
    }),
  );
  expect(res.status).toBe(200);
  expect(cap.cli.length).toBe(1);
  expect(cap.cli[0]!).toEqual([
    "shelf-hygiene",
    "--confirm=a",
    "--confirm=b",
    "--confirm=c",
    "--json",
  ]);
  const res2 = await api.decide(
    new Request("http://x/api/hygiene/decide", {
      method: "POST",
      body: JSON.stringify({ id: "solo", confirm: false }),
    }),
  );
  expect(res2.status).toBe(200);
  expect(cap.cli[1]).toContain("--dismiss=solo");
});

test("routes: decide rejects empty body; CLI failure surfaces 409 + stderr", async () => {
  let fail = false;
  const cap: string[][] = [];
  const api = makeHygieneRoutes({
    reader: new HygieneReader(join(dir, "empty.db")),
    enqueue: () => ({ id: "j" }),
    megadjCli: async (args) => {
      cap.push(args);
      return fail
        ? { code: 1, stderr: "walk token mismatch: shelf changed under us" }
        : { code: 0, stderr: "" };
    },
    json,
  });
  const bad = await api.decide(
    new Request("http://x", { method: "POST", body: "not json" }),
  );
  expect(bad.status).toBe(400);
  expect(cap.length).toBe(0);
  fail = true;
  const err = await api.decide(
    new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ id: "a" }),
    }),
  );
  expect(err.status).toBe(409);
  const payload = (await err.json()) as { stderr: string };
  expect(payload.stderr).toContain("walk token");
});

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hygiene-api-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
