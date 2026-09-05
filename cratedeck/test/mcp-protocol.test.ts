// mcp-protocol.test.ts — regression guards for the MCP stdio server's
// JSON-RPC contract (newline-delimited), run against the REAL server via a
// spawned `bun run src/mcp.ts` with CRATEDECK_PORT pointed at an unreachable
// port (the suite must not depend on a live cratedeck server; the MCP layer
// answers initialize/tools-list/tools-call regardless, and param-bearing
// tools return a clean -32602 "server unreachable" instead of hanging).
//
// Bug this pins: tools/call used to read params["args"] instead of the
// spec-mandated params["arguments"] — every argument from conforming
// clients (Claude, Cursor, any SDK) was silently dropped, so every
// parameterized tool failed with "drive is required".
import { describe, it, expect, afterAll } from "bun:test";
import { join } from "node:path";

// Use the module-level functions where possible by importing is not possible
// (mcp.ts runs main() at import), so drive the real process over stdio.
const proc = Bun.spawn(["bun", "run", join("src", "mcp.ts")], {
  cwd: join(import.meta.dir, ".."),
  env: {
    ...process.env,
    // Unreachable port: ensureServer() gives up quickly; initialize still
    // answers, tools/call replies with a clean internal error (not a hang).
    CRATEDECK_PORT: "59999",
    CRATEDECK_ENSURE_TIMEOUT_MS: "1500",
  },
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});

let nextId = 1;

/** Send one JSON-RPC request, read lines until its id answers. */
async function rpc(
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, any>> {
  const id = nextId++;
  proc.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
  );
  await proc.stdin.flush();
  const deadline = Date.now() + 15_000;
  for (;;) {
    const line = await readLine(deadline);
    if (line === null) throw new Error(`no reply for ${method} (timeout)`);
    const msg = JSON.parse(line);
    if (msg.id === id) return msg;
    // ignore unrelated traffic (none expected, but be safe)
  }
}

let pending = "";
async function readLine(deadline: number): Promise<string | null> {
  for (;;) {
    const nl = pending.indexOf("\n");
    if (nl >= 0) {
      const line = pending.slice(0, nl).trim();
      pending = pending.slice(nl + 1);
      return line || null;
    }
    if (Date.now() > deadline) return null;
    const got = await new Promise<boolean>((resolve) => {
      const r = proc.stdout.getReader();
      const to = setTimeout(() => {
        r.releaseLock();
        resolve(false);
      }, deadline - Date.now());
      r.read().then(
        ({ value, done }) => {
          clearTimeout(to);
          r.releaseLock();
          if (done) resolve(false);
          else {
            pending += new TextDecoder().decode(value);
            resolve(true);
          }
        },
        () => {
          clearTimeout(to);
          r.releaseLock();
          resolve(false);
        },
      );
    });
    if (!got) return null;
  }
}

afterAll(() => {
  proc.kill();
});

describe("mcp stdio protocol", () => {
  it("tools/call honors params.arguments (spec key), not params.args", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(init.result).toBeTruthy();

    // kind must reach the tool: deck_explain {kind} echoes back the
    // explanation for THAT kind. With the old "args" bug the argument
    // was dropped and the tool returned the default (no-kind) payload.
    const withKind = await rpc("tools/call", {
      name: "deck_explain",
      arguments: { kind: "verify" },
    });
    expect(withKind.error).toBeUndefined();
    const text = withKind.result?.content?.[0]?.text ?? "";
    expect(text).toContain("verify");
    expect(text.length).toBeGreaterThan(40);

    // Control: a different kind yields different text (proves the arg
    // actually flowed through, not just any non-empty payload passing).
    const other = await rpc("tools/call", {
      name: "deck_explain",
      arguments: { kind: "checksum" },
    });
    const otherText = other.result?.content?.[0]?.text ?? "";
    expect(otherText).not.toBe(text);
  }, 30_000);

  it("notifications (no id) never produce an error response", async () => {
    const before = pending.length;
    proc.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: 999 },
      }) + "\n",
    );
    await proc.stdin.flush();
    // Give the server a beat to (wrongly) reply; then assert nothing with
    // id:null landed in the stream.
    await new Promise((r) => setTimeout(r, 500));
    // drain whatever arrived without blocking forever
    // (readLine with short deadline)
    const line = await readLine(Date.now() + 700);
    if (line) pending = line + "\n" + pending;
    const still = pending.slice(before);
    expect(still).not.toContain('"id":null');
  }, 10_000);
});
