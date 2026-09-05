/**
 * mcp.ts — MCP (Model Context Protocol) server over CrateDeck.
 *
 * The principles say agents get the product 1:1 with humans: this exposes
 * everything deckctl does as MCP tools over stdio JSON-RPC, so Claude,
 * Cursor, or any MCP client can query drive health, fleet coverage, and
 * (with explicit confirmation) run verify/mirror — the rekordbox interlock
 * is enforced server-side and mirrored here in the tool layer.
 *
 * Run: bun run cratedeck/src/mcp.ts   (add via your MCP client config)
 * Protocol: MCP 2025-06-18 (JSON-RPC 2.0, newline-delimited over stdio).
 *
 * Tools:
 *   deck_status                 interlock + drives + active jobs
 *   deck_drives                 drive list with badge verdicts
 *   deck_report {drive}         full health dossier (dual-DB, grids, parity…)
 *   deck_coverage {min_copies?} fleet track×drive matrix + at-risk list
 *   deck_redundancy {min_copies?} per-playlist protection audit
 *   deck_diff {a, b}            added/removed/changed between two drives
 *   deck_jobs                   recent jobs
 *   deck_run {drive, kind, wait}  ENQUEUES A JOB — scan|verify|mirror|benchmark|checksum
 *   deck_cancel {job_id}        cancel an active job
 *   deck_explain {kind?}        what each job does, typical duration, safety
 */
import {
  apiGet,
  apiPost,
  ensureServer,
  resolveDrive,
  waitForJob,
  jobTerminal,
  type Job,
} from "./deckapi";
import { VERIFY_HELP } from "./verify_help";
import type {
  CoverageResponse,
  JobKind,
  RedundancyResult,
} from "../shared/types";

// re-exported for tests (deckapi's terminal-status predicate)
export { jobTerminal };

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

// ---- tool definitions -------------------------------------------------------
interface ToolDef {
  description: string;
  inputSchema: Record<string, unknown>;
  /** readonly tools are safe; mutating ones require explicit user intent. */
  destructive?: boolean;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

// compile-checked against the canonical JobKind union — adding a job kind
// in shared/types.ts without updating this list is a type error
const JOB_KINDS = [
  "scan",
  "verify",
  "mirror",
  "benchmark",
  "checksum",
] as const satisfies readonly JobKind[];

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Resolve a drive or throw a clean param error. */
async function needDrive(nameOrId: string | undefined): Promise<{
  id: string;
  name: string;
  nickname: string | null;
  mounted: boolean;
}> {
  if (!nameOrId)
    throw new RpcParamError("drive is required (volume name, nickname, or id)");
  const d = await resolveDrive(nameOrId);
  if (!d) throw new RpcParamError(`unknown drive: ${nameOrId}`);
  return d;
}

class RpcParamError extends Error {}

async function interlockGuard(): Promise<void> {
  const il = (await apiGet("/api/interlock").then((r) => r.json())) as {
    rekordbox_running: boolean;
    pid: number | null;
  };
  if (il.rekordbox_running) {
    throw new Error(
      `rekordbox is running (pid ${il.pid}) — drive operations locked to prevent library corruption. Quit rekordbox and retry.`,
    );
  }
}

async function jobResult(job: Job): Promise<unknown> {
  if (!job.result_json) return null;
  try {
    return JSON.parse(job.result_json);
  } catch {
    return null;
  }
}

const TOOLS: Record<string, ToolDef> = {
  deck_status: {
    description:
      "CrateDeck overview: rekordbox interlock state, every known drive with badge verdicts, and active jobs. Call this first.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    run: async () => {
      const [interlock, drives, jobs] = await Promise.all([
        apiGet("/api/interlock").then((r) => r.json()),
        apiGet("/api/drives").then((r) => r.json()),
        apiGet("/api/jobs?active=1").then((r) => r.json()),
      ]);
      return { interlock, drives, jobs };
    },
  },

  deck_drives: {
    description:
      "List all known DJ USB drives with health badges (mounted, last verify, space).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    run: async () => apiGet("/api/drives").then((r) => r.json()),
  },

  deck_report: {
    description:
      "Full health dossier for one drive: dual-DB hardware gate, beatgrid coverage, bitrot (checksum ledger), space, mirror parity — with an overall verdict. Drive = volume name, nickname, or id.",
    inputSchema: {
      type: "object",
      properties: {
        drive: {
          type: "string",
          description: "volume name, nickname, or drive id",
        },
      },
      required: ["drive"],
      additionalProperties: false,
    },
    run: async (args) => {
      const d = await needDrive(str(args, "drive"));
      return apiGet(`/api/drives/${d.id}/report`).then((r) => r.json());
    },
  },

  deck_coverage: {
    description:
      "Fleet coverage: which tracks live on which drives, plus the at-risk list (tracks below the redundancy floor).",
    inputSchema: {
      type: "object",
      properties: {
        min_copies: {
          type: "number",
          description: "redundancy floor (default: server default, usually 2)",
        },
      },
      additionalProperties: false,
    },
    run: async (args) => {
      const n = num(args, "min_copies");
      const qs = n && n > 0 ? `?min_copies=${n}` : "";
      return apiGet(`/api/fleet/coverage${qs}`).then((r) =>
        r.json(),
      ) as Promise<CoverageResponse>;
    },
  },

  deck_redundancy: {
    description:
      "Per-playlist redundancy audit: is every track in each playlist present on enough drives? Returns pass/warn/fail per playlist with gap lists.",
    inputSchema: {
      type: "object",
      properties: {
        min_copies: { type: "number" },
      },
      additionalProperties: false,
    },
    run: async (args) => {
      const n = num(args, "min_copies");
      const qs = n && n > 0 ? `?min_copies=${n}` : "";
      return apiGet(`/api/fleet/redundancy${qs}`).then((r) =>
        r.json(),
      ) as Promise<RedundancyResult>;
    },
  },

  deck_diff: {
    description:
      "Compare two drives: tracks added, missing, or byte-changed between them.",
    inputSchema: {
      type: "object",
      properties: {
        a: {
          type: "string",
          description: "first drive (volume name, nickname, or id)",
        },
        b: { type: "string", description: "second drive" },
      },
      required: ["a", "b"],
      additionalProperties: false,
    },
    run: async (args) => {
      const da = await needDrive(str(args, "a"));
      const dbb = await needDrive(str(args, "b"));
      return apiGet(
        `/api/fleet/diff?a=${encodeURIComponent(da.id)}&b=${encodeURIComponent(dbb.id)}`,
      ).then((r) => r.json());
    },
  },

  deck_jobs: {
    description: "Recent CrateDeck jobs with status/progress.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    run: async () => apiGet("/api/jobs").then((r) => r.json()),
  },

  deck_run: {
    description:
      "ENQUEUES A DRIVE JOB (mutating): scan (inventory) · verify (deep integrity audit) · mirror (copy master→mirror; writes the mirror) · benchmark (read speed) · checksum (hash ledger). Blocks until done when wait=true. Refuses while rekordbox is running. Mirror only ever writes to the mirror drive.",
    destructive: true,
    inputSchema: {
      type: "object",
      properties: {
        drive: {
          type: "string",
          description: "target drive (volume name, nickname, or id)",
        },
        kind: { type: "string", enum: [...JOB_KINDS] },
        wait: {
          type: "boolean",
          description: "block until the job finishes (default true)",
        },
        timeout_minutes: {
          type: "number",
          description: "wait timeout (default 30)",
        },
      },
      required: ["drive", "kind"],
      additionalProperties: false,
    },
    run: async (args) => {
      const kind = str(args, "kind") ?? "";
      if (!JOB_KINDS.includes(kind as (typeof JOB_KINDS)[number])) {
        throw new RpcParamError(
          `bad kind "${kind}" — one of: ${JOB_KINDS.join(", ")}`,
        );
      }
      const d = await needDrive(str(args, "drive"));
      if (!d.mounted)
        throw new RpcParamError(
          `drive ${d.nickname ?? d.name} is not mounted — plug it in first`,
        );
      await interlockGuard();
      const res = await apiPost(`/api/drives/${d.id}/jobs`, { kind });
      // server re-checks the interlock at enqueue (TOCTOU guard); map its
      // 423 to the same clean param-style message our own guard throws
      if (res.status === 423) {
        throw new RpcParamError(
          "rekordbox started mid-request — drive operations locked. Quit rekordbox and retry.",
        );
      }
      const body = (await res.json()) as Job & { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? `enqueue failed (${res.status})`);
      }
      const wait = args["wait"] !== false;
      if (!wait) return { job: body, drive: d.name, kind, status: body.status };
      const timeoutMs = (num(args, "timeout_minutes") ?? 30) * 60 * 1000;
      const final = await waitForJob(body.id, { timeoutMs });
      return {
        job: { ...final, result: await jobResult(final) },
        drive: d.name,
        kind,
        ok: final.status === "done",
      };
    },
  },

  deck_cancel: {
    description: "Cancel an active job by id.",
    destructive: true,
    inputSchema: {
      type: "object",
      properties: { job_id: { type: "string" } },
      required: ["job_id"],
      additionalProperties: false,
    },
    run: async (args) => {
      const jobId = str(args, "job_id");
      if (!jobId) throw new RpcParamError("job_id is required");
      const r = await apiPost(`/api/jobs/${jobId}/cancel`);
      return r.json();
    },
  },

  deck_explain: {
    description:
      "Documentation as a tool: what each job type checks, typical duration, and safety guarantees. Kind omitted = all jobs.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["scan", "verify", "mirror", "benchmark", "checksum"],
        },
      },
      additionalProperties: false,
    },
    run: async (args) => {
      const kind = str(args, "kind");
      const others: Record<string, unknown> = {
        scan: {
          what: "Inventory the drive: file walk + rekordbox device DB read (tracks, playlists, grids, space).",
          safety: "Read-only, always safe.",
        },
        mirror: {
          what: "Copy master → mirror (files + both DBs + ANLZ). Skips matching files.",
          safety:
            "Writes ONLY the mirror drive; master untouched; requires rekordbox closed.",
        },
        benchmark: {
          what: "Measure sequential + random-4k read speed (CDJs need sustained ≥30 MB/s).",
          safety: "Read-only.",
        },
        checksum: {
          what: "Hash audio files into a corruption ledger; later runs detect silent content changes (bitrot).",
          safety: "Read-only on the drive; ledger DB lives on the host.",
        },
      };
      if (!kind) return { verify: VERIFY_HELP, ...others };
      if (kind === "verify") return { verify: VERIFY_HELP };
      return (
        others[kind] ?? {
          error: `unknown kind "${kind}" — one of: verify, ${Object.keys(others).join(", ")}`,
        }
      );
    },
  },
};

// ---- server loop ------------------------------------------------------------
async function handle(req: RpcRequest): Promise<void> {
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
          tools: Object.entries(TOOLS).map(([name, t]) => ({
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
        if (!name || !TOOLS[name]) {
          replyError(id, ERR_PARAMS, `unknown tool: ${name}`);
          return;
        }
        // MCP spec: params key is "arguments" (not "args") — reading the
        // wrong key silently dropped every argument from conforming clients.
        const args =
          ((req.params ?? {})["arguments"] as
            | Record<string, unknown>
            | undefined) ?? {};
        const raw = await TOOLS[name].run(args);
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

async function main(): Promise<void> {
  // Refuse to serve if the backend never comes up — but answer initialize
  // first so clients surface a clean error instead of hanging.
  const up = await ensureServer();
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
      // single-line stdout writes, so ordering interleaving is safe.
      void handle(req).catch(() => {});
    }
  }
}

await main();
