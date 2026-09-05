// Config — config.toml + env, validated once at boot.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
  imageProvider: "brave" | "exa" | null;
  imageKey: string | null;
  verifyTimeoutMin: number;
  /** Hard kill for a hung mirror sync (minutes; default 90). */
  mirrorTimeoutMin: number;
  benchmarkMb: number;
  /** Auto light-scan a drive when it mounts (default: on). */
  autoScanOnMount: boolean;
  /** Re-verify drives whose last verify is older than this many days (0 = off). */
  verifyIntervalDays: number;
  /** megadj's archive DB (O82b archive tools read it; never written). */
  archiveDbPath: string;
}

/** Raw TOML value: what the tiny parser can produce. */
type TomlValue = string | number | boolean | TomlTable;
type TomlTable = { [key: string]: TomlValue };

function isTomlTable(v: TomlValue | undefined): v is TomlTable {
  return typeof v === "object" && v !== null;
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
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+?)\s*(?:#.*)?$/);
    if (kv?.[1] && kv[2]) {
      let v: TomlValue = kv[2].replace(/^"(.*)"$/, "$1");
      if (v === "true") v = true;
      else if (v === "false") v = false;
      else if (/^\d+$/.test(v)) v = parseInt(v, 10);
      section[kv[1]] = v;
    }
  }
  return out;
}

export function loadConfig(root: string): CrateConfig {
  const cfgPath = join(root, "config.toml");
  const file = existsSync(cfgPath)
    ? parseTomlSimple(readFileSync(cfgPath, "utf8"))
    : {};
  const server = isTomlTable(file.server) ? file.server : {};
  const library = isTomlTable(file.library) ? file.library : {};
  const images = isTomlTable(file.images) ? file.images : {};
  const jobs = isTomlTable(file.jobs) ? file.jobs : {};
  const automation = isTomlTable(file.automation) ? file.automation : {};
  const dataDir = process.env.CRATEDECK_DATA ?? join(root, "data");
  const cfg: CrateConfig = {
    root,
    dataDir,
    dbPath: join(dataDir, "cratedeck.sqlite"),
    scratchDir: join(dataDir, "scratch"),
    imagesDir: join(dataDir, "images"),
    serverPort:
      parseInt(process.env.CRATEDECK_PORT ?? "", 10) ||
      (typeof server.port === "number" ? server.port : 0) ||
      7742,
    volumesRoot: process.env.CRATEDECK_VOLUMES ?? "/Volumes",
    masterDrive:
      typeof library.master_drive === "string"
        ? library.master_drive
        : "DJMASTER",
    mirrorDrive:
      typeof library.mirror_drive === "string"
        ? library.mirror_drive
        : "DJMIRROR",
    imageProvider:
      (typeof images.provider === "string"
        ? (images.provider as "brave" | "exa")
        : undefined) ??
      (process.env.CRATEDECK_IMAGE_PROVIDER as "brave" | "exa" | undefined) ??
      null,
    imageKey:
      (typeof images.key === "string" ? images.key : undefined) ??
      process.env.CRATEDECK_IMAGE_KEY ??
      process.env.EXA_API_KEY ??
      null,
    verifyTimeoutMin:
      typeof jobs.verify_timeout_min === "number"
        ? jobs.verify_timeout_min
        : 40,
    mirrorTimeoutMin:
      typeof jobs.mirror_timeout_min === "number"
        ? jobs.mirror_timeout_min
        : 90,
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
      process.env.MEGADJ_DB ??
      `${process.env.HOME}/.local/state/megadj/archive.db`,
  };
  if (cfg.imageProvider && !["brave", "exa"].includes(cfg.imageProvider)) {
    throw new Error(`config: unknown images.provider '${cfg.imageProvider}'`);
  }
  return cfg;
}
