import type { ArchiveState } from "../state";

/**
 * megadj cues — phrase cues derived from the beats ledger (DB-side, no
 * tag writes, no player writes).
 *
 * Roadmap "structure cues (slice: cues first)": the downbeat arrays from
 * `megadj beats` already carry the bar grid; this command slices them into
 * DJ phrase markers (every 8 bars = 32 beats) — intro / phrase / break /
 * outro landmarks a set-builder can jump between. Cues live in the new
 * `cues` table ONLY: rekordbox memory cues are a separate, later surface
 * (drive writes stay gated behind the interlock + gauntlet).
 *
 * Derivation (pure, deterministic): phrase k starts at downbeat index
 * k*8 (bar k*8+1). Phrases are emitted only while they fit inside the
 * grid (a trailing partial phrase is dropped). Idempotent by video_id;
 * `--force` recomputes. `--json` emits one summary object (P1).
 */

export const BEATS_PER_BAR = 4;
/** 8 bars = 32 beats = the standard EDM phrase unit. */
export const BARS_PER_PHRASE = 8;

export interface Cue {
  /** phrase index, 0-based */
  index: number;
  /** seconds into the track */
  position: number;
  /** bar number (1-based) this phrase starts at */
  bar: number;
}

/** Pure phrase slicer: downbeats (seconds) → phrase cues. Exported for
 * tests; deterministic and side-effect free. */
export function phraseCues(downbeats: number[]): Cue[] {
  if (downbeats.length < BARS_PER_PHRASE) return [];
  const cues: Cue[] = [];
  const step = BARS_PER_PHRASE; // bars per phrase
  for (let bar = 0; bar + step <= downbeats.length; bar += step) {
    cues.push({
      index: cues.length,
      position: Math.round(downbeats[bar]! * 1000) / 1000,
      bar: bar + 1,
    });
  }
  return cues;
}

export interface CuesOptions {
  state: ArchiveState;
  limit?: number;
  force?: boolean;
  dryRun?: boolean;
  json?: boolean;
  onProgress?: (msg: string) => void;
}

export async function cues(opts: CuesOptions): Promise<void> {
  const log = opts.json
    ? (m: string) => process.stderr.write(`${m}\n`)
    : (opts.onProgress ?? ((m: string) => console.log(m)));

  const rows = opts.state.beatAnalyzedTracks();
  const todo = opts.limit ? rows.slice(0, opts.limit) : rows;

  let derived = 0;
  let skipped = 0;
  let totalCues = 0;
  for (const r of todo) {
    if (!r.downbeats.length) {
      skipped++;
      continue;
    }
    const existing = opts.state.cueRecord(r.track.video_id);
    if (existing && !opts.force) {
      skipped++;
      continue;
    }
    const cs = phraseCues(r.downbeats);
    if (!cs.length) {
      skipped++;
      continue;
    }
    if (!opts.dryRun) {
      opts.state.setCueRecord({
        videoId: r.track.video_id,
        cues: cs,
        source: "phrase-cues@1",
      });
    }
    derived++;
    totalCues += cs.length;
    log(
      `  ${cs.length} phrase cues (first @ ${cs[0]!.position.toFixed(1)}s) — ${r.track.title ?? r.track.video_id}`,
    );
  }

  log(
    `\ncues complete: ${derived} track(s) cued (${totalCues} cues), ${skipped} skipped${opts.dryRun ? " (dry run — nothing written)" : ""}`,
  );
  console.log(
    JSON.stringify({
      command: "cues",
      derived,
      skipped,
      cues: totalCues,
      dryRun: opts.dryRun === true,
    }),
  );
}
