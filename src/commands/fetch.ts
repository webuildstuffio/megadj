/**
 * fetch command — agent/user-facing wrapper around tools/fetch_all.ts.
 * Runs the enrichment pipeline (tags + genres + years + artwork) in-process
 * with the same flags, so `megadj fetch --dry-run` etc. just work.
 *
 * `auditArchive` reads ground truth through FullTags' reader (one
 * implementation — the file is the truth, and `megadj audit` and
 * `fulltags audit` must agree by construction).
 */
import { join } from "node:path";
import { readdirSync, existsSync } from "node:fs";
import { groundTruth } from "../../fulltags/src/exports";
export interface FetchOptions {
  all?: boolean;
  only?: "art" | "genres" | "tags" | "years" | "all";
  jobs?: number;
  dryRun?: boolean;
  /** Machine-readable summary instead of human logs (P1: --json everywhere). */
  json?: boolean;
}

export interface AuditRow {
  file: string;
  art: boolean;
  title: boolean;
  artist: boolean;
  album: boolean;
  genre: boolean;
  year: boolean;
  /** TXXX:MOOD stamp present (roadmap #4 — mood/valence completeness). */
  mood: boolean;
  /** TXXX:ENERGY stamp present (the energy stage's output). */
  energy: boolean;
  complete: boolean;
}

/** Audio files under the archive, recursively — organize() moves tracks
 * into genre subfolders, so a top-level readdir would audit an empty set
 * and always report "all complete" (0/0 is vacuous). */
function walkArchive(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) walkArchive(full, out);
    else if (/\.(wav|mp3|m4a|flac|aiff)$/i.test(ent.name)) out.push(full);
  }
  return out;
}

/** Ground-truth audit of every audio file in the archive. */
export function auditArchive(musicDir: string): {
  total: number;
  complete: number;
  rows: AuditRow[];
} {
  const files = walkArchive(musicDir);
  const rows: AuditRow[] = [];
  for (const p of files) {
    if (!existsSync(p)) continue;
    const t = groundTruth(p);
    const genreOk = !!t.genre && t.genre !== "Music";
    const row: AuditRow = {
      file: p,
      art: t.art,
      title: !!t.title,
      artist: !!t.artist,
      album: !!t.album,
      genre: genreOk,
      year: !!t.year,
      mood: !!t.mood,
      energy: t.energy !== null,
      complete: false,
    };
    row.complete =
      row.art &&
      row.title &&
      row.artist &&
      row.album &&
      row.genre &&
      row.year &&
      row.mood &&
      row.energy;
    rows.push(row);
  }
  return {
    total: rows.length,
    complete: rows.filter((r) => r.complete).length,
    rows,
  };
}

export async function fetch(opts: FetchOptions): Promise<void> {
  const script = join(import.meta.dir, "../../tools/fetch_all.ts");
  const proc = Bun.spawn(["bun", script, ...fetchAllArgs(opts)], {
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
  if (proc.exitCode !== 0) process.exitCode = proc.exitCode ?? 1;
}

/** Map FetchOptions to fetch_all.ts CLI args. Exported for tests — the
 * flags used to be parsed and then silently dropped (only --json made it
 * through), so `megadj fetch --art` ran the full pass. */
export function fetchAllArgs(opts: FetchOptions): string[] {
  const extra: string[] = [];
  if (opts.json) extra.push("--json");
  if (opts.all) extra.push("--all");
  if (opts.only && opts.only !== "all") extra.push(`--${opts.only}`);
  if (opts.jobs !== undefined) extra.push("--jobs", String(opts.jobs));
  if (opts.dryRun) extra.push("--dry-run");
  return extra;
}
