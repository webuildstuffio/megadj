/**
 * deckapi.ts — shared client for the CrateDeck HTTP server.
 *
 * Single source of truth for "talk to the running CrateDeck server"
 * used by both deckctl.ts (human/CLI) and mcp.ts (agent/MCP). Handles
 * server auto-start and drive resolution exactly once.
 */
export const PORT = 7742;
export const BASE = `http://127.0.0.1:${PORT}`;

export interface Job {
  id: string;
  drive_id: string;
  kind: string;
  status: string;
  progress: number;
  message: string | null;
  phase: string | null;
  eta_seconds: number | null;
  error: string | null;
  result_json: string | null;
}

export interface Drive {
  id: string;
  name: string;
  nickname: string | null;
  mounted: boolean;
}

export interface Interlock {
  rekordbox_running: boolean;
  pid: number | null;
}

export async function apiGet(path: string): Promise<Response> {
  return fetch(`${BASE}${path}`);
}

export async function apiPost(path: string, body?: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
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

/** True when a job has reached a terminal state. */
export function jobTerminal(status: string): boolean {
  return ["done", "failed", "cancelled", "interrupted"].includes(status);
}

/** Block until a job finishes; returns the final job record. */
export async function waitForJob(
  jobId: string,
  opts: { timeoutMs?: number; onProgress?: (j: Job) => void } = {},
): Promise<Job> {
  const deadline = Date.now() + (opts.timeoutMs ?? 30 * 60 * 1000);
  let last = "";
  while (Date.now() < deadline) {
    const j = (await apiGet(`/api/jobs/${jobId}`).then((r) => r.json())) as Job;
    const key = `${j.status}:${j.progress}:${j.message}`;
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
