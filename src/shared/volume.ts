import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig } from "../deck/config";
import { nonEmptyEnv } from "./leaf/guards";

export function volumePath(name: string): string {
  return name.startsWith("/") ? name : `/Volumes/${name}`;
}

/**
 * THE deck-config-root resolver (one SSOT, #327-ss pass).
 *
 * History: every consumer used to inline
 * `nonEmptyEnv("CRATEDECK_ROOT") ?? join(import.meta.dir, "../deck")` —
 * correct ONLY at `src/*` depth. The afc6a535 class: any file one level
 * deeper (src/fulltags/megaset/*, src/rekordbox/ if it had used `../../`)
 * computed a phantom root where no config.toml exists, and loadConfig
 * silently served DEFAULTS (dataDir phantom, drives DJMASTER/SHELF1
 * fallbacks). Strike three of that class landed in the #327 super-sure
 * pass: megaset-calibrate wrote its digest into src/fulltags/deck/data/
 * (a path twin of the gitignored src/deck/data/) instead of the real
 * state dir. This resolver exists so caller depth can NEVER matter again:
 *
 * 1. `CRATEDECK_ROOT` env override wins verbatim (nonEmptyEnv — #281:
 *    present-but-empty is a typo, read as absent).
 * 2. Otherwise walk UP from this file to the repo anchor (the nearest
 *    ancestor holding both `package.json` and `.git`) and return its
 *    `src/deck` — the config home `src/deck/index.ts` documents.
 * 3. No anchor found (packaged/odd layout): the `src/deck` relative to
 *    THIS file (correct at src/shared/ depth by construction).
 */
export function crateDeckRoot(): string {
  const envRoot = nonEmptyEnv("CRATEDECK_ROOT");
  if (envRoot !== undefined) return envRoot;
  let dir = import.meta.dir;
  for (;;) {
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root: no anchor anywhere
    dir = parent;
    if (
      existsSync(join(dir, "package.json")) &&
      existsSync(join(dir, ".git"))
    ) {
      return join(dir, "src", "deck");
    }
  }
  return join(import.meta.dir, "..", "deck");
}

/** Explicit path, then the single supported env override, then config.
 *  The env read is nonEmptyEnv (#281 class): `MEGADJ_SHELF_VOLUME=""` is a
 *  typo, not "disable the override" — it would volumePath("") into a
 *  relative `/Volumes/`-less path. */
export function resolveShelfVolume(explicit?: string): string {
  if (explicit) return volumePath(explicit);
  const configured = loadConfig(crateDeckRoot()).shelfDrive;
  return volumePath(nonEmptyEnv("MEGADJ_SHELF_VOLUME") ?? configured);
}

/** The master stick's configured drive name (config `library.master_drive`
 *  SSOT). No private env twin — callers that honored `MEGADJ_MASTER_DRIVE`
 *  silently diverged from every other surface's drive name. */
export function configuredMasterDrive(): string {
  return loadConfig(crateDeckRoot()).masterDrive;
}

/** The mount argument → drive path: explicit positional wins, else the
 *  shelf volume. #235: rehomed from maintenance-cmds — this is volume
 *  naming, and the rb-* + shelf-* command arms all mean the same thing
 *  by "[drive] positional absent = shelf". */
export function mountFrom(positional: string | undefined): string {
  if (positional) return volumePath(positional);
  return resolveShelfVolume();
}
