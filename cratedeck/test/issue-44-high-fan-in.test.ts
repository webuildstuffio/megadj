// Issue #44: direct tests for the high fan-in helpers that previously had no
// graph-visible coverage. These are deliberately unit-level: failures should
// pinpoint the shared primitive rather than one of its many consumers.
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchiveLedgerReader } from "../src/archive_ledger_reader";
import { createDeckctlOutput } from "../src/deckctl_output";
import { api, ApiError, apiPost, setApiErrorReporter } from "../web/ui/api";
import { Icon, ICON_NAMES } from "../web/ui/icons";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(
  run: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return Object.assign(run, { preconnect: originalFetch.preconnect });
}

test("#44: every registered icon produces a renderable glyph vnode", () => {
  expect(ICON_NAMES.length).toBeGreaterThan(0);
  expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  for (const name of ICON_NAMES) {
    const vnode = Icon({ name });
    expect(vnode.type).toBeDefined();
  }
});

test("#44: api keeps FormData intact and reports locked responses", async () => {
  const requests: RequestInit[] = [];
  globalThis.fetch = mockFetch(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return Response.json({ ok: true });
    },
  );

  const form = new FormData();
  form.set("cover", "artwork");
  expect(await apiPost<{ ok: boolean }>("/api/upload", form)).toEqual({
    ok: true,
  });
  expect(requests[0]?.body).toBe(form);
  expect(requests[0]?.headers).toBeUndefined();

  globalThis.fetch = mockFetch(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ error: "rekordbox is running" }, { status: 423 }),
  );
  try {
    await api("/api/locked", { quiet: true });
    throw new Error("api should reject a locked response");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(423);
    expect((error as ApiError).message).toBe("locked — rekordbox is running");
  }
});

test("#44: api failure reporting is injectable without importing the toast view", async () => {
  const reported: string[] = [];
  setApiErrorReporter((message) => reported.push(message));
  globalThis.fetch = mockFetch(async (_input: RequestInfo | URL) =>
    Response.json({ error: "server unavailable" }, { status: 503 }),
  );

  try {
    await api("/api/unavailable");
    throw new Error("api should reject an unavailable response");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect(reported).toEqual(["server unavailable"]);
  } finally {
    setApiErrorReporter(null);
  }
});

test("#44: deckctl output flushes complete JSON and never logs in JSON mode", async () => {
  const writes: string[] = [];
  const lines: string[] = [];
  const output = createDeckctlOutput({
    jsonMode: true,
    write: async (text) => {
      writes.push(text);
    },
    logLine: (line) => lines.push(line),
  });
  output.log("human-only");
  await output.emitJson({ healthy: true });
  await output.flushStdout();

  expect(lines).toEqual([]);
  expect(writes).toEqual(['{\n  "healthy": true\n}\n', ""]);
});

class TestLedgerReader extends ArchiveLedgerReader {
  protected readonly label = "test-ledger";

  all<T>(sql: string): T[] {
    return this.query<T>(sql);
  }
}

test("#44: ledger reader stays read-only and degrades query failures to empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "megadj-ledger-reader-"));
  const path = join(dir, "ledger.db");
  const db = new Database(path);
  db.exec("CREATE TABLE rows (value TEXT NOT NULL)");
  db.query("INSERT INTO rows VALUES (?)").run("kept");
  db.close();

  const reader = new TestLedgerReader(path);
  expect(reader.all<{ value: string }>("SELECT value FROM rows")).toEqual([
    { value: "kept" },
  ]);
  expect(reader.all("SELECT missing FROM rows")).toEqual([]);
  reader.close();
  rmSync(dir, { recursive: true, force: true });
});
