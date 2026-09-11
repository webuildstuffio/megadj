/**
 * megadj gold-report — GA-00b: the §0.2 metrics table, computed by
 * scoring the beats/cues ledgers against the GA-00 gold annotations.
 *
 * Runs after every pipeline change; same numbers, every time. Reads the
 * gold dir (default <MEGADJ_MUSIC_DIR>/_gold, override MEGADJ_GOLD_DIR)
 * and the archive DB — never tunes anything, never writes (except the
 * content-hash backfill cache, below): this is the measurement side of
 * Part 0.
 *
 * Join discipline: annotations are keyed by blake2b256 CONTENT hash —
 * filenames lie, hashes don't. The hash is cached in
 * `tracks.content_hash` so repeated reports don't re-read the whole
 * library's audio (a super-sure fix, Sep 10: hashing every analyzed
 * file per run cost GBs of I/O); unknown hashes are backfilled once,
 * on-screen, capped.
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

/** blake2b256 hex of a file — the same fingerprint the gold set keys
 * annotations by. Null when the file is missing/unreadable (the track
 * just stays hash-unknown; the report counts it as unmatched). */
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

/** Backfill cap: a first run over a large library must not silently
 * hash the world — surface progress, cap the cost, tell the user how
 * many remain. 500 tracks ≈ a few minutes of disk I/O. */
const HASH_BACKFILL_CAP = 500;

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
  /** Annotations whose hash isn't in the ledger (never analyzed, or
   * backfill-capped this run — re-run to continue the fill). */
  unmatched: number;
  /** Tracks hashed this run (the backfill that landed). */
  hashedNow: number;
  /** Tracks still missing a cached hash after this run. */
  hashMissing: number;
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
    unmatched: 0,
    hashedNow: 0,
    hashMissing: 0,
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

  // Backfill the content-hash cache for downloaded tracks that lack one
  // (first run after this change: capped; later runs: zero cost).
  const missing = opts.state.tracksMissingContentHash();
  let hashedNow = 0;
  if (missing.length > 0) {
    const capped = missing.slice(0, HASH_BACKFILL_CAP);
    log(
      `gold: hashing ${capped.length} unhashed tracks` +
        (missing.length > capped.length
          ? ` (${missing.length - capped.length} more after this run)`
          : ""),
    );
    for (const t of capped) {
      if (t.filePath === null) continue;
      const h = await hashFile(t.filePath);
      if (h) {
        opts.state.setContentHash(t.videoId, h);
        hashedNow++;
      }
    }
    if (missing.length > capped.length)
      log(
        `gold: ${missing.length - capped.length} tracks still unhashed — re-run to continue`,
      );
  }

  // The beats ledger, indexed by content hash (the join key — filenames
  // lie, hashes don't; this is why GA-00 keys annotations by blake2b).
  const analyzed = opts.state.beatAnalyzedTracks();
  const byHash = new Map<string, (typeof analyzed)[number]>();
  for (const row of analyzed) {
    if (row.track.content_hash) byHash.set(row.track.content_hash, row);
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
  const scored = [...split.dev, ...split.holdout];
  const dev = aggregateScores(score(split.dev));
  const holdout = aggregateScores(score(split.holdout));
  const matched = scored.filter((a) => byHash.has(a.hash)).length;

  return {
    command: "gold-report",
    dir,
    annotations: set.annotations.length,
    issues: set.issues.length,
    issueFiles: set.issues.map((i) => `${i.file}: ${i.error}`),
    dev,
    holdout,
    matched,
    unmatched: scored.length - matched,
    hashedNow,
    hashMissing: opts.state.tracksMissingContentHash().length,
    ok: true,
  };
}

/** Format a nullable percent for the report line (— when unscored).
 *  Pure — module-level, not re-created per `metricsLine` call. */
const pctOrDash = (v: number | null): string =>
  v === null ? "—" : `${v.toFixed(1)}%`;

function metricsLine(name: string, m: GoldMetrics): string {
  return `${name}: ${m.tracks} tracks · anchor ${pctOrDash(m.anchorPct)} (${m.anchorScored} scored) · bpm ${pctOrDash(m.bpmPct)} (${m.bpmScored}, ${m.octaveOff} octave-off) · phrase ${pctOrDash(m.phrasePct)} · cue ${pctOrDash(m.cuePct)}`;
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
    `matched ${r.matched}/${r.annotations} annotations to the beats ledger by content hash` +
      (r.unmatched > 0
        ? ` · ${r.unmatched} unmatched (not analyzed, or hash backfill capped — re-run)`
        : ""),
  );
  if (r.hashedNow > 0)
    log(
      `hashed ${r.hashedNow} tracks this run; ${r.hashMissing} still uncached`,
    );
}
