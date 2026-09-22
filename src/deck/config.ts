// Config — config.toml + env, validated once at boot.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FLEET_PROFILES, DEFAULT_FLEET } from "../fulltags/booth/fleet";
import { isUnknownArray, nonEmptyEnv } from "../shared/leaf/guards";
import { resolveServerPort } from "./server-port";

export type ImageProvider = "brave" | "exa";

export interface CrateConfig {
  root: string; // cratedeck/ dir
  dataDir: string;
  dbPath: string;
  scratchDir: string;
  imagesDir: string;
  serverPort: number;
  volumesRoot: string;
  masterDrive: string;
  mirrorDrive: string;
  /** The shelf/archive drive volume name (default "SHELF1") — the
   *  archive-grade master master that gig sticks sync FROM. */
  shelfDrive: string;
  imageProvider: ImageProvider | null;
  imageKey: string | null;
  verifyTimeoutMin: number;
  /** Hard kill for a hung mirror sync (minutes; default 90). */
  mirrorTimeoutMin: number;
  /** Hard wall-clock budget for ANY job, spawn-backed or not (minutes;
   *  default 120). The last-resort bound: benchmark/checksum/scan legs that
   *  have no subprocess timeout cannot hang past this. */
  jobTimeoutMin: number;
  /** Cancel a running job whose progress hasn't moved for this long
   *  (minutes; default 10) — the "always spinning" killer. */
  stallTimeoutMin: number;
  benchmarkMb: number;
  /** Auto light-scan a drive when it mounts (default: on). */
  autoScanOnMount: boolean;
  /** Re-verify drives whose last verify is older than this many days (0 = off). */
  verifyIntervalDays: number;
  /** megadj's archive DB (O82b archive tools read it; never written). */
  archiveDbPath: string;
  /** megadj's music tree (D30 sweep hashes it; never written). */
  musicDir: string;
  /** Raw [players.players] section — name → "device" | "onelibrary" (N75). */
  extraPlayers: Record<string, string>;
  /** [booth] fleet — player ids the user's checks must satisfy. Every
   *  player in fulltags FLEET_PROFILES is selectable; XDJ-XZ/CDJ-3000/
   *  CDJ-2000NXS2 default on. Audits + the web settings UI derive the
   *  compat floor from this. */
  boothFleet: string[];
  /** Resolved uv binary path for pyrekordbox spawns (see loadConfig). */
  uvPath: string;
}

/** Raw TOML value: what the tiny parser can produce. */
type TomlValue = string | string[] | number | boolean | TomlTable;
interface TomlTable {
  [key: string]: TomlValue;
}

function isTomlTable(v: TomlValue | undefined): v is TomlTable {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseTomlSimple(src: string): TomlTable {
  // Tiny flat/nested toml reader for our known shape (no deps).
  const out: TomlTable = {};
  let section: TomlTable = out;
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec?.[1]) {
      section = out;
      for (const p of sec[1].split(".")) {
        const next = section[p];
        if (!isTomlTable(next)) {
          const fresh: TomlTable = {};
          section[p] = fresh;
          section = fresh;
        } else {
          section = next;
        }
      }
      continue;
    }
    // quoted strings FIRST: a "#" inside quotes is data, not a comment
    // (API keys contain hashes: key = "abc#123"), and a quoted value is
    // never a boolean/number candidate. The old single path stripped the
    // comment before de-quoting, truncating every key at its first "#".
    const kvQ = line.match(/^([A-Za-z0-9_]+)\s*=\s*"([^"]*)"\s*(?:#.*)?$/);
    if (kvQ?.[1]) {
      section[kvQ[1]!] = kvQ[2] ?? "";
      continue;
    }
    const kvArray = line.match(
      /^([A-Za-z0-9_]+)\s*=\s*(\[[^\]]*\])\s*(?:#.*)?$/,
    );
    if (kvArray?.[1] && kvArray[2]) {
      let value: unknown;
      try {
        value = JSON.parse(kvArray[2]);
      } catch (error) {
        throw new Error(`config: invalid string array for ${kvArray[1]}`, {
          cause: error,
        });
      }
      if (
        !isUnknownArray(value) ||
        !value.every((item) => typeof item === "string")
      )
        throw new Error(`config: ${kvArray[1]} must be a string array`);
      section[kvArray[1]] = value;
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+?)\s*(?:#.*)?$/);
    if (kv?.[1] && kv[2]) {
      let v: TomlValue = kv[2];
      if (v === "true") v = true;
      else if (v === "false") v = false;
      else if (/^\d+$/.test(v)) v = parseInt(v, 10);
      section[kv[1]!] = v;
    }
  }
  return out;
}

export function loadConfig(root: string): CrateConfig {
  const cfgPath = join(root, "config.toml");
  const file = existsSync(cfgPath)
    ? parseTomlSimple(readFileSync(cfgPath, "utf8"))
    : {};
  const library = isTomlTable(file.library) ? file.library : {};
  const images = isTomlTable(file.images) ? file.images : {};
  const jobs = isTomlTable(file.jobs) ? file.jobs : {};
  const automation = isTomlTable(file.automation) ? file.automation : {};
  const rawImageProvider =
    typeof images.provider === "string"
      ? images.provider
      : process.env.CRATEDECK_IMAGE_PROVIDER;
  if (
    rawImageProvider !== undefined &&
    rawImageProvider !== "brave" &&
    rawImageProvider !== "exa"
  ) {
    throw new Error(`config: unknown images.provider '${rawImageProvider}'`);
  }
  const dataDir = nonEmptyEnv("CRATEDECK_DATA") ?? join(root, "data");
  const cfg: CrateConfig = {
    root,
    dataDir,
    dbPath: join(dataDir, "cratedeck.sqlite"),
    scratchDir: join(dataDir, "scratch"),
    imagesDir: join(dataDir, "images"),
    // #227: THE strict port resolver (env → config → default; invalid
    // env throws loudly instead of the old `||` silent rank-fallthrough)
    serverPort: resolveServerPort(
      process.env.CRATEDECK_PORT,
      join(root, "config.toml"),
    ),
    volumesRoot: nonEmptyEnv("CRATEDECK_VOLUMES") ?? "/Volumes",
    masterDrive:
      typeof library.master_drive === "string"
        ? library.master_drive
        : "DJMASTER",
    mirrorDrive:
      typeof library.mirror_drive === "string"
        ? library.mirror_drive
        : "DJMIRROR",
    shelfDrive:
      typeof library.shelf_drive === "string" ? library.shelf_drive : "SHELF1",
    imageProvider: rawImageProvider ?? null,
    imageKey:
      (typeof images.key === "string" && images.key !== ""
        ? images.key
        : undefined) ??
      nonEmptyEnv("CRATEDECK_IMAGE_KEY") ??
      nonEmptyEnv("EXA_API_KEY") ??
      null,
    verifyTimeoutMin:
      typeof jobs.verify_timeout_min === "number"
        ? jobs.verify_timeout_min
        : 40,
    mirrorTimeoutMin:
      typeof jobs.mirror_timeout_min === "number"
        ? jobs.mirror_timeout_min
        : 90,
    jobTimeoutMin:
      typeof jobs.job_timeout_min === "number" && jobs.job_timeout_min > 0
        ? jobs.job_timeout_min
        : 120,
    stallTimeoutMin:
      typeof jobs.stall_timeout_min === "number" && jobs.stall_timeout_min > 0
        ? jobs.stall_timeout_min
        : 15,
    benchmarkMb:
      typeof jobs.benchmark_mb === "number" ? jobs.benchmark_mb : 512,
    autoScanOnMount:
      typeof automation.auto_scan_on_mount === "boolean"
        ? automation.auto_scan_on_mount
        : true,
    verifyIntervalDays:
      typeof automation.verify_interval_days === "number"
        ? automation.verify_interval_days
        : 7,
    archiveDbPath:
      nonEmptyEnv("MEGADJ_DB") ??
      `${process.env.HOME}/.local/state/megadj/archive.db`,
    musicDir:
      nonEmptyEnv("MEGADJ_MUSIC_DIR") ?? `${process.env.HOME}/Music/DJ-Imports`,
    // The uv binary for every pyrekordbox spawn (rb.ts, spawnVerify,
    // spawnMirror). The launchd deck server's PATH lacks ~/.local/bin, so
    // a bare "uv" 404s unattended (live: auto-verify job 6b37500c failed
    // 'Executable not found in $PATH: "uv"', Sep 20). Resolution: env
    // override → the standard install location → bare name (PATH) so
    // dev shells and hermetic test envs keep working.
    uvPath: (() => {
      const candidates = [
        process.env.MEGADJ_UV_BIN,
        process.env.UV_BIN,
        `${process.env.HOME}/.local/bin/uv`,
      ].filter((p): p is string => typeof p === "string" && p.length > 0);
      for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
      }
      return "uv";
    })(),
    // [players.players] MY-XDJ = "device" — user-added players for the N75
    // compatibility matrix (players.ts merges them with the vendor defaults).
    extraPlayers: (() => {
      const players = isTomlTable(file.players) ? file.players : {};
      const inner = isTomlTable(players.players) ? players.players : {};
      const out: Record<string, string> = {};
      for (const [name, reads] of Object.entries(inner)) {
        if (reads === "device" || reads === "onelibrary") out[name] = reads;
      }
      return out;
    })(),
    // [booth] fleet = "xdj-xz", "cdj-3000", … — validated against
    // fulltags FLEET_PROFILES; unknown ids fall back to the defaults
    // rather than silently shrinking the safety floor.
    boothFleet: (() => {
      const booth = isTomlTable(file.booth) ? file.booth : {};
      const raw = booth.fleet;
      const ids = Array.isArray(raw)
        ? (raw as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const known = new Set(FLEET_PROFILES.map((p) => p.id as string));
      const valid = ids.filter((id) => known.has(id));
      return valid.length > 0 || ids.length === 0
        ? valid.length > 0
          ? valid
          : [...DEFAULT_FLEET]
        : [...DEFAULT_FLEET];
    })(),
  };
  return cfg;
}
