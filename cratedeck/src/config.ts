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
  benchmarkMb: number;
}

function parseTomlSimple(src: string): Record<string, any> {
  // Tiny flat/nested toml reader for our known shape (no deps).
  const out: Record<string, any> = {};
  let section = out;
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec?.[1]) {
      section = {};
      const parts = sec[1].split(".");
      let cur: Record<string, any> = out;
      for (const p of parts) {
        cur[p] ??= {};
        const next = cur[p];
        if (next && typeof next === "object") cur = next;
      }
      section = cur;
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+?)\s*(?:#.*)?$/);
    if (kv?.[1] && kv[2]) {
      let v: any = kv[2].replace(/^"(.*)"$/, "$1");
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
  const dataDir = process.env.CRATEDECK_DATA ?? join(root, "data");
  const cfg: CrateConfig = {
    root,
    dataDir,
    dbPath: join(dataDir, "cratedeck.sqlite"),
    scratchDir: join(dataDir, "scratch"),
    imagesDir: join(dataDir, "images"),
    serverPort:
      parseInt(process.env.CRATEDECK_PORT ?? "", 10) ||
      file?.server?.port ||
      7742,
    volumesRoot: process.env.CRATEDECK_VOLUMES ?? "/Volumes",
    masterDrive: file?.library?.master_drive ?? "DJMASTER",
    mirrorDrive: file?.library?.mirror_drive ?? "DJMIRROR",
    imageProvider: file?.images?.provider ?? null,
    imageKey: file?.images?.key ?? process.env.CRATEDECK_IMAGE_KEY ?? null,
    verifyTimeoutMin: file?.jobs?.verify_timeout_min ?? 40,
    benchmarkMb: file?.jobs?.benchmark_mb ?? 512,
  };
  if (cfg.imageProvider && !["brave", "exa"].includes(cfg.imageProvider)) {
    throw new Error(`config: unknown images.provider '${cfg.imageProvider}'`);
  }
  return cfg;
}
