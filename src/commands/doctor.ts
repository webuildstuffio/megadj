/**
 * doctor.ts — `megadj doctor` / `megadj init`.
 *
 * doctor: one-shot diagnostics for every external dependency, env var, and
 * config value the toolkit needs. Exits 1 if anything required is broken so
 * it works as a CI/job gate too.
 *
 * init: first-run bootstrap — writes cratedeck/config.toml from the sample
 * (never overwrites an existing one), then runs doctor.
 *
 * Checks:
 *   bun          runtime (always present when run via bun, but version-pinned sanity)
 *   ffmpeg/ffprobe  art embedding, wav→aiff, probes
 *   yt-dlp       GetDat downloads (optional but core)
 *   uv + python  ground-truth tag readers (mutagen)
 *   pyrekordbox  CrateDeck dual-DB reads (optional)
 *   OPENROUTER_API_KEY  AI genre/year fallback + artwork (optional)
 *   cookies      browser cookie access for yt-dlp (optional)
 *   cratedeck/config.toml  exists + master/mirror drives set (init can fix)
 */
import { existsSync, readFileSync, copyFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

export interface DoctorOptions {
  /** Print JSON instead of human text (agents, CI). */
  json?: boolean;
  /** Only report; don't offer fixes. (init uses this internally.) */
  quietFixes?: boolean;
}

export interface CheckResult {
  id: string;
  label: string;
  /** required = toolkit unusable without it; optional = feature-scoped. */
  required: boolean;
  ok: boolean;
  detail: string;
  fix?: string;
}

const MUSIC_DIR =
  process.env.MEGADJ_MUSIC_DIR ?? `${homedir()}/Music/DJ-Imports`;
const CRATEDECK_DIR = join(import.meta.dir, "..", "..", "cratedeck");

function have(bin: string): string | null {
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

function binVersion(bin: string, args: string[]): string | null {
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

function runPython(stmt: string): boolean {
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
function checkPlatform(): CheckResult {
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

function checkBun(): CheckResult {
  const v = binVersion("bun", ["--version"]);
  return {
    id: "bun",
    label: "bun runtime",
    required: true,
    ok: !!v,
    detail: v ? `bun ${v}` : "bun not found",
    fix: "install: curl -fsSL https://bun.sh/install | bash",
  };
}

function checkFfmpeg(): CheckResult {
  const v = binVersion("ffmpeg", ["-version"]);
  return {
    id: "ffmpeg",
    label: "ffmpeg + ffprobe",
    required: true,
    ok: !!v,
    detail: v ? `ffmpeg ${v}` : "ffmpeg not found",
    fix: "brew install ffmpeg",
  };
}

function checkYtdlp(): CheckResult {
  const v = binVersion("yt-dlp", ["--version"]);
  return {
    id: "ytdlp",
    label: "yt-dlp (GetDat downloads)",
    required: true,
    ok: !!v,
    detail: v ? `yt-dlp ${v}` : "yt-dlp not found",
    fix: "brew install yt-dlp  ·  keep it current: brew upgrade yt-dlp",
  };
}

function checkUvPython(): CheckResult {
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

function checkPyrekordbox(): CheckResult {
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

function checkOpenrouter(): CheckResult {
  const key = process.env.OPENROUTER_API_KEY;
  return {
    id: "openrouter",
    label: "OPENROUTER_API_KEY (AI genre/year/artwork fallback)",
    required: false,
    ok: !!key,
    detail: key
      ? "set"
      : "not set — AI gap-filling and `megadj artwork` disabled (everything else works)",
    fix: "export OPENROUTER_API_KEY=sk-or-…  (load from your keychain; never hardcode)",
  };
}

function checkCookies(): CheckResult {
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

interface CrateTomlInfo {
  exists: boolean;
  master: string | null;
  mirror: string | null;
  placeholder: boolean;
}

function readCrateConfig(): CrateTomlInfo {
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

function checkCrateConfig(): CheckResult {
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

function checkMusicDir(): CheckResult {
  const ok = existsSync(MUSIC_DIR);
  return {
    id: "music-dir",
    label: "archive folder",
    required: false,
    ok,
    detail: `${MUSIC_DIR}${ok ? "" : " (will be created on first sync/ingest)"}`,
  };
}

export function runDoctor(): CheckResult[] {
  return [
    checkPlatform(),
    checkBun(),
    checkFfmpeg(),
    checkYtdlp(),
    checkUvPython(),
    checkPyrekordbox(),
    checkOpenrouter(),
    checkCookies(),
    checkCrateConfig(),
    checkMusicDir(),
  ];
}

// ---- output -----------------------------------------------------------------
const MARK = { pass: "✓", warn: "▲", fail: "✕" } as const;

function markFor(c: CheckResult): keyof typeof MARK {
  return c.ok ? "pass" : c.required ? "fail" : "warn";
}

export function printDoctor(results: CheckResult[]): number {
  const broken = results.filter((c) => !c.ok && c.required);
  const warn = results.filter((c) => !c.ok && !c.required);
  const oks = results.filter((c) => c.ok);

  console.log(
    `megadj doctor — ${oks.length} ok, ${warn.length} optional, ${broken.length} broken\n`,
  );
  for (const c of results) {
    const m = markFor(c);
    console.log(`${MARK[m]} ${c.label}: ${c.detail}`);
    if (!c.ok && c.fix) console.log(`   fix: ${c.fix}`);
  }
  console.log("");
  if (broken.length) {
    console.log(
      `${broken.length} required check(s) failing — fix those first.`,
    );
  } else {
    console.log(
      "All required checks pass. Optional gaps only narrow features:",
    );
    console.log("  · pyrekordbox  → CrateDeck dual-DB reads");
    console.log(
      "  · OPENROUTER_API_KEY → AI genre/year fill + artwork generation",
    );
  }
  return broken.length ? 1 : 0;
}

export function doctorJson(results: CheckResult[]): string {
  const broken = results.filter((c) => !c.ok && c.required).length;
  return JSON.stringify(
    {
      ok: broken === 0,
      required_broken: broken,
      checks: results.map((c) => ({ ...c, fix: c.ok ? undefined : c.fix })),
    },
    null,
    2,
  );
}

// ---- init -------------------------------------------------------------------
/** Mounted volumes worth offering as drives (excludes system/junk mounts). */
export function detectVolumes(): string[] {
  try {
    return readdirSync("/Volumes")
      .filter((n) => n !== "Macintosh HD" && !n.startsWith("Macintosh HD "))
      .sort();
  } catch {
    return [];
  }
}

/** Rewrite the [library] drive names in a config.toml string. */
export function applyDriveNames(
  cfg: string,
  master: string,
  mirror: string,
): string {
  const set = (c: string, key: string, val: string): string =>
    new RegExp(`^\\s*${key}\\s*=`, "m").test(c)
      ? c.replace(new RegExp(`^(\\s*${key}\\s*=\\s*).*$`, "m"), `$1"${val}"`)
      : c;
  return set(set(cfg, "master_drive", master), "mirror_drive", mirror);
}

export function runInit(): number {
  const sample = join(CRATEDECK_DIR, "config.sample.toml");
  const target = join(CRATEDECK_DIR, "config.toml");
  let didScaffold = false;
  if (existsSync(target)) {
    console.log(`cratedeck/config.toml already exists — leaving it alone`);
  } else if (existsSync(sample)) {
    copyFileSync(sample, target);
    didScaffold = true;
    console.log(`✓ scaffolded cratedeck/config.toml from config.sample.toml`);
  } else {
    console.log(
      `! config.sample.toml not found at ${sample} — skipping scaffold`,
    );
  }

  // Auto-detect mounted USB volumes and write them into the scaffolded config
  // so the very first run works without hand-editing. Only two (or one, when
  // mirror just mirrors master) mounted non-system volumes → unambiguous.
  if (didScaffold) {
    const vols = detectVolumes();
    const candidates = vols.filter(
      (v) => !v.startsWith("com.apple.") && !v.startsWith("Time Machine"),
    );
    if (candidates.length === 2) {
      const [master, mirror] = candidates as [string, string];
      const cfg = readFileSync(target, "utf8");
      const next = applyDriveNames(cfg, master, mirror);
      if (next !== cfg) {
        writeFileSync(target, next);
        console.log(
          `✓ detected mounted volumes → master_drive="${master}", mirror_drive="${mirror}"`,
        );
        didScaffold = false; // fully configured; skip the "edit it" hint
      }
    } else if (candidates.length > 2) {
      console.log(
        `! ${candidates.length} volumes mounted (${candidates.join(", ")}) — edit cratedeck/config.toml to pick master/mirror`,
      );
    }
  }

  const results = runDoctor();
  const code = printDoctor(results);
  if (didScaffold) {
    console.log(
      `next: edit cratedeck/config.toml → set master_drive/mirror_drive to your USB volume names, then re-run \`megadj doctor\``,
    );
  }
  return code;
}
