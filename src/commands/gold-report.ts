/**
 * megadj gold-report — GA-00b: the §0.2 metrics table, computed by
 * scoring the beats/cues ledgers against the GA-00 gold annotations.
 *
 * Runs after every pipeline change; same numbers, every time. Reads the
 * gold dir (default <MEGADJ_MUSIC_DIR>/_gold, override MEGADJ_GOLD_DIR)
 * and the archive DB — never tunes anything, never writes: this is the
 * measurement side of Part 0.
 *
 * Measurement discipline is enforced structurally: the report is
 * computed per split (dev / holdout) with the SAME code path, and the
 * holdout numbers are reported for information only. The plan's rule —
 * never tune against the gold set then report on it — is a process rule
 * the split makes checkable.
 *
 * P1 contract: --json emits one summary object (exit 1 when the gold set
 * is empty — an empty report reads as success otherwise).
 */

import type { ArchiveState } from "../state";
import { commandLog } from "../progress";
import { MUSIC_DIR } from "../cli-env";
import { createHash } from "node:crypto";
import {
  aggregateScores,
  goldDir,
  loadGoldSet,
  splitGoldSet,
  scoreGoldTrack,
  type GoldAnnotation,
  type GoldMetrics,
  type GoldTrackScore,
} from "../../fulltags/src/gold";

/** blake2b256 hex of a file — the same fingerprint the archive sweep
 * records, and the join key between annotations and ledger rows. Null
 * when the file is missing (annotation can't be matched). */
async function hashFile(absPath: string): Promise<string | null> {
  try {
    const bytes = new Uint8Array(await Bun.file(absPath).arrayBuffer());
    return createHash("blake2b256").update(bytes).digest("hex");
  } catch {
    return null;
  }
}

/** One 32-bar phrase boundary per 32 beats from the downbeat spine —
 * mirrored as bars to compare with the annotation's 1-based bar numbers.
 * Exported for tests. */
export function predictedPhraseBars(downbeats: number[]): number[] {
  const bars: number[] = [];
  for (let i = 0; i + 32 <= downbeats.length; i += 32) bars.push(i + 1);
  return bars;
}

export interface GoldReportOptions {
  state: ArchiveState;
  /** Override the annotation dir (tests; default goldDir(MUSIC_DIR)). */
  dir?: string;
  json?: boolean;
  onProgress?: (msg: string) => void;
}

export interface GoldReportResult {
  command: "gold-report";
  dir: string;
  annotations: number;
  issues: number;
  issueFiles: string[];
  dev: GoldMetrics;
  holdout: GoldMetrics;
  /** Tracks with a hash match in the beats ledger (of annotations). */
  matched: number;
  ok: boolean;
  error?: string;
}

export async function goldReport(
  opts: GoldReportOptions,
): Promise<GoldReportResult> {
  const log = commandLog(opts);
  const dir = opts.dir ?? goldDir(MUSIC_DIR);
  const set = loadGoldSet(dir);

  const fail = (msg: string): GoldReportResult => ({
    command: "gold-report",
    dir,
    annotations: set.annotations.length,
    issues: set.issues.length,
    issueFiles: set.issues.map((i) => `${i.file}: ${i.error}`),
    dev: aggregateScores([]),
    holdout: aggregateScores([]),
    matched: 0,
    ok: false,
    error: msg,
  });

  for (const i of set.issues) log(`gold: BAD ${i.file}: ${i.error}`);
  if (set.annotations.length === 0) {
    const r = fail(
      `no gold annotations in ${dir} — annotate 30 tracks first (GA-00)`,
    );
    log(r.error ?? "unknown failure");
    return r;
  }

  // The beats ledger, indexed by content hash (the join key — filenames
  // lie, hashes don't; this is why GA-00 keys annotations by blake2b).
  const analyzed = opts.state.beatAnalyzedTracks();
  const byHash = new Map<string, (typeof analyzed)[number]>();
  for (const row of analyzed) {
    const h = await hashFile(row.track.file_path ?? "");
    if (h) byHash.set(h, row);
  }

  const cueRows = new Map(
    opts.state.cueAnalyzedTracks().map((c) => [c.videoId, c.cues]),
  );

  log(
    `gold: ${set.annotations.length} annotations · ${set.issues.length} bad files · ${byHash.size} analyzed tracks matched by hash`,
  );

  const score = (anns: GoldAnnotation[]): GoldTrackScore[] =>
    anns.map((g) => {
      const row = byHash.get(g.hash);
      const downbeats = row?.downbeats ?? [];
      const cueList = row ? (cueRows.get(row.track.video_id) ?? []) : [];
      return scoreGoldTrack(g, {
        firstDownbeatS: downbeats.length > 0 ? (downbeats[0] ?? null) : null,
        bpm: row?.bpmFitted ?? row?.bpmRaw ?? null,
        phraseBars: predictedPhraseBars(downbeats),
        cueTimesMs: cueList.map((c) => c.position * 1000),
      });
    });

  const split = splitGoldSet(set);
  const dev = aggregateScores(score(split.dev));
  const holdout = aggregateScores(score(split.holdout));
  const matched = [...split.dev, ...split.holdout].filter((a) =>
    byHash.has(a.hash),
  ).length;

  return {
    command: "gold-report",
    dir,
    annotations: set.annotations.length,
    issues: set.issues.length,
    issueFiles: set.issues.map((i) => `${i.file}: ${i.error}`),
    dev,
    holdout,
    matched,
    ok: true,
  };
}

function metricsLine(name: string, m: GoldMetrics): string {
  const f = (v: number | null): string =>
    v === null ? "—" : `${v.toFixed(1)}%`;
  return `${name}: ${m.tracks} tracks · anchor ${f(m.anchorPct)} (${m.anchorScored} scored) · bpm ${f(m.bpmPct)} (${m.bpmScored}, ${m.octaveOff} octave-off) · phrase ${f(m.phrasePct)} · cue ${f(m.cuePct)}`;
}

/** Emit the human report (non-json mode). */
export function printGoldReport(
  r: GoldReportResult,
  log: (s: string) => void,
): void {
  if (r.error) {
    log(`error: ${r.error}`);
    return;
  }
  log(metricsLine("dev    ", r.dev));
  log(metricsLine("holdout", r.holdout));
  log(
    `matched ${r.matched}/${r.annotations} annotations to the beats ledger by content hash`,
  );
}
