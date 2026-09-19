/** Enrichment stages accepted by both the CLI parser and the fetch
 *  orchestrator (#221: was fetch-target.ts, 4L — merged into its host). */
export const FETCH_TARGETS = ["art", "genres", "tags", "years", "all"] as const;

export type FetchTarget = (typeof FETCH_TARGETS)[number];

/**
 * fetch command — agent/user-facing wrapper around the FullTags fetch
 * pipeline (fulltags/src/fetch-pipeline.ts, re-homed from tools/ per
 * #184). Runs the enrichment pipeline (tags + genres + years + artwork)
 * in-process with the same flags, so `megadj fetch --dry-run` etc. just
 * work.
 *
 * `auditArchive` reads ground truth through FullTags' reader (one
 * implementation — the file is the truth, and `megadj audit` and
 * `fulltags audit` must agree by construction).
 */
import { existsSync } from "node:fs";
import { groundTruth } from "../write/readers";
import { walkAudioFiles } from "../write/writer";
import { probeFile } from "../media-probe";
import { playerCompat, isHiresOnly } from "../booth/player-compat";
import { boothTextCompat } from "../booth/booth-text";
import { completeness } from "../write/schema";
import type { AuditRow } from "../audit-row";
export { type AuditRow } from "../audit-row";

export interface FetchOptions {
  all?: boolean | undefined;
  only?: FetchTarget | undefined;
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
    // Tag dims derive from the schema SSOT (issue #97 — same gate as
    // `fulltags audit` BY CONSTRUCTION; the Music placeholder counts as
    // a missing genre inside completeness()).
    const tagDims = completeness(t);
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
    const missing = new Set(tagDims.missing);
    const row: AuditRow = {
      file: p,
      art: !missing.has("art"),
      title: !missing.has("title"),
      artist: !missing.has("artist"),
      album: !missing.has("album"),
      genre: !missing.has("genre"),
      year: !missing.has("year"),
      mood: !missing.has("mood"),
      energy: !missing.has("energy"),
      playable,
      readable: text.ok,
      unreadableReasons: text.reasons,
      complete: false,
    };
    row.complete = tagDims.complete && row.playable && row.readable;
    rows.push(row);
  }
  return {
    total: rows.length,
    complete: rows.filter((r) => r.complete).length,
    rows,
  };
}

export async function fetch(opts: FetchOptions): Promise<void> {
  // In-process run through the pipeline module — the child-process spawn
  // (bun tools/fetch-all.ts) is gone AND the pipeline now lives inside
  // the fulltags package (#184). The dynamic import stays LAZY: the
  // pipeline graph opens the archive DB at module load, which must not
  // ride every `megadj` CLI boot. (#89: aims at fetch-pipeline directly —
  // re-exporting runFetch through the exports barrel closed a madge
  // cycle exports → fetch-pipeline → archive-ledger → exports.)
  const { runFetch } = await import("./fetch-pipeline").then((m) => ({
    runFetch: m.runFetch,
  }));
  await runFetch({
    all: opts.all ?? false,
    only: opts.only ?? "all",
    aiFallback: opts.aiFallback ?? false,
    onlyDryRun: opts.dryRun ?? false,
    jobs: opts.jobs ?? 6,
    json: opts.json ?? false,
  });
}

/** Map FetchOptions to the fetch-all flag surface. Exported for tests —
 *  the flags used to be parsed and then silently dropped (only --json made
 *  it through), so `megadj fetch --art` ran the full pass. The run is
 *  in-process now; this pins the option→flag contract the CLI shim shares. */
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
