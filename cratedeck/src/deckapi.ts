/**
 * deckapi.ts — shared client for the CrateDeck HTTP server.
 *
 * Single source of truth for "talk to the running CrateDeck server"
 * used by both deckctl.ts (human/CLI) and mcp.ts (agent/MCP). Handles
 * server auto-start and drive resolution exactly once.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Port must match what the server actually binds: CRATEDECK_PORT env, then
// config.toml [server] port, then the default. Reading only the constant
// default here meant a configured port silently broke deckctl AND mcp
// (probe fails → ensureServer spawns a SECOND server against one SQLite DB).
function configuredPort(): number {
  const env = parseInt(process.env.CRATEDECK_PORT ?? "", 10);
  if (Number.isFinite(env) && env > 0) return env;
  // same resolution order as config.ts: <repo>/cratedeck/config.toml
  const cfgPath = join(import.meta.dir, "..", "config.toml");
  if (existsSync(cfgPath)) {
    try {
      const m = readFileSync(cfgPath, "utf8")
        .split("\n")
        .find((l) => /^\s*port\s*=\s*(\d+)/.exec(l));
      const n = m ? parseInt(/port\s*=\s*(\d+)/.exec(m)![1]!, 10) : NaN;
      if (Number.isFinite(n) && n > 0) return n;
    } catch {
      /* fall through to default */
    }
  }
  return 7742;
}
export const PORT = configuredPort();
export const BASE = `http://127.0.0.1:${PORT}`;

// Wire shapes come from the shared type SSOT (cratedeck/shared/types.ts) so
// the server, CLI, and MCP layers can't drift apart.
import {
  TERMINAL_JOB_STATUSES,
  type Drive,
  type InterlockState,
  type Job,
  type JobKind,
  type JobStatus,
} from "../shared/types";
export type { Drive, InterlockState, Job, JobKind, JobStatus };
export type Interlock = InterlockState; // legacy alias (deckctl pre-SSOT)

/** True when a job has reached a terminal state. */
export function jobTerminal(status: JobStatus | string): boolean {
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(status);
}

export async function apiGet(
  path: string,
  timeoutMs = 10_000,
): Promise<Response> {
  // every server round-trip gets a deadline: a wedged/restarting server
  // must surface as a catchable failure, not an infinite client hang
  return fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
}

export async function apiPost(
  path: string,
  body?: unknown,
  timeoutMs = 30_000,
): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** Wait for the server, auto-starting it if it isn't running. */
export async function ensureServer(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/interlock`, {
      signal: AbortSignal.timeout(1500),
    });
    if (r.ok) return true;
  } catch {
    // probe failure = not up yet; the spawn+retry loop below is the handling
  }
  try {
    const proc = Bun.spawn(["bun", "run", "cratedeck/src/index.ts"], {
      stdout: "ignore",
      stderr: "ignore",
      cwd: import.meta.dir + "/../..",
      detached: true,
    });
    proc.unref();
  } catch (e) {
    console.error("failed to spawn cratedeck server", e);
    return false;
  }
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(`${BASE}/api/interlock`, {
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) return true;
    } catch {
      // still not accepting connections — keep polling until the budget ends
    }
  }
  return false;
}

/** Resolve a drive by id, volume name, or nickname. */
export async function resolveDrive(nameOrId: string): Promise<Drive | null> {
  const drives = (await apiGet("/api/drives").then((r) => r.json())) as Drive[];
  const q = nameOrId.toLowerCase();
  return (
    drives.find((d) => d.id.toLowerCase() === q) ??
    drives.find((d) => d.name.toLowerCase() === q) ??
    drives.find((d) => (d.nickname ?? "").toLowerCase() === q) ??
    null
  );
}

/** Block until a job finishes; returns the final job record. */
export async function waitForJob(
  jobId: string,
  opts: { timeoutMs?: number; onProgress?: (j: Job) => void } = {},
): Promise<Job> {
  const deadline = Date.now() + (opts.timeoutMs ?? 30 * 60 * 1000);
  let last = "";
  let transientErrors = 0;
  while (Date.now() < deadline) {
    let j: Job;
    try {
      j = (await apiGet(`/api/jobs/${jobId}`, 5_000).then((r) =>
        r.json(),
      )) as Job;
      transientErrors = 0;
    } catch (e) {
      // the job is RUNNING on the server — a dropped poll (server busy in a
      // benchmark, brief restart) must not fail the wait; only give up after
      // repeated consecutive failures
      if (++transientErrors >= 10) {
        throw new Error(
          `job ${jobId} unreachable after 10 consecutive polls: ${(e as Error).message}`,
        );
      }
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    // dedupe on status+message: progress ticks fire every poll by design,
    // so including them would re-notify on each 3s poll while % moves
    const key = `${j.status}:${j.message}`;
    if (key !== last) {
      opts.onProgress?.(j);
      last = key;
    }
    if (jobTerminal(j.status)) return j;
    const remain = 1 - j.progress;
    await new Promise((r) => setTimeout(r, remain > 0.5 ? 3000 : 750));
  }
  throw new Error(`job ${jobId} timed out`);
}
