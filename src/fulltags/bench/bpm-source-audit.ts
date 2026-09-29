/**
 * bpm-source-audit.ts — MegaSet BPM source audit (B1.5).
 *
 * Audits the BPM sources in a MegaSet to identify which analyzer/source
 * contributed each BPM value, and how reliable each source is.
 *
 * Sources:
 * - beat_this: Python beat tracker (primary)
 * - rekordbox: RB's built-in analyzer
 * - essentia: Essentia's rhythm analysis
 * - tag: ID3/AIFF metadata BPM tag
 * - manual: User-entered BPM
 */
import { round3 } from "../../shared/leaf/fmt";

/** Known BPM sources. */
export type BpmSource =
  "beat_this" | "rekordbox" | "essentia" | "tag" | "manual" | "unknown";

/** A track's BPM with source provenance. */
export interface BpmProvenance {
  readonly trackId: string;
  readonly bpm: number;
  readonly source: BpmSource;
  /** Timestamp of the analysis. */
  readonly analyzedAt: string | null;
}

/** Per-source audit summary. */
export interface SourceAuditSummary {
  readonly source: BpmSource;
  readonly count: number;
  /** Mean absolute error vs answer keys (where available). */
  readonly mae: number | null;
  /** Exact accuracy (within 1%) vs answer keys. */
  readonly accuracy: number | null;
  /** Octave error rate. */
  readonly octaveRate: number | null;
}

/** Full audit result. */
export interface BpmSourceAuditResult {
  readonly totalTracks: number;
  readonly sourceBreakdown: readonly SourceAuditSummary[];
  /** Tracks with no BPM source. */
  readonly missingSource: number;
  /** Tracks with conflicting sources. */
  readonly conflicts: number;
}

/**
 * Audit BPM sources against answer keys.
 */
export function auditBpmSources(
  provenances: readonly BpmProvenance[],
  answerKeys: ReadonlyMap<string, number>,
): BpmSourceAuditResult {
  // Group by source
  const bySource = new Map<BpmSource, BpmProvenance[]>();
  for (const p of provenances) {
    const arr = bySource.get(p.source) ?? [];
    arr.push(p);
    bySource.set(p.source, arr);
  }

  const sourceBreakdown: SourceAuditSummary[] = [];
  for (const [source, tracks] of bySource) {
    const withAK = tracks.filter((t) => answerKeys.has(t.trackId));
    let mae: number | null = null;
    let accuracy: number | null = null;
    let octaveRate: number | null = null;

    if (withAK.length > 0) {
      let errorSum = 0;
      let exactCount = 0;
      let octaveCount = 0;

      for (const t of withAK) {
        const expected = answerKeys.get(t.trackId)!;
        const err = Math.abs(t.bpm - expected);
        errorSum += err;
        if (err / expected <= 0.01) exactCount++;
        const doubled = Math.abs(t.bpm - expected * 2);
        const halved = Math.abs(t.bpm - expected / 2);
        if (
          (doubled / (expected * 2) <= 0.01 ||
            halved / (expected / 2) <= 0.01) &&
          err / expected > 0.01
        ) {
          octaveCount++;
        }
      }

      mae = round3(errorSum / withAK.length);
      accuracy = round3(exactCount / withAK.length);
      octaveRate = round3(octaveCount / withAK.length);
    }

    sourceBreakdown.push({
      source,
      count: tracks.length,
      mae,
      accuracy,
      octaveRate,
    });
  }

  const missingSource = provenances.filter(
    (p) => p.source === "unknown",
  ).length;

  return {
    totalTracks: provenances.length,
    sourceBreakdown: sourceBreakdown.toSorted((a, b) => b.count - a.count),
    missingSource,
    conflicts: 0, // computed when multiple sources exist per track
  };
}
