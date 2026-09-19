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

/** The master stick's configured drive name (config `library.master_drive`
 *  SSOT). No private env twin — callers that honored `MEGADJ_MASTER_DRIVE`
 *  silently diverged from every other surface's drive name. */
export function configuredMasterDrive(): string {
  const root =
    process.env.CRATEDECK_ROOT ?? join(import.meta.dir, "../../cratedeck");
  return loadConfig(root).masterDrive;
}
/** The mount argument → drive path: explicit positional wins, else the
 *  shelf volume. #235: rehomed from maintenance-cmds — this is volume
 *  naming, and the rb-* + shelf-* command arms all mean the same thing
 *  by "[drive] positional absent = shelf". */
export function mountFrom(positional: string | undefined): string {
  if (positional) return volumePath(positional);
  return resolveShelfVolume();
}
