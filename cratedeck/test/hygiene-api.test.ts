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
import { tempDir } from "./testutil";
import { Database } from "bun:sqlite";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HygieneReader } from "../src/hygiene-reader";
import { makeHygieneRoutes } from "../src/hygiene-routes";

// #248 fixture seam: tempDir owns the mkdtemp lifecycle (ripple teardown).
const t = tempDir("megadj-hyg-route-").rippable();
const t2 = tempDir("megadj-hygiene-api-").rippable();
afterAll(() => {
  t.rippleAll();
  t2.rippleAll();
});

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
    walkToken?: string;
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
      o.walkToken ?? "wt-1",
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

/** Build a hygiene audio/stats query URL (module scope: lint-consistent,
 *  shared by both route forms in the guard test). */
function hygieneUrl(base: string, q: string): URL {
  return new URL(`${base}?path=${encodeURIComponent(q)}`);
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
    quarantineCensus: async () => ({ files: 0, bytes: 0, stale: 0 }),
    shelfRoot: "/tmp",
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

test("reader: default read excludes terminal 'archived' rows (#269)", () => {
  const p = fixtureDb("archived.db", 3);
  {
    const db = new Database(p);
    insert(db, {
      id: "a0",
      status: "archived",
      walkToken: "stale-archived-token",
    });
    db.close();
  }
  const r = new HygieneReader(p);
  // filter-less read (the web queue's default, no query params)
  const def = r.list();
  expect(def.some((f) => f.id === "a0")).toBe(false);
  expect(def.find((f) => f.id === "f0")?.walkToken).not.toBe(
    "stale-archived-token",
  );
  // archived never pins the payload walkToken
  expect(def[0]?.walkToken).not.toBe("stale-archived-token");
  // explicit opt-in stays legal for history views
  const hist = r.list({ status: "archived" });
  expect(hist.map((f) => f.id)).toEqual(["a0"]);
  // kind/severity-only filters keep the archived exclusion too
  expect(r.list({ kind: "byte-twin" }).some((f) => f.id === "a0")).toBe(false);
});

// -- 2. route contract --------------------------------------------------

interface Captured {
  enqueued: ("hygiene-scan" | "hygiene-apply")[];
  cli: string[][];
}

function harness(reader: HygieneReader): {
  api: ReturnType<typeof makeHygieneRoutes>;
  cap: Captured;
} {
  const cap: Captured = { enqueued: [], cli: [] };
  const api = makeHygieneRoutes({
    reader,
    // the A/B guard tests point shelfRoot at a temp shelf; tests that
    // don't touch audio routes use a path that can never resolve
    shelfRoot: guardShelf ?? "/nonexistent-shelf-root",
    enqueue: (kind) => {
      cap.enqueued.push(kind);
      return { id: "job-1" };
    },
    megadjCli: async (args) => {
      cap.cli.push(args);
      return { code: 0, stderr: "" };
    },
    quarantineCensus: async () => ({ files: 0, bytes: 0, stale: 0 }),
    json,
  });
  return { api, cap };
}

/** Optional shelfRoot override for the audio-guard tests. */
let guardShelf: string | undefined;

test("routes: audio/stats guard — traversal, non-audio, outside-root are 403", () => {
  // build a real mini-shelf so the "allowed" case has a file to serve
  const root = t.dir();
  guardShelf = root;
  const audioDir = join(root, "Contents", "A");
  mkdirSync(audioDir, { recursive: true });
  const song = join(audioDir, "song.mp3");
  writeFileSync(song, "ID3x");

  const { api } = harness(new HygieneReader(join(dir, "empty.db")));
  const u = (q: string) => hygieneUrl("http://x/api/hygiene/audio", q);
  // allowed: under root, audio ext, exists
  expect(api.audio(u(song)).status).toBe(200);
  // traversal
  expect(api.audio(u(`${root}/Contents/../..`)).status).toBe(403);
  // outside root
  expect(api.audio(u("/etc/passwd")).status).toBe(403);
  expect(api.audio(u("/Users/nick/track.mp3")).status).toBe(403);
  // non-audio ext even under root
  const dbFile = join(root, "master.db");
  writeFileSync(dbFile, "x");
  expect(api.audio(u(dbFile)).status).toBe(403);
  // missing file under root
  expect(api.audio(u(join(root, "Contents", "gone.mp3"))).status).toBe(403);
  // stats route shares the guard
  expect(api.stats(hygieneUrl("http://x/api/hygiene/stats", song)).status).toBe(
    200,
  );
  expect(
    api.stats(hygieneUrl("http://x/api/hygiene/stats", "/etc/passwd")).status,
  ).toBe(403);
  guardShelf = undefined;
});

test("routes: GET /api/hygiene honors status filter + census envelope", async () => {
  const { api } = harness(new HygieneReader(fixtureDb("route.db", 6)));
  const res = api.list(new URL("http://x/api/hygiene?status=confirmed"));
  const body = (await res.json()) as {
    findings: { id: string }[];
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

test("routes: bucket-confirm refuses listen-first buckets before any CLI run", async () => {
  // Sep 11 super-sure: a live probe proved the route happily spawned
  // `--bucket quality-diff`, silently confirming 94 unreviewed findings.
  const { api, cap } = harness(new HygieneReader(join(dir, "empty.db")));
  for (const bucket of ["quality-diff", "oddball", "ear-check"]) {
    const res = await api.bucketConfirm(
      new Request("http://x/api/hygiene/bucket-confirm", {
        method: "POST",
        body: JSON.stringify({ bucket }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("listen-first");
  }
  // safe bucket still passes validation and reaches the engine
  const ok = await api.bucketConfirm(
    new Request("http://x/api/hygiene/bucket-confirm", {
      method: "POST",
      body: JSON.stringify({ bucket: "safe-batch" }),
    }),
  );
  expect(ok.status).toBe(200);
  expect(cap.cli).toEqual([["shelf-hygiene", "--bucket=safe-batch", "--json"]]);
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
    shelfRoot: "/nonexistent-shelf-root",
    megadjCli: async (args) => {
      cap.push(args);
      return fail
        ? { code: 1, stderr: "walk token mismatch: shelf changed under us" }
        : { code: 0, stderr: "" };
    },
    quarantineCensus: async () => ({ files: 0, bytes: 0, stale: 0 }),
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

// ---- #35/#36: restore / restore-all / quarantine census + empty ----------

test("routes: restore requires an id and delegates to the engine CLI", async () => {
  const { api, cap } = harness(new HygieneReader(join(dir, "empty.db")));
  const noId = await api.restore(
    new Request("http://x", { method: "POST", body: "{}" }),
  );
  expect(noId.status).toBe(400);
  expect(cap.cli.length).toBe(0);

  const ok = await api.restore(
    new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ id: "abc" }),
    }),
  );
  expect(ok.status).toBe(200);
  expect(cap.cli[0]).toEqual(["shelf-restore", "abc", "--json"]);

  // engine failure → 409 with the tail
  const failing = makeHygieneRoutes({
    reader: new HygieneReader(join(dir, "empty.db")),
    enqueue: () => ({ id: "j" }),
    shelfRoot: "/tmp",
    megadjCli: async () => ({ code: 1, stderr: "source MD5 differs" }),
    quarantineCensus: async () => ({ files: 0, bytes: 0, stale: 0 }),
    json,
  });
  const bad = await failing.restore(
    new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ id: "abc" }),
    }),
  );
  expect(bad.status).toBe(409);
  const body = (await bad.json()) as { error?: string };
  expect(body.error).toContain("MD5");
});

test("routes: restore-all runs the engine batch and 409s on total failure", async () => {
  const { api, cap } = harness(new HygieneReader(join(dir, "empty.db")));
  const ok = await api.restoreAll();
  expect(ok.status).toBe(200);
  expect(cap.cli[0]).toEqual(["shelf-restore-all", "--json"]);

  const failing = makeHygieneRoutes({
    reader: new HygieneReader(join(dir, "empty.db")),
    enqueue: () => ({ id: "j" }),
    shelfRoot: "/tmp",
    megadjCli: async () => ({ code: 1, stderr: "boom" }),
    quarantineCensus: async () => ({ files: 0, bytes: 0, stale: 0 }),
    json,
  });
  expect((await failing.restoreAll()).status).toBe(409);
});

test("routes: quarantine census reads the injected census; empty requires DELETE literal", async () => {
  let censusCalls = 0;
  const api = makeHygieneRoutes({
    reader: new HygieneReader(join(dir, "empty.db")),
    enqueue: () => ({ id: "j" }),
    shelfRoot: "/tmp",
    megadjCli: async (args) => {
      expect(args[0]).toBe("shelf-quarantine-empty");
      return { code: 0, stderr: "" };
    },
    quarantineCensus: async () => {
      censusCalls++;
      return { files: 3, bytes: 35_000_000_000, stale: 1 };
    },
    json,
  });
  const q = await api.quarantine();
  expect(q.status).toBe(200);
  const qBody = (await q.json()) as { files: number; stale: number };
  expect(qBody.files).toBe(3);
  expect(qBody.stale).toBe(1);
  expect(censusCalls).toBe(1);

  // empty without the literal confirm → 400, engine never invoked
  const noConfirm = await api.quarantineEmpty(
    new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ confirm: "yes" }),
    }),
  );
  expect(noConfirm.status).toBe(400);
  const wrong = await api.quarantineEmpty(
    new Request("http://x", { method: "POST", body: "not json" }),
  );
  expect(wrong.status).toBe(400);

  const ok = await api.quarantineEmpty(
    new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ confirm: "DELETE" }),
    }),
  );
  expect(ok.status).toBe(200);
});

beforeAll(() => {
  dir = t2.dir();
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
