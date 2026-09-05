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
  complete: boolean;
}

/** Ground-truth audit of every audio file in the archive. */
export function auditArchive(musicDir: string): {
  total: number;
  complete: number;
  rows: AuditRow[];
} {
  const files = readdirSync(musicDir).filter(
    (f) => !f.startsWith(".") && /\.(wav|mp3|m4a|flac|aiff)$/i.test(f),
  );
  const rows: AuditRow[] = [];
  for (const f of files) {
    const p = join(musicDir, f);
    if (!existsSync(p)) continue;
    const t = groundTruth(p);
    const genreOk = !!t.genre && t.genre !== "Music";
    const row: AuditRow = {
      file: f,
      art: t.art,
      title: !!t.title,
      artist: !!t.artist,
      album: !!t.album,
      genre: genreOk,
      year: !!t.year,
      complete: false,
    };
    row.complete =
      row.art && row.title && row.artist && row.album && row.genre && row.year;
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
  const extra = opts.json ? ["--json"] : [];
  const proc = Bun.spawn(["bun", script, ...extra], {
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
  if (proc.exitCode !== 0) process.exitCode = proc.exitCode ?? 1;
}
