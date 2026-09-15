/**
 * master-path — THE master.db path seam (issue #66).
 *
 * Every rb-* command used to hand-roll `${mount}/PIONEER/Master/master.db`
 * with its own slash-strip; the MEGADJ_RB_MASTER env override was honored
 * by exactly one caller, so the same machine could target two different
 * master DBs with two commands. One wrong join on this surface is a write
 * to the wrong master.db — safety-critical, hence one body.
 *
 * Semantics (moved verbatim from shared/doctor-state.ts, the richest
 * variant): explicit path / env wins; a master.db path, Master dir,
 * PIONEER dir, drive root, or bare volume name all resolve to the standard
 * layout. The no-arg default routes through `resolveShelfVolume` (issue
 * #55) — never a hardcoded /Volumes/SHELF1 literal.
 */
import { resolveShelfVolume } from "../shared/volume.js";

export function normalizeMount(mount: string): string {
  return mount.replace(/\/+$/u, "");
}

export function masterDbPath(mount?: string): string {
  if (process.env.MEGADJ_RB_MASTER) return process.env.MEGADJ_RB_MASTER;
  if (mount && mount.endsWith(".db")) return mount;
  let base = mount
    ? mount.startsWith("/")
      ? normalizeMount(mount)
      : `/Volumes/${mount}`
    : resolveShelfVolume();
  if (base.endsWith("/master.db")) base = base.replace(/\/master\.db$/u, "");
  if (base.endsWith("/Master")) return `${base}/master.db`;
  if (base.endsWith("/PIONEER")) return `${base}/Master/master.db`;
  return `${base}/PIONEER/Master/master.db`;
}
