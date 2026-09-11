// mcp_server.ts — the JSON-RPC plumbing + stdio server loop, extracted
// from mcp.ts (which holds only the tool table). mcp.ts hit the repo's
// 800-line guard when the archive grid-audit tool text grew; the loop and
// the protocol handling are the mechanically separable half. Exports the
// handle loop parameterised over a tool table so the tool definitions stay
// the single concern of mcp.ts.
import { str, RpcParamError } from "./mcp_params";

/** One MCP tool: description, JSON-schema, and the run function. */
export interface ToolDef {
  description: string;
  inputSchema: Record<string, unknown>;
  /** readonly tools are safe; mutating ones require explicit user intent. */
  destructive?: boolean;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

// ---- JSON-RPC plumbing ------------------------------------------------------
type JsonRpcId = string | number | null;
interface RpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

function reply(id: JsonRpcId, result: unknown): void {
  // EPIPE-safe: when the client closes the pipe (timeout, disconnect) the
  // server must not crash — an unwritable stdout just means nobody listens.
  try {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  } catch {
    /* client gone */
  }
}

function replyError(id: JsonRpcId, code: number, message: string): void {
  try {
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n",
    );
  } catch {
    /* client gone */
  }
}

const ERR_PARAMS = -32602;
const ERR_INTERNAL = -32603;

// ---- request handling -------------------------------------------------------
async function handleWith(
  tools: Record<string, ToolDef>,
  req: RpcRequest,
): Promise<void> {
  const id = req.id ?? null;
  try {
    switch (req.method) {
      case "initialize":
        reply(id, {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: {
            name: "cratedeck",
            title: "CrateDeck",
            version: "0.1.0",
          },
        });
        return;
      case "notifications/initialized":
        return; // notification — no response
      case "ping":
        reply(id, {});
        return;
      case "tools/list":
        reply(id, {
          tools: Object.entries(tools).map(([name, t]) => ({
            name,
            description:
              t.description + (t.destructive ? " [MUTATES DRIVE STATE]" : ""),
            inputSchema: t.inputSchema,
            annotations: {
              title: name.replace(/^deck_/, "CrateDeck ").replace(/_/g, " "),
              readOnlyHint:
                !t.destructive && name !== "deck_run" && name !== "deck_cancel",
            },
          })),
        });
        return;
      case "tools/call": {
        const name = str(req.params ?? {}, "name");
        if (!name || !tools[name]) {
          replyError(id, ERR_PARAMS, `unknown tool: ${name}`);
          return;
        }
        // MCP spec: params key is "arguments" (not "args") — reading the
        // wrong key silently dropped every argument from conforming clients.
        const args =
          ((req.params ?? {})["arguments"] as
            Record<string, unknown> | undefined) ?? {};
        const raw = await tools[name].run(args);
        const text = JSON.stringify(raw, null, 2);
        reply(id, {
          content: [{ type: "text", text }],
          isError: false,
        });
        return;
      }
      default:
        replyError(id, -32601, `method not found: ${req.method}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    replyError(id, e instanceof RpcParamError ? ERR_PARAMS : ERR_INTERNAL, msg);
  }
}

/** The stdio server loop: newline-delimited JSON-RPC over stdin. Refuses
 *  to serve tool calls when `up` is false (but answers initialize/ping so
 *  clients surface a clean error instead of hanging). */
export async function serveMcp(
  tools: Record<string, ToolDef>,
  up: boolean,
): Promise<void> {
  const reader = Bun.stdin.stream().getReader();
  const dec = new TextDecoder();
  let buf = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let req: RpcRequest;
      try {
        req = JSON.parse(line) as RpcRequest;
      } catch {
        replyError(null, -32700, "parse error");
        continue;
      }
      if (!up && req.method !== "initialize" && req.method !== "ping") {
        if (req.id !== undefined && req.id !== null) {
          replyError(req.id, ERR_INTERNAL, "cratedeck server unreachable");
        }
        // notifications stay silent even when the backend is down
        continue;
      }
      // JSON-RPC 2.0: a message without an id is a notification — MUST NOT
      // be answered (a stray id:null error can be mis-associated by
      // strict clients).
      if (req.id === undefined || req.id === null) {
        if (!req.method.startsWith("notifications/")) {
          console.error(`mcp: ignoring id-less ${req.method}`);
        }
        continue;
      }
      // Not awaited: a long tool call (deck_run with wait) must not stall
      // the pipe — subsequent requests stay answerable. Replies are
      // single-line stdout writes, so ordering interleaving is safe. Write
      // failure is logged: a silently-dead reply strands the caller until
      // its client timeout with zero diagnostics.
      void handleWith(tools, req).catch((e: unknown) => {
        console.error(`mcp: request ${req.method} failed`, e);
      });
    }
  }
}
