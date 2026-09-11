/**
 * fetch command — agent/user-facing wrapper around tools/fetch-all.ts.
 * Runs the enrichment pipeline (tags + genres + years + artwork) in-process
 * with the same flags, so `megadj fetch --dry-run` etc. just work.
 *
 * `auditArchive` reads ground truth through FullTags' reader (one
 * implementation — the file is the truth, and `megadj audit` and
 * `fulltags audit` must agree by construction).
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  groundTruth,
  walkAudioFiles,
  probeFile,
  playerCompat,
  isHiresOnly,
  boothTextCompat,
} from "../../fulltags/src/exports";
import type { AuditRow } from "./audit-row";

export type { AuditRow };

export interface FetchOptions {
  all?: boolean | undefined;
  only?: "art" | "genres" | "tags" | "years" | "all" | undefined;
  jobs?: number | undefined;
  dryRun?: boolean | undefined;
  /** Opt-in AI genre/year fallback (SC+Beatport stay primary). Off by
   *  default — the flash-lite fallback has a documented "2023" failure
   *  mode; enable only for a bounded re-pass over a short unresolved list. */
  aiFallback?: boolean | undefined;
  /** Machine-readable summary instead of human logs (P1: --json everywhere). */
  json?: boolean | undefined;
}

/** Audio files under the archive, recursively — organize() moves tracks
 * into genre subfolders, so a top-level readdir would audit an empty set
 * and always report "all complete" (0/0 is vacuous). Shared FullTags
 * walker: same skip/extension rules as every other collect pass. */
const walkArchive = walkAudioFiles;

/** Ground-truth audit of every audio file in the archive (player-compat
 * included — the gate is async because the codec probe is a process). */
export async function auditArchive(musicDir: string): Promise<{
  total: number;
  complete: number;
  rows: AuditRow[];
}> {
  const files = walkArchive(musicDir);
  const rows: AuditRow[] = [];
  for (const p of files) {
    if (!existsSync(p)) continue;
    const t = groundTruth(p);
    const genreOk = !!t.genre && t.genre !== "Music";
    // Player-compat needs codec + sample rate — a second probe per file.
    // This is the audit's job: pay the ffprobe pass, catch what tags
    // alone can't see (float WAVs, 96k, MPEG-2 rips).
    const compat = playerCompat(await probeFile(p));
    const playable = compat.ok || isHiresOnly(compat);
    // Booth-text gate rides the same ground-truth read: no extra probe,
    // the display fields + filename are what the players actually show.
    const text = boothTextCompat({
      filename: p.split("/").pop() ?? p,
      title: t.title,
      artist: t.artist,
      album: t.album,
      genre: t.genre,
      relPath: p.slice(musicDir.length + 1),
    });
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
      playable,
      readable: text.ok,
      unreadableReasons: text.reasons,
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
      row.energy &&
      row.playable &&
      row.readable;
    rows.push(row);
  }
  return {
    total: rows.length,
    complete: rows.filter((r) => r.complete).length,
    rows,
  };
}

export async function fetch(opts: FetchOptions): Promise<void> {
  const script = join(import.meta.dir, "../../tools/fetch-all.ts");
  const proc = Bun.spawn(["bun", script, ...fetchAllArgs(opts)], {
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
  if (proc.exitCode !== 0) process.exitCode = proc.exitCode ?? 1;
}

/** Map FetchOptions to fetch-all.ts CLI args. Exported for tests — the
 * flags used to be parsed and then silently dropped (only --json made it
 * through), so `megadj fetch --art` ran the full pass. */
export function fetchAllArgs(opts: FetchOptions): string[] {
  const extra: string[] = [];
  if (opts.json) extra.push("--json");
  if (opts.all) extra.push("--all");
  if (opts.only && opts.only !== "all") extra.push(`--${opts.only}`);
  if (opts.jobs !== undefined) extra.push("--jobs", String(opts.jobs));
  if (opts.dryRun) extra.push("--dry-run");
  if (opts.aiFallback) extra.push("--ai-fallback");
  return extra;
}
