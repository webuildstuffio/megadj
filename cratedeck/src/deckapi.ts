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
  type Job,
  type JobStatus,
} from "../shared/types";
export { type Drive, type Job, type JobStatus } from "../shared/types";

/** True when a job has reached a terminal state. */
export function jobTerminal(status: JobStatus | string): boolean {
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(status);
}

// Offline transport gate: when CRATEDECK_OFFLINE=1, every HTTP round-trip
// throws immediately. The MCP stdio server runs this way in offline
// harnesses: registry metadata and purely local tools stay answerable, and
// backend-backed tools surface a clean catchable error instead of a
// timeout — no server is ever spawned from the process (root-cause fix for
// the Sep 15/16 detached index.ts leak on port 59999).
function offlineGate(): void {
  if (process.env.CRATEDECK_OFFLINE === "1") {
    throw new Error("cratedeck server unreachable (offline mode)");
  }
}

export async function apiGet(
  path: string,
  timeoutMs = 10_000,
): Promise<Response> {
  offlineGate();
  // every server round-trip gets a deadline: a wedged/restarting server
  // must surface as a catchable failure, not an infinite client hang
  return fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
}

/** apiGet + typed JSON body — the one place an untyped `r.json( + ` is
 * allowed in callers. Response.json() returns `any`; pinning it to a
 * caller-specified shape keeps the MCP tool layer off `any`. */
export async function apiGetJson<T = unknown>(
  path: string,
  timeoutMs = 10_000,
): Promise<T> {
  const res = await apiGet(path, timeoutMs);
  return (await res.json()) as T;
}

/** apiGet → parsed JSON — the `fetchWeeklyPrepInput` seam (also usable by
 *  any caller that wants a plain generic GET-and-parse). Module-level so
 *  tool run() bodies don't re-create it per call (oxlint scoping). */
export const apiGetJsonT = <T>(path: string, timeoutMs?: number): Promise<T> =>
  apiGet(path, timeoutMs ?? 10_000).then((r) => r.json() as Promise<T>);

export async function apiPost(
  path: string,
  body?: unknown,
  timeoutMs = 30_000,
): Promise<Response> {
  offlineGate();
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** Wait for the server, auto-starting it if it isn't running. Tests (and
 *  embedders) can set CRATEDECK_NO_AUTOSTART=1 to make this a pure probe:
 *  the auto-spawn is detached + unref'd, so in a test process it becomes a
 *  launchd-reparented orphan the test cannot kill (Sep 15/16 leak: two
 *  servers survived a day on the test port, one holding the SQLite it
 *  auto-opened). */
export async function ensureServer(): Promise<boolean> {
  if (process.env.CRATEDECK_NO_AUTOSTART === "1") {
    try {
      const r = await fetch(`${BASE}/api/interlock`, {
        signal: AbortSignal.timeout(1500),
      });
      return r.ok;
    } catch {
      return false;
    }
  }
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
      cwd: `${import.meta.dir}/../..`,
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

/** resolveDrive + the unknown-drive failure frame, written once (#99):
 *  every deckctl verb did `resolveDrive → if (!d) errOut + exit(2)`.
 *  Returns the drive or never-returns; `h` is structurally the
 *  deckctl print-hooks shape ({ errOut, exit }) — both HelpPrintHooks
 *  and NotePrintHooks satisfy it. */
export async function resolveDriveOrExit(
  h: { errOut: (s: string) => void; exit: (code: number) => never },
  nameOrId: string,
): Promise<Drive> {
  const d = await resolveDrive(nameOrId);
  if (!d) {
    h.errOut(`unknown drive: ${nameOrId}`);
    h.exit(2);
  }
  return d;
}

/** One job-status poll with transient-failure tolerance. A job that is
 *  RUNNING server-side must survive dropped polls (server busy mid-bench,
 *  brief restart) — only `maxConsecutive` failures in a row give up.
 *  Used by `waitForJob` (agents) and deckctl's `run --wait` loop (humans):
 *  one implementation, so a killed CLI an hour into a verify can't recur.
 *  `get` is injectable for tests; production passes nothing (real apiGet). */
export async function pollJob(
  jobId: string,
  opts: {
    timeoutMs?: number;
    maxConsecutive?: number;
    onGiveUp?: (msg: string) => void;
    /** Retry backoff ms (default 1500); tests pass small values. */
    retryDelayMs?: number;
    get?: (path: string, timeoutMs?: number) => Promise<Response>;
  } = {},
): Promise<Job> {
  const maxConsecutive = opts.maxConsecutive ?? 10;
  const retryDelayMs = opts.retryDelayMs ?? 1500;
  const get = opts.get ?? apiGet;
  let transientErrors = 0;
  const deadline = Date.now() + (opts.timeoutMs ?? 30 * 60 * 1000);
  while (Date.now() < deadline) {
    try {
      const j = (await get(`/api/jobs/${jobId}`, 5_000).then((r) =>
        r.json(),
      )) as Job;
      transientErrors = 0;
      return j;
    } catch (e) {
      if (++transientErrors >= maxConsecutive) {
        const msg = `job ${jobId} unreachable after ${maxConsecutive} consecutive polls: ${(e as Error).message}`;
        opts.onGiveUp?.(msg);
        throw new Error(msg, { cause: e });
      }
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
  throw new Error(`job ${jobId} timed out`);
}

/** Block until a job finishes; returns the final job record. */
export async function waitForJob(
  jobId: string,
  opts: { timeoutMs?: number; onProgress?: (j: Job) => void } = {},
): Promise<Job> {
  const deadline = Date.now() + (opts.timeoutMs ?? 30 * 60 * 1000);
  let last = "";
  while (Date.now() < deadline) {
    // pollJob owns transient-failure tolerance (identical contract)
    const j = await pollJob(jobId, {
      timeoutMs: Math.max(deadline - Date.now(), 0),
    });
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
