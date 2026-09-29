/**
 * cue-writer-v2.ts — Structural hot cues, never touch manual cues (B8.4).
 *
 * Rules:
 * - Only write structural cues (phrase boundaries, drops, breakdowns)
 * - Never overwrite user-placed manual cues
 * - Hot cues (Kind=1) in slots 0–7 only
 * - Memory cues (Kind=0) are user territory — never touch
 * - Agent-managed cues get a prefix marker for identification
 *
 * Cue conventions (rekordbox):
 * - XML POSITION_MARK Num="0..7" = hot, "-1" = memory
 * - DB djmdCue.Kind: 1 = hot, 0 = memory
 */

/** Cue slot assignment for structural hot cues. */
export const STRUCTURAL_CUE_SLOTS = {
  /** Intro start. */
  INTRO: 0,
  /** First drop. */
  DROP_1: 1,
  /** Breakdown. */
  BREAKDOWN: 2,
  /** Second drop. */
  DROP_2: 3,
  /** Outro start. */
  OUTRO: 4,
  /** Build-up. */
  BUILDUP: 5,
} as const;

/** Cue colour for structural cues (rekordbox RGB). */
export const STRUCTURAL_CUE_COLOURS = {
  INTRO: { r: 40, g: 226, b: 20 }, // green
  DROP: { r: 255, g: 0, b: 0 }, // red
  BREAKDOWN: { r: 0, g: 130, b: 255 }, // blue
  OUTRO: { r: 255, g: 165, b: 0 }, // orange
  BUILDUP: { r: 255, g: 255, b: 0 }, // yellow
} as const;

/** A proposed structural cue. */
export interface StructuralCue {
  /** Slot index (0–7). */
  readonly slot: number;
  /** Position in milliseconds. */
  readonly positionMs: number;
  /** Cue label. */
  readonly label: string;
  /** Colour RGB. */
  readonly colour: { r: number; g: number; b: number };
  /** Source: which analysis produced this cue. */
  readonly source: "phrase" | "drop" | "arc";
}

/** An existing cue on the track (from master.db). */
export interface ExistingCue {
  readonly slot: number;
  /** Kind: 1 = hot, 0 = memory. */
  readonly kind: number;
  readonly positionMs: number;
  readonly label: string | null;
}

/** Cue write plan. */
export interface CueWritePlan {
  /** Cues to write (only empty or agent-managed slots). */
  readonly writes: readonly StructuralCue[];
  /** Slots that were skipped (user-occupied). */
  readonly skipped: readonly number[];
  /** Slots that were updated (agent cue replaced). */
  readonly updated: readonly number[];
}

/** Agent marker prefix for identifying agent-managed cues. */
export const AGENT_CUE_MARKER = "⌬";

/**
 * Plan structural cue writes, respecting user-placed cues.
 *
 * @param proposed - Proposed structural cues from analysis
 * @param existing - Existing cues on the track
 * @returns Write plan with only safe writes
 */
export function planCueWrites(
  proposed: readonly StructuralCue[],
  existing: readonly ExistingCue[],
): CueWritePlan {
  const writes: StructuralCue[] = [];
  const skipped: number[] = [];
  const updated: number[] = [];

  for (const cue of proposed) {
    const ex = existing.find((e) => e.slot === cue.slot && e.kind === 1);
    if (ex === undefined) {
      // Empty slot — safe to write
      writes.push(cue);
    } else if (ex.label?.startsWith(AGENT_CUE_MARKER)) {
      // Agent-managed slot — safe to update
      writes.push(cue);
      updated.push(cue.slot);
    } else {
      // User-placed cue — never touch
      skipped.push(cue.slot);
    }
  }

  return { writes, skipped, updated };
}
