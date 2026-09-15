/**
 * md5-cli — THE md5 digest seam (one implementation, every caller).
 *
 * Previously two hand-rolled twin spawns (shelf-restore/shelf-sync's
 * md5Cli and shelf-hygiene's inline closure) — jscpd-class drift, and
 * both were single-shot: one transient md5 failure under load (the
 * test-suite's parallel workers or a busy box) silently degraded the
 * caller — hygiene dropped the file from twin detection, shelf-sync
 * mis-judged "already there". Now: one retrying seam, short backoff
 * tuned for transient resource pressure, deterministic in tests.
 *
 * null means the bytes were NOT verified (missing file, non-transient
 * failure) — every caller keeps its explicit degrade contract.
 */
import { existsSync } from "node:fs";

/** Attempts for one digest: 1 call + 2 transient-failure retries. */
const MD5_ATTEMPTS = 3;
/** Backoff between attempts (ms) — short: transient spawn pressure clears
 *  in milliseconds; longer waits would stall whole-shelf md5 passes. */
const MD5_BACKOFF_MS = 50;
/** Bun.sleepSync exists since Bun 1.1 — deterministic, no `sleep` spawn. */
const sleepSync = Bun.sleepSync;

/** Retry only what a re-run could fix: process-level resource pressure.
 *  A real failure (ENOENT, unreadable file) returns immediately — retrying
 *  those would stall whole-shelf passes for nothing. */
function isTransientSpawnError(stderr: string): boolean {
  const s = stderr.toLowerCase();
  return (
    s.includes("resource") ||
    s.includes("emfile") ||
    s.includes("enfile") ||
    s.includes("eagain") ||
    s.includes("interrupted system call")
  );
}

/**
 * One digest via the macOS `md5` CLI: single call + transient-failure
 * retries (50ms backoff). Null when the file is absent, the digest is
 * empty, or the failure is NOT transient — callers decide what an
 * unverified file means for their pass.
 */
export function md5Cli(path: string): string | null {
  if (!existsSync(path)) return null;
  for (let attempt = 1; attempt <= MD5_ATTEMPTS; attempt++) {
    const r = Bun.spawnSync(["md5", "-q", path]);
    if (r.exitCode === 0) {
      const hash = r.stdout.toString().trim();
      if (hash.length > 0) return hash;
      // empty stdout with exit 0 — malformed boundary, retry once more
      // below (exit-code path) rather than degrade silently
    }
    const stderr = r.stderr.toString().trim();
    const transient = r.exitCode !== 0 ? isTransientSpawnError(stderr) : true;
    if (!transient || attempt === MD5_ATTEMPTS) {
      if (r.exitCode !== 0 && stderr.length > 0) {
        console.error(`md5: ${path}: ${stderr}`);
      }
      return null;
    }
    sleepSync(MD5_BACKOFF_MS);
  }
  return null; // unreachable: loop returns on every path
}
