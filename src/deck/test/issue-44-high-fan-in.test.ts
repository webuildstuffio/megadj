// Issue #44: direct tests for the high fan-in helpers that previously had no
// graph-visible coverage. These are deliberately unit-level: failures should
// pinpoint the shared primitive rather than one of its many consumers.
import { afterAll, afterEach, expect, test } from "bun:test";
import { tempDir } from "./testutil";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { ArchiveLedgerReader } from "../db/ledger-reader";
import { createDeckctlOutput } from "../deckctl/output";
import { api, ApiError, apiPost, setApiErrorReporter } from "../web/ui/api";
import { Icon, ICON_NAMES } from "../web/ui/icons";

// #248 fixture seam: tempDir owns the mkdtemp lifecycle (ripple teardown).
const t = tempDir("megadj-ledger-reader-").rippable();
afterAll(() => {
  t.rippleAll();
});

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

test("#44: api deadline stays armed while the response body is read", async () => {
  globalThis.fetch = mockFetch(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      const response = Response.json({ ok: true });
      Object.defineProperty(response, "json", {
        value: () =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => {
                const error = new Error("aborted response body");
                error.name = "AbortError";
                reject(error);
              },
              { once: true },
            );
          }),
      });
      return response;
    },
  );

  const outcome = await Promise.race([
    api("/api/stalled-body", { quiet: true, timeoutMs: 5 }).then(
      () => "resolved",
      (error: unknown) =>
        error instanceof ApiError
          ? `${error.status}:${error.message}`
          : `raw:${String(error)}`,
    ),
    new Promise<string>((resolve) =>
      setTimeout(() => resolve("still pending"), 30),
    ),
  ]);
  expect(outcome).toBe("0:timed out after 0s — server busy; retry");
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
  // The flush rides process.stdout (never the injected write sink — an
  // injected sink must not be re-written to with a "" payload, and the
  // real flush must be the harmless process.stdout drain, not an empty
  // Bun.write which truncates file-redirected output).
  expect(writes).toEqual(['{\n  "healthy": true\n}\n']);
});

test("#159-class: flushStdout never truncates file-redirected stdout", async () => {
  // The Sep 15 regression class: Bun.write(Bun.stdout, "") wipes buffered
  // bytes when stdout is a FILE (piped consumers were safe — only the
  // redirect topology truncated, so the pipe-only spawn tests stayed
  // green while `deckctl <verb> --json > out.json` produced 0 bytes).
  // Pin the repair with a real file redirect.
  const { readFileSync, openSync, closeSync } = await import("node:fs");
  const { join: pathJoin } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const dir = t.dir();
  const out = pathJoin(dir, "out.json");
  const fd = openSync(out, "w");
  try {
    execFileSync(
      "bun",
      [
        "-e",
        [
          "const { createDeckctlOutput } = await import(process.argv[2]);",
          "const o = createDeckctlOutput({ jsonMode: true });",
          'await o.emitJson({ probe: "x".repeat(5000) });',
          "await o.flushStdout();",
        ].join("\n"),
        "-",
        join(import.meta.dir, "..", "deckctl", "output.ts"),
      ],
      { stdio: ["ignore", fd, "ignore"] },
    );
  } finally {
    closeSync(fd);
  }
  const text = readFileSync(out, "utf8");
  const parsed = JSON.parse(text) as { probe: string };
  expect(parsed.probe.length).toBe(5000);
});

class TestLedgerReader extends ArchiveLedgerReader {
  protected readonly label = "test-ledger";

  all<T>(sql: string): T[] {
    return this.query<T>(sql);
  }
}

test("#44: ledger reader stays read-only and degrades query failures to empty", () => {
  const dir = t.dir();
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
});
