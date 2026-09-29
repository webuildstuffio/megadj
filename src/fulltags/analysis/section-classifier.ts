/**
 * section-classifier.ts — Section classifier from PSSI weak labels (B8.2).
 *
 * Rekordbox's Phrase feature (PSSI = Phrase Structure Segmentation Info)
 * assigns each bar a phrase type: intro, up, peak, down, outro, etc.
 * These are "weak labels" — imperfect but mass-produced by RB's analyzer.
 *
 * This module maps PSSI values to structural section labels and computes
 * section-level features for the bench.
 */
import { round3 } from "../../shared/leaf/fmt";

/** Rekordbox PSSI phrase type codes. */
export const PSSI_TYPES = {
  INTRO: 1,
  UP: 2,
  DOWN: 3,
  CHORUS: 5,
  OUTRO: 6,
  VERSE: 8,
  BRIDGE: 9,
} as const;

/** Human-readable section name for a PSSI code. */
export function pssiTypeName(code: number): string {
  const NAMES: Record<number, string> = {
    [PSSI_TYPES.INTRO]: "intro",
    [PSSI_TYPES.UP]: "buildup",
    [PSSI_TYPES.DOWN]: "breakdown",
    [PSSI_TYPES.CHORUS]: "drop",
    [PSSI_TYPES.OUTRO]: "outro",
    [PSSI_TYPES.VERSE]: "verse",
    [PSSI_TYPES.BRIDGE]: "bridge",
  };
  return NAMES[code] ?? `unknown-${code}`;
}

/** A section from PSSI data. */
export interface PssiSection {
  /** PSSI type code. */
  readonly type: number;
  /** Section name. */
  readonly name: string;
  /** Start bar index. */
  readonly startBar: number;
  /** End bar index (exclusive). */
  readonly endBar: number;
  /** Length in bars. */
  readonly lengthBars: number;
}

/** Section classification result. */
export interface SectionClassification {
  /** All detected sections. */
  readonly sections: readonly PssiSection[];
  /** Section type distribution (name → count). */
  readonly distribution: ReadonlyMap<string, number>;
  /** Whether the track has an intro-peak-outro arc. */
  readonly hasCanonicalArc: boolean;
  /** Total bars analyzed. */
  readonly totalBars: number;
}

/**
 * Classify sections from per-bar PSSI codes.
 *
 * @param pssiCodes - Per-bar PSSI type codes (one per bar)
 * @returns Section classification
 */
export function classifySections(
  pssiCodes: readonly number[],
): SectionClassification {
  if (pssiCodes.length === 0) {
    return {
      sections: [],
      distribution: new Map(),
      hasCanonicalArc: false,
      totalBars: 0,
    };
  }

  // Run-length encode consecutive same-type bars into sections
  const sections: PssiSection[] = [];
  let currentType = pssiCodes[0]!;
  let startBar = 0;

  for (let i = 1; i <= pssiCodes.length; i++) {
    const code = i < pssiCodes.length ? pssiCodes[i]! : -1;
    if (code !== currentType) {
      sections.push({
        type: currentType,
        name: pssiTypeName(currentType),
        startBar,
        endBar: i,
        lengthBars: i - startBar,
      });
      currentType = code;
      startBar = i;
    }
  }

  // Distribution
  const distribution = new Map<string, number>();
  for (const s of sections) {
    distribution.set(s.name, (distribution.get(s.name) ?? 0) + 1);
  }

  // Check for canonical arc: intro → (buildup|drop)+ → outro
  const hasIntro = sections.some((s) => s.type === PSSI_TYPES.INTRO);
  const hasDrop = sections.some((s) => s.type === PSSI_TYPES.CHORUS);
  const hasOutro = sections.some((s) => s.type === PSSI_TYPES.OUTRO);
  const hasCanonicalArc = hasIntro && hasDrop && hasOutro;

  return {
    sections,
    distribution,
    hasCanonicalArc,
    totalBars: pssiCodes.length,
  };
}

/**
 * Compute section-level features from PSSI + bar features.
 */
export function sectionFeatures(
  sections: readonly PssiSection[],
  barLufs: readonly number[],
): { name: string; meanLufs: number; lengthBars: number }[] {
  return sections.map((s) => {
    const lufsSlice = barLufs.slice(s.startBar, s.endBar);
    const meanLufs =
      lufsSlice.length > 0
        ? round3(lufsSlice.reduce((a, b) => a + b, 0) / lufsSlice.length)
        : 0;
    return { name: s.name, meanLufs, lengthBars: s.lengthBars };
  });
}
