import type { ArchiveState } from "../state";
import { commandLog } from "../progress";

/**
 * megadj cues — phrase cues derived from the beats ledger (DB-side, no
 * tag writes, no player writes).
 *
 * Roadmap "structure cues (slice: cues first)": the downbeat arrays from
 * `megadj beats` already carry the bar grid; this command slices them into
 * DJ phrase markers (every 8 bars = 32 beats) — intro / phrase / break /
 * outro landmarks a set-builder can jump between, PLUS the plan-B5
 * memory spine: every 32-bar boundary is flagged `memory: true` (bars
 * 1, 33, 65 …) — the positions a CDJ memory cue would take when the
 * gated write surface ships. Cues live in the `cues` table ONLY:
 * rekordbox memory cues are a separate, later surface (drive writes stay
 * gated behind the interlock + gauntlet).
 *
 * Derivation (pure, deterministic): phrase k starts at downbeat index
 * k*8 (bar k*8+1). Phrases are emitted only while they fit inside the
 * grid (a trailing partial phrase is dropped). Idempotent by video_id;
 * `--force` recomputes. `--json` emits one summary object (P1).
 */

/** 8 bars = 32 beats = the standard EDM phrase unit (4/4). */
export const BARS_PER_PHRASE = 8;

/** 32 bars = the DJ memory-marker unit (plan B5): every 32-bar boundary
 * gets a visible waveform marker on the CDJ. Derived, never stored
 * separately — the 8-bar cue array carries it. */
export const BARS_PER_MEMORY = 32;

export interface Cue {
  /** phrase index, 0-based */
  index: number;
  /** seconds into the track */
  position: number;
  /** bar number (1-based) this phrase starts at */
  bar: number;
  /** true when this phrase boundary is also a 32-bar memory marker */
  memory: boolean;
}

/** Pure phrase slicer: downbeats (seconds) → phrase cues. Exported for
 * tests; deterministic and side-effect free. Every 32nd bar (bars
 * 1, 33, 65 … — BARS_PER_MEMORY) also carries `memory: true` — the plan
 * B5 32-bar marker spine. */
export function phraseCues(downbeats: number[]): Cue[] {
  if (downbeats.length < BARS_PER_PHRASE) return [];
  const out: Cue[] = [];
  const step = BARS_PER_PHRASE; // bars per phrase
  for (let bar = 0; bar + step <= downbeats.length; bar += step) {
    out.push({
      index: out.length,
      position: Math.round(downbeats[bar]! * 1000) / 1000,
      bar: bar + 1,
      // 32-bar memory spine: bars 1, 33, 65… (every 4th phrase boundary)
      memory: (bar + 1) % BARS_PER_MEMORY === 1,
    });
  }
  return out;
}

export interface CuesOptions {
  state: ArchiveState;
  limit?: number | undefined;
  force?: boolean | undefined;
  dryRun?: boolean | undefined;
  json?: boolean | undefined;
  onProgress?: ((msg: string) => void) | undefined;
}

export async function cues(opts: CuesOptions): Promise<void> {
  const log = commandLog(opts);

  const rows = opts.state.beatAnalyzedTracks();
  // limit is a hard cap: 0 = derive nothing (0 is falsy — never treat it
  // as "unlimited"; undefined is the only "all rows" spelling).
  const todo =
    opts.limit === undefined ? rows : rows.slice(0, Math.max(0, opts.limit));

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
        // v2: the cue rows now carry the 32-bar memory spine — re-derive
        // with --force to upgrade rows written by v1 (same source family).
        source: "phrase-cues@2",
      });
    }
    derived++;
    totalCues += cs.length;
    log(
      `  ${cs.length} phrase cues · ${cs.filter((c) => c.memory).length} memory (32-bar) (first @ ${cs[0]!.position.toFixed(1)}s) — ${r.track.title ?? r.track.video_id}`,
    );
  }

  // A zero-work run must read as SUCCESS (same contract as beats/mood):
  // "0 derived" once looked like a defect, so the summary states WHY.
  if (derived === 0 && !opts.dryRun) {
    log(
      `\ncues complete: nothing to do — all ${rows.length} ledgered tracks already have phrase cues (run with --force to re-derive after a beats repair)`,
    );
  } else {
    log(
      `\ncues complete: ${derived} track(s) cued (${totalCues} cues), ${skipped} skipped${opts.dryRun ? " (dry run — nothing written)" : ""}`,
    );
  }
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
