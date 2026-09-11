import { join } from "node:path";
import { loadConfig } from "../../cratedeck/src/config";

export function volumePath(name: string): string {
  return name.startsWith("/") ? name : `/Volumes/${name}`;
}

/** Explicit path, then the single supported env override, then config. */
export function resolveShelfVolume(explicit?: string): string {
  if (explicit) return volumePath(explicit);
  const root =
    process.env.CRATEDECK_ROOT ?? join(import.meta.dir, "../../cratedeck");
  const configured = loadConfig(root).shelfDrive;
  return volumePath(process.env.MEGADJ_SHELF_VOLUME ?? configured);
}
