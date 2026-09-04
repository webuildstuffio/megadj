// rb.ts — THE Python seam. Only this file spawns processes.
// Reads go through python/rb_read.py (which imports the skill's canonical
// anlz_paths + pdb_live_rows). Deep jobs wrap usb_verify.py / usb_mirror.py.
import { copyFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { SnapshotData } from "../shared/types";
import type { Guard } from "./guard";
import type { CrateConfig } from "./config";

const RB = "rekordbox";

// The interlock is polled by every job enqueue, every /api/interlock request
// and every rbSnapshot. pgrep is cheap but not free — cache the verdict for
// 1s (rekordbox starting mid-job is re-checked at job start regardless).
let interlockCache: {
  at: number;
  running: boolean;
  pid: number | null;
} | null = null;
const INTERLOCK_TTL_MS = 1_000;

export function rekordboxRunning(opts?: { fresh?: boolean }): {
  running: boolean;
  pid: number | null;
} {
  const now = Date.now();
  if (
    !opts?.fresh &&
    interlockCache &&
    now - interlockCache.at < INTERLOCK_TTL_MS
  )
    return interlockCache;
  const p = Bun.spawnSync(["pgrep", "-x", RB], { stdout: "pipe" });
  const out = p.stdout.toString().trim();
  const pid = out ? parseInt(out.split("\n")[0] ?? "", 10) : null;
  const result = {
    running: !!out,
    pid: pid !== null && !Number.isNaN(pid) ? pid : null,
  };
  interlockCache = { at: now, ...result };
  return result;
}

const UV = "uv";
const PYREKORDBOX =
  "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git";

/** Full rekordbox snapshot of a mounted drive. Throws on interlock or error. */
export async function rbSnapshot(
  cfg: CrateConfig,
  guard: Guard,
  mountPoint: string,
): Promise<SnapshotData> {
  // fresh check: this is the safety gate for a long DB read — never trust a
  // cached verdict here (rekordbox could have started within the TTL window).
  const lock = rekordboxRunning({ fresh: true });
  if (lock.running) {
    throw new Error(
      `REKORDBOX_RUNNING (pid ${lock.pid}) — hands off the drives`,
    );
  }

  const dbOnDrive = join(
    mountPoint,
    "PIONEER",
    "rekordbox",
    "exportLibrary.db",
  );
  if (!exists(dbOnDrive))
    throw new Error(`no rekordbox device DB at ${dbOnDrive}`);

  const scratch = join(
    cfg.scratchDir,
    sanitize(basename(mountPoint)),
    String(Date.now()),
  );
  guard.mkdir(scratch); // dest under data/ — the only allowed write root
  for (const f of [
    "exportLibrary.db",
    "exportLibrary.db-wal",
    "exportLibrary.db-shm",
  ]) {
    const src = join(mountPoint, "PIONEER", "rekordbox", f);
    if (exists(src)) {
      const dest = join(scratch, f);
      guard.assertAllowed(dest); // enforce before the copy, not after
      copyFileSync(src, dest);
    }
  }

  const proc = Bun.spawn(
    [
      UV,
      "run",
      "--with",
      PYREKORDBOX,
      "python",
      join(cfg.root, "python", "rb_read.py"),
      join(scratch, "exportLibrary.db"),
      mountPoint,
    ],
    { stdout: "pipe", stderr: "pipe", cwd: cfg.root },
  );
  const timeout = setTimeout(() => proc.kill(), 120_000);
  let out: string;
  let err: string;
  try {
    // async read: keeps the HTTP/SSE server responsive during the 10-90s run
    [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
  } finally {
    clearTimeout(timeout);
  }

  const last = out.trim().split("\n").filter(Boolean).pop() ?? "";
  let parsed: { ok: boolean; snapshot?: SnapshotData; error?: string };
  try {
    parsed = JSON.parse(last);
  } catch {
    throw new Error(`rb_read failed: ${err.slice(0, 400) || "no output"}`);
  }
  if (!parsed.ok) throw new Error(parsed.error ?? "rb_read failed");
  return parsed.snapshot!;
}

/** Spawn usb_verify.py / usb_mirror.py as a long-running job process. */
export function spawnVerify(
  cfg: CrateConfig,
  driveNames: string[],
): Bun.Subprocess {
  return Bun.spawn(
    [
      UV,
      "run",
      "--with",
      PYREKORDBOX,
      "python",
      "-u", // unbuffered — piped python output must reach the job log live
      join(
        cfg.root,
        "..",
        ".claude",
        "skills",
        "rekordbox-usb-sync",
        "scripts",
        "usb_verify.py",
      ),
      "--drives",
      ...driveNames,
    ],
    { stdout: "pipe", stderr: "pipe", cwd: cfg.root },
  );
}

export function spawnMirror(
  cfg: CrateConfig,
  extraArgs: string[],
): Bun.Subprocess {
  return Bun.spawn(
    [
      UV,
      "run",
      "python",
      "-u", // unbuffered — see spawnVerify
      join(
        cfg.root,
        "..",
        ".claude",
        "skills",
        "rekordbox-usb-sync",
        "scripts",
        "usb_mirror.py",
      ),
      ...extraArgs,
    ],
    { stdout: "pipe", stderr: "pipe", cwd: cfg.root },
  );
}

/** Parse mirror/verify stdout milestones into 0..1 progress. */
export function progressFromLine(line: string): number | null {
  const m = line.match(/\[(#+|-*)\]\s*(\d+)\/(\d+)/);
  if (m?.[2] && m[3]) {
    const done = parseInt(m[2], 10);
    const total = parseInt(m[3], 10);
    return total ? done / total : null;
  }
  const pct = line.match(/\b(\d{1,3})%/);
  return pct?.[1] ? parseInt(pct[1], 10) / 100 : null;
}

function exists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, "_");
}
