// rb.ts — THE Python seam. Only this file spawns processes.
// Reads go through python/rb_read.py (which imports the skill's canonical
// anlz_paths + pdb_live_rows). Deep jobs wrap usb_verify.py / usb_mirror.py.
import { mkdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { SnapshotData } from "../shared/types";
import type { Guard } from "./guard";
import type { CrateConfig } from "./config";

const RB = "rekordbox";

export function rekordboxRunning(): { running: boolean; pid: number | null } {
  const p = Bun.spawnSync(["pgrep", "-x", RB], { stdout: "pipe" });
  const out = p.stdout.toString().trim();
  const pid = out ? parseInt(out.split("\n")[0], 10) : null;
  return { running: !!out, pid: pid && !isNaN(pid) ? pid : null };
}

const UV = "uv";
const PYREKORDBOX =
  "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git";

/** Full rekordbox snapshot of a mounted drive. Throws on interlock or error. */
export function rbSnapshot(
  cfg: CrateConfig,
  guard: Guard,
  mountPoint: string,
): SnapshotData {
  const lock = rekordboxRunning();
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
  guard.write(scratch + "/", ""); // create via guard (allowed: data/)
  mkdirSync(scratch, { recursive: true });
  for (const f of [
    "exportLibrary.db",
    "exportLibrary.db-wal",
    "exportLibrary.db-shm",
  ]) {
    const src = join(mountPoint, "PIONEER", "rekordbox", f);
    if (exists(src)) {
      require("node:fs").copyFileSync(src, join(scratch, f));
      guard.assertAllowed(join(scratch, f)); // dest under data/ — enforced
    }
  }

  const proc = Bun.spawnSync(
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
    { stdout: "pipe", stderr: "pipe", cwd: cfg.root, timeout: 120_000 },
  );
  const out = proc.stdout.toString().trim();
  let parsed: { ok: boolean; snapshot?: SnapshotData; error?: string };
  try {
    parsed = JSON.parse(out.split("\n").filter(Boolean).pop() ?? "");
  } catch {
    throw new Error(
      `rb_read failed: ${proc.stderr.toString().slice(0, 400) || "no output"}`,
    );
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
  const m = line.match(/\[(\#+|-*)\]\s*(\d+)\/(\d+)/);
  if (m) {
    const done = parseInt(m[2], 10);
    const total = parseInt(m[3], 10);
    return total ? done / total : null;
  }
  const pct = line.match(/\b(\d{1,3})%/);
  return pct ? parseInt(pct[1], 10) / 100 : null;
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
