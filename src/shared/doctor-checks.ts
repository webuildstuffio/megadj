// doctor-checks.ts — the individual probe checks for `megadj doctor`
// (#42 item 2 split, out of doctor.ts): one CheckResult per external
// dependency/env/config value. doctor.ts keeps the runner, output, and
// `init` bootstrap. checkBin (#86 item 2) is the shared body for the
// binary-probe trio.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform, userInfo } from "node:os";
import type { CheckResult } from "./doctor";
import { nonEmptyEnv } from "./leaf/guards";
import { DECK_SERVICE_LABEL, classifyDeckService } from "../ops/deck-service";
import { resolveServerPort } from "../deck/server-port";

export const MUSIC_DIR =
  nonEmptyEnv("MEGADJ_MUSIC_DIR") ?? `${homedir()}/Music/DJ-Imports`;
export const CRATEDECK_DIR = join(import.meta.dir, "..", "deck");

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

/** One body for the "external binary present?" probes — checkBun /
 *  checkFfmpeg / checkYtdlp differ only in constants (#86 item 2). The
 *  named wrappers stay so doctor.ts's check list reads as data. */
function checkBin(
  id: string,
  label: string,
  bin: string,
  args: string[],
  fix: string,
): CheckResult {
  const v = binVersion(bin, args);
  return {
    id,
    label,
    required: true,
    ok: Boolean(v),
    detail: v ? `${bin} ${v}` : `${bin} not found`,
    fix,
  };
}

export function checkBun(): CheckResult {
  return checkBin(
    "bun",
    "bun runtime",
    "bun",
    ["--version"],
    "install: curl -fsSL https://bun.sh/install | bash",
  );
}

export function checkFfmpeg(): CheckResult {
  return checkBin(
    "ffmpeg",
    "ffmpeg + ffprobe",
    "ffmpeg",
    ["-version"],
    "brew install ffmpeg",
  );
}

export function checkYtdlp(): CheckResult {
  return checkBin(
    "ytdlp",
    "yt-dlp (GetDat downloads)",
    "yt-dlp",
    ["--version"],
    "brew install yt-dlp  ·  keep it current: brew upgrade yt-dlp",
  );
}

/** #257: SC likes/user pages need yt-dlp's impersonation support
 *  (curl_cffi). Warn-only — tracks/sets/search work without it; the fix
 *  is the one command. `--list-impersonate-targets` exits 0 and prints
 *  the target table; an install WITHOUT curl_cffi shows "(unavailable)". */
export function checkYtdlpImpersonate(): CheckResult {
  const path = have("yt-dlp");
  if (!path) {
    return {
      id: "ytdlp-impersonate",
      label: "yt-dlp impersonation (SC likes/user pages)",
      required: false,
      ok: false,
      detail: "yt-dlp not found (the yt-dlp check above covers the base)",
      fix: "brew install yt-dlp",
    };
  }
  const proc = Bun.spawnSync({
    cmd: ["yt-dlp", "--list-impersonate-targets"],
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = `${new TextDecoder().decode(proc.stdout)}${new TextDecoder().decode(proc.stderr)}`;
  // The target table prints one row per client, e.g.
  // "Tor       -    curl_cffi>=0.11 (unavailable)". Parse the curl_cffi
  // ROW and check the marker — a substring match on "available" alone
  // false-positives on "(unavailable)" (measured on this machine).
  const row = out.split("\n").find((l) => l.includes("curl_cffi")) ?? "";
  const available = row.length > 0 && !/unavailable/i.test(row);
  return {
    id: "ytdlp-impersonate",
    label: "yt-dlp impersonation (SC likes/user pages)",
    required: false,
    ok: available,
    detail: available
      ? `curl_cffi present — likes/user pages supported (${row.trim().split(/\s{2,}/)[0] ?? ""})`
      : "curl_cffi absent — single tracks/sets/search fine; likes & user pages will fail",
    fix: available
      ? undefined
      : "uv pip install --system curl_cffi  (or: pipx inject yt-dlp curl_cffi)",
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
      fix: ok ? undefined : "check the path, or run tools/export-cookies.sh",
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
    fix: "if sync hits age/consent walls: tools/export-cookies.sh, then set MEGADJ_COOKIES_FILE",
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
      label: "src/deck/config.toml",
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
      label: "src/deck/config.toml",
      required: false,
      ok: false,
      detail: `still has placeholder volume names (master=${info.master}, mirror=${info.mirror})`,
      fix: "edit master_drive/mirror_drive to your real USB volume names (Finder → drive → Get Info → Name)",
    };
  }
  if (!info.master || !info.mirror) {
    return {
      id: "cratedeck-config",
      label: "src/deck/config.toml",
      required: false,
      ok: false,
      detail: `exists but master_drive/mirror_drive not set (master=${info.master}, mirror=${info.mirror})`,
      fix: "add [library] master_drive/mirror_drive with your USB volume names, or run `megadj init`",
    };
  }
  return {
    id: "cratedeck-config",
    label: "src/deck/config.toml",
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

// ---- deck service (#247): the launchd-managed CrateDeck server probe ----

/** Port used for the health probe: the ONE resolver (server-port.ts), so
 *  doctor agrees with what the server and its clients would resolve.
 *  resolveServerPort itself gates on the config file existing, so the
 *  raw path is passed unconditionally; a throw is impossible on a valid
 *  env value and surfaces honestly otherwise (bad CRATEDECK_PORT is a
 *  real config error doctor SHOULD report, not swallow). */
function deckProbePort(): number {
  return resolveServerPort(
    process.env.CRATEDECK_PORT,
    join(CRATEDECK_DIR, "config.toml"),
  );
}

async function deckHttpProbe(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/interlock`, {
      signal: AbortSignal.timeout(1200),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** A bare (non-launchd) deck server answering on the port — the #247
 *  orphan class. pgrep for the entry file, since port answers could in
 *  principle be the service (checked first by the caller). */
function orphanDeckPids(): string[] {
  try {
    const p = Bun.spawnSync({
      cmd: ["pgrep", "-f", "src/deck/index.ts"],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (p.exitCode !== 0) return [];
    return new TextDecoder()
      .decode(p.stdout)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Is the launchd service loaded (and what pid does it report)? Reads
 *  via launchctl print — gui domain, this user. */
function deckServiceStatus(): { loaded: boolean; pid: number | null } {
  try {
    // userInfo().uid is the real posix uid — the homedir basename is a
    // USERNAME, and `gui/<name>/...` fails launchctl parsing (exit 64).
    const uid = userInfo().uid;
    const p = Bun.spawnSync({
      cmd: ["/bin/launchctl", "print", `gui/${uid}/${DECK_SERVICE_LABEL}`],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (p.exitCode !== 0) return { loaded: false, pid: null };
    const out = new TextDecoder().decode(p.stdout);
    const pid =
      /state = \d+\. running.*?pid = (\d+)/s.exec(out) ??
      /pid = (\d+)/.exec(out);
    const raw = pid?.[1];
    // finite-gated (boundary-number census): digits-only capture, but the
    // gate is cheap and keeps this file off the sanction list.
    const parsed = raw !== undefined ? Number(raw) : Number.NaN;
    return {
      loaded: true,
      pid: Number.isFinite(parsed) ? parsed : null,
    };
  } catch {
    return { loaded: false, pid: null };
  }
}

/** `megadj doctor`'s deck-server check (#247): the service SSOT's
 *  classifier, fed with launchctl + HTTP + orphan observations.
 *  required=false — the deck is a feature, not the whole toolkit — but
 *  the fix hint is concrete (deck:install / kickstart), never "see docs". */
export async function checkDeckService(): Promise<CheckResult> {
  const port = deckProbePort();
  const { loaded, pid } = deckServiceStatus();
  // The HTTP probe hits the RESOLVED port; a live answer means "a server
  // is up" regardless of who owns it. The orphan signal is pgrep-only:
  // when launchd knows the label, any pgrep hit IS the service (launchd
  // children match the same cmdline), so the orphan probe must not
  // double-fire. When launchd does NOT know the label, a pgrep hit that
  // answers HTTP is precisely the #247 orphan class (it may sit on a
  // non-default port — 59997 in the incident — which is fine: it is
  // still an unmanaged server to replace).
  const probeOk = await deckHttpProbe(port);
  const orphanHit = !loaded && orphanDeckPids().length > 0;
  const verdict = classifyDeckService({
    serviceLoaded: loaded,
    servicePid: pid,
    probeOk,
    orphanProbeOk: orphanHit,
  });
  return {
    id: "deck-service",
    label: "deck server (launchd)",
    required: false,
    ok: verdict.ok,
    detail: `${verdict.detail} · port ${port}`,
    fix: verdict.fix,
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
