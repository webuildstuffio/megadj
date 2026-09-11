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

/** JSON-RPC response wire shape (typed alternative to Record<string, any>). */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number | null | undefined;
  result?: unknown;
  error?: { code: number; message: string } | undefined;
}

/** Parse one stream line, tolerating non-JSON noise (null = skip). */
function parseJsonRpc(line: string): JsonRpcResponse | null {
  try {
    const raw = JSON.parse(line) as Partial<JsonRpcResponse> | null;
    if (raw === null || typeof raw !== "object") return null;
    return {
      jsonrpc: "2.0",
      id: raw.id ?? null,
      result: raw.result,
      error: raw.error,
    };
  } catch {
    return null;
  }
}

/** Extract the first text block from a tools/call result ("" if absent). */
function resultText(res: JsonRpcResponse): string {
  const content = (res.result as { content?: { text?: unknown }[] } | undefined)
    ?.content;
  return typeof content?.[0]?.text === "string" ? content[0].text : "";
}

/** Send one JSON-RPC request, read lines until its id answers. */
async function rpc(
  method: string,
  params: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const id = nextId++;
  proc.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
  );
  await proc.stdin.flush();
  const deadline = Date.now() + 15_000;
  for (;;) {
    const line = await readLine(deadline);
    if (line === null) throw new Error(`no reply for ${method} (timeout)`);
    const msg = parseJsonRpc(line);
    if (msg === null) continue; // non-JSON noise — not a reply
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
    const text = resultText(withKind);
    expect(text).toContain("verify");
    expect(text.length).toBeGreaterThan(40);

    // Control: a different kind yields different text (proves the arg
    // actually flowed through, not just any non-empty payload passing).
    const other = await rpc("tools/call", {
      name: "deck_explain",
      arguments: { kind: "checksum" },
    });
    const otherText = resultText(other);
    expect(otherText).not.toBe(text);
  }, 30_000);

  it("tools/list exposes the full deckctl surface incl. help + dismiss (rev 4)", async () => {
    const res = await rpc("tools/list", {});
    const tools = (
      res.result as {
        tools?: { name: string; annotations?: { readOnlyHint?: boolean } }[];
      }
    )?.tools;
    expect(Array.isArray(tools)).toBeTrue();
    const byName = new Map((tools ?? []).map((t) => [t.name as string, t]));
    // the new rev-4 twins exist…
    expect(byName.has("deck_help")).toBe(true);
    expect(byName.has("deck_dismiss")).toBe(true);
    // …and carry the right safety hints: help readonly, dismiss not
    expect(byName.get("deck_help")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("deck_dismiss")?.annotations?.readOnlyHint).toBe(false);
    // census parity: every deckctl verb with a tool twin is present
    const names = new Set(byName.keys());
    for (const verb of [
      "status",
      "drives",
      "report",
      "search",
      "note",
      "notes",
      "dismiss",
      "help",
      "rename",
      "prep",
      "preflight",
      "players",
    ]) {
      expect(names.has(`deck_${verb}`), `deck_${verb} in tools/list`).toBe(
        true,
      );
    }
  }, 15_000);

  it("tools/list exposes GetDat intake tools with mutating schemas", async () => {
    const res = await rpc("tools/list", {});
    const tools =
      (
        res.result as {
          tools?: {
            name: string;
            inputSchema?: {
              required?: string[];
              properties?: Record<string, unknown>;
            };
            annotations?: { readOnlyHint?: boolean };
          }[];
        }
      )?.tools ?? [];
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const ingest = byName.get("getdat_ingest");
    const convert = byName.get("getdat_convert");
    expect(ingest).toBeDefined();
    expect(convert).toBeDefined();
    expect(ingest?.annotations?.readOnlyHint).toBe(false);
    expect(convert?.annotations?.readOnlyHint).toBe(false);
    expect(ingest?.inputSchema?.required).toEqual(["folder"]);
    expect(ingest?.inputSchema?.properties?.folder).toBeDefined();
    expect(convert?.inputSchema?.properties?.dry_run).toBeDefined();
    expect(convert?.inputSchema?.properties?.no_artwork).toBeDefined();
  }, 15_000);

  it("GetDat ingest validates its required folder before spawning", async () => {
    const res = await rpc("tools/call", {
      name: "getdat_ingest",
      arguments: {},
    });
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.message).toContain("folder is required");
  }, 15_000);

  it("notifications (no id) never produce an error response", async () => {
    const before = pending.length;
    proc.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: 999 },
      })}\n`,
    );
    await proc.stdin.flush();
    // Give the server a beat to (wrongly) reply; then assert nothing with
    // id:null landed in the stream.
    await new Promise((r) => setTimeout(r, 500));
    // drain whatever arrived without blocking forever
    // (readLine with short deadline)
    const line = await readLine(Date.now() + 700);
    if (line) pending = `${line}\n${pending}`;
    const still = pending.slice(before);
    expect(still).not.toContain('"id":null');
  }, 10_000);
});
