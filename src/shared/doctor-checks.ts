// doctor-checks.ts — the individual probe checks for `megadj doctor`
// (#42 item 2 split, out of doctor.ts): one CheckResult per external
// dependency/env/config value. doctor.ts keeps the runner, output, and
// `init` bootstrap.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import type { CheckResult } from "./doctor-types";

export const MUSIC_DIR =
  process.env.MEGADJ_MUSIC_DIR ?? `${homedir()}/Music/DJ-Imports`;
export const CRATEDECK_DIR = join(import.meta.dir, "..", "..", "cratedeck");

export function have(bin: string): string | null {
  try {
    const p = Bun.spawnSync({
      cmd: ["which", bin],
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = new TextDecoder().decode(p.stdout).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function binVersion(bin: string, args: string[]): string | null {
  const path = have(bin);
  if (!path) return null;
  try {
    const p = Bun.spawnSync({
      cmd: [bin, ...args],
      stdout: "pipe",
      stderr: "pipe",
    });
    const out =
      new TextDecoder().decode(p.stdout) || new TextDecoder().decode(p.stderr);
    const m = out.match(/[\d]+\.[\d]+[^\s]*/);
    return m?.[0] ?? "present";
  } catch {
    return "present";
  }
}

export function runPython(stmt: string): boolean {
  const uvPath = have("uv");
  if (!uvPath) return false;
  const p = Bun.spawnSync({
    cmd: ["uv", "run", "--with", stmt, "python", "-c", `import ${stmt}`],
    stdout: "pipe",
    stderr: "pipe",
  });
  return p.exitCode === 0;
}

// ---- individual checks ------------------------------------------------------
export function checkPlatform(): CheckResult {
  const mac = platform() === "darwin";
  // os.version() is kernel-build on some runtimes — use sw_vers for the
  // marketing version (e.g. "15.6") and fall back gracefully.
  let ver = "";
  if (mac) {
    try {
      const p = Bun.spawnSync({
        cmd: ["sw_vers", "-productVersion"],
        stdout: "pipe",
      });
      ver = new TextDecoder().decode(p.stdout).trim();
    } catch (e) {
      // cosmetic version probe — the pass/fail verdict (mac) is unchanged;
      // a failure to read the version still gets reported.
      console.error("sw_vers probe failed", e);
    }
  }
  return {
    id: "platform",
    label: "macOS",
    required: true,
    ok: mac,
    detail: mac
      ? `macOS ${ver || platform()}`
      : `${platform()} — megadj is macOS-only by design (Principle 2)`,
    fix: mac
      ? undefined
      : "megadj targets macOS + Pioneer exclusively. There is no cross-platform plan.",
  };
}

export function checkBun(): CheckResult {
  const v = binVersion("bun", ["--version"]);
  return {
    id: "bun",
    label: "bun runtime",
    required: true,
    ok: Boolean(v),
    detail: v ? `bun ${v}` : "bun not found",
    fix: "install: curl -fsSL https://bun.sh/install | bash",
  };
}

export function checkFfmpeg(): CheckResult {
  const v = binVersion("ffmpeg", ["-version"]);
  return {
    id: "ffmpeg",
    label: "ffmpeg + ffprobe",
    required: true,
    ok: Boolean(v),
    detail: v ? `ffmpeg ${v}` : "ffmpeg not found",
    fix: "brew install ffmpeg",
  };
}

export function checkYtdlp(): CheckResult {
  const v = binVersion("yt-dlp", ["--version"]);
  return {
    id: "ytdlp",
    label: "yt-dlp (GetDat downloads)",
    required: true,
    ok: Boolean(v),
    detail: v ? `yt-dlp ${v}` : "yt-dlp not found",
    fix: "brew install yt-dlp  ·  keep it current: brew upgrade yt-dlp",
  };
}

export function checkUvPython(): CheckResult {
  const uv = binVersion("uv", ["--version"]);
  if (!uv) {
    return {
      id: "uv",
      label: "uv + python (ground-truth tag readers)",
      required: true,
      ok: false,
      detail:
        "uv not found — tag ground-truth reads use `uv run --with mutagen python`",
      fix: "curl -LsSf https://astral.sh/uv/install.sh | sh",
    };
  }
  const mutagen = runPython("mutagen");
  return {
    id: "uv",
    label: "uv + python + mutagen",
    required: true,
    ok: mutagen,
    detail: mutagen
      ? `${uv}, mutagen imports`
      : "mutagen failed to import via uv",
    fix: mutagen
      ? undefined
      : "uv run --with mutagen python -c 'import mutagen'  (inspect the error)",
  };
}

export function checkPyrekordbox(): CheckResult {
  const ok = runPython("pyrekordbox");
  return {
    id: "pyrekordbox",
    label: "pyrekordbox (CrateDeck dual-DB reads)",
    required: false,
    ok,
    detail: ok ? "imports" : "not installed — CrateDeck full scans will fail",
    fix: "uv pip install pyrekordbox   (or: uv run --with pyrekordbox …)",
  };
}

export function checkOpenrouter(): CheckResult {
  const key = process.env.OPENROUTER_API_KEY;
  return {
    id: "openrouter",
    label: "OPENROUTER_API_KEY (AI genre/year/artwork fallback)",
    required: false,
    ok: Boolean(key),
    detail: key
      ? "set"
      : "not set — AI gap-filling and `megadj artwork` disabled (everything else works)",
    fix: "export OPENROUTER_API_KEY=sk-or-…  (load from your keychain; never hardcode)",
  };
}

export function checkCookies(): CheckResult {
  const file = process.env.MEGADJ_COOKIES_FILE;
  if (file) {
    const ok = existsSync(file);
    return {
      id: "cookies",
      label: "yt-dlp cookies",
      required: false,
      ok,
      detail: ok
        ? `file: ${file}`
        : `MEGADJ_COOKIES_FILE set but missing: ${file}`,
      fix: ok ? undefined : "check the path, or run scripts/export-cookies.sh",
    };
  }
  const browser = process.env.MEGADJ_COOKIES ?? "chrome";
  if (!browser) {
    return {
      id: "cookies",
      label: "yt-dlp cookies",
      required: false,
      ok: true,
      detail: "disabled (MEGADJ_COOKIES empty) — fine for public tracks",
    };
  }
  return {
    id: "cookies",
    label: `yt-dlp cookies (browser: ${browser})`,
    required: false,
    ok: true,
    detail:
      "will use browser cookies at sync time — verified live on first sync",
    fix: "if sync hits age/consent walls: scripts/export-cookies.sh, then set MEGADJ_COOKIES_FILE",
  };
}

export interface CrateTomlInfo {
  exists: boolean;
  master: string | null;
  mirror: string | null;
  placeholder: boolean;
}

export function readCrateConfig(): CrateTomlInfo {
  const p = join(CRATEDECK_DIR, "config.toml");
  if (!existsSync(p))
    return { exists: false, master: null, mirror: null, placeholder: false };
  const src = readFileSync(p, "utf8");
  const grab = (key: string): string | null =>
    src.match(new RegExp(`${key}\\s*=\\s*"([^"]+)"`))?.[1] ?? null;
  const master = grab("master_drive");
  const mirror = grab("mirror_drive");
  const placeholder = master === "DJMASTER" || mirror === "DJMIRROR";
  return { exists: true, master, mirror, placeholder };
}

export function checkCrateConfig(): CheckResult {
  const info = readCrateConfig();
  if (!info.exists) {
    return {
      id: "cratedeck-config",
      label: "cratedeck/config.toml",
      required: false,
      ok: false,
      detail:
        "missing — CrateDeck sync status needs your master/mirror volume names",
      fix: "run `megadj init` (copies the sample; edit master_drive/mirror_drive)",
    };
  }
  if (info.placeholder) {
    return {
      id: "cratedeck-config",
      label: "cratedeck/config.toml",
      required: false,
      ok: false,
      detail: `still has placeholder volume names (master=${info.master}, mirror=${info.mirror})`,
      fix: "edit master_drive/mirror_drive to your real USB volume names (Finder → drive → Get Info → Name)",
    };
  }
  if (!info.master || !info.mirror) {
    return {
      id: "cratedeck-config",
      label: "cratedeck/config.toml",
      required: false,
      ok: false,
      detail: `exists but master_drive/mirror_drive not set (master=${info.master}, mirror=${info.mirror})`,
      fix: "add [library] master_drive/mirror_drive with your USB volume names, or run `megadj init`",
    };
  }
  return {
    id: "cratedeck-config",
    label: "cratedeck/config.toml",
    required: false,
    ok: true,
    detail: `master=${info.master}, mirror=${info.mirror}`,
  };
}

export function checkMusicDir(): CheckResult {
  const ok = existsSync(MUSIC_DIR);
  return {
    id: "music-dir",
    label: "archive folder",
    required: false,
    ok,
    detail: `${MUSIC_DIR}${ok ? "" : " (will be created on first sync/ingest)"}`,
  };
}

// ---- init bootstrap helpers (#210): pure config/volume helpers that
// doctor.ts's runInit sequences. No spawn/IO beyond readdir. --------------

/** Mounted volumes worth offering as drives (excludes system/junk mounts). */
export function detectVolumes(): string[] {
  try {
    return readdirSync("/Volumes")
      .filter((n) => n !== "Macintosh HD" && !n.startsWith("Macintosh HD "))
      .toSorted();
  } catch {
    return [];
  }
}

/** Set one TOML key to a quoted value when present, else pass through.
 *  Pure — module-level, not re-created per `applyDriveNames` call. */
const setTomlKey = (c: string, key: string, val: string): string =>
  new RegExp(`^\\s*${key}\\s*=`, "m").test(c)
    ? c.replace(new RegExp(`^(\\s*${key}\\s*=\\s*).*$`, "m"), `$1"${val}"`)
    : c;

export function applyDriveNames(
  cfg: string,
  master: string,
  mirror: string,
): string {
  return setTomlKey(
    setTomlKey(cfg, "master_drive", master),
    "mirror_drive",
    mirror,
  );
}
