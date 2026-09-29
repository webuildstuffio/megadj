/**
 * sibling-collapse.ts — Collapse same_song_other_version evidence (B3.5).
 *
 * Five different sources describing the Taylor Swift original = one fact.
 * All `same_song_other_version` evidence for one track collapses into a
 * single vote before estimation: the family with the most mass among
 * siblings, weight = one voter.
 *
 * Also implements the remixer prior: for remix/edit/bootleg/flip/vip/rework
 * tracks, the remixer's catalog genres produce `remixer:catalog` annotator
 * evidence at the `remixer` scope.
 */
import type { GenreEvidence, EvidenceScope } from "./evidence-store";

/** The result of collapsing sibling evidence for one track. */
export interface CollapsedEvidence {
  readonly trackId: string;
  /** Collapsed sibling → one vote per family with the most mass. */
  readonly collapsed: GenreEvidence[];
  /** Non-sibling evidence passed through unchanged. */
  readonly direct: GenreEvidence[];
  /** Number of sibling rows before collapse. */
  readonly siblingRowsIn: number;
  /** Number of collapsed rows out. */
  readonly siblingRowsOut: number;
}

/**
 * Collapse evidence for a single track:
 * - `exact_recording` and non-sibling scopes pass through unchanged.
 * - All `same_song_other_version` rows collapse per family:
 *   the family with the most sources wins, emitting one row with
 *   the max confidence among those sources.
 */
export function collapseEvidence(
  trackId: string,
  rows: readonly GenreEvidence[],
): CollapsedEvidence {
  const direct: GenreEvidence[] = [];
  const siblings: GenreEvidence[] = [];

  for (const r of rows) {
    if (r.scope === "same_song_other_version") {
      siblings.push(r);
    } else {
      direct.push(r);
    }
  }

  if (siblings.length === 0) {
    return {
      trackId,
      collapsed: [],
      direct,
      siblingRowsIn: 0,
      siblingRowsOut: 0,
    };
  }

  // Group siblings by family, pick the one with most mass
  const familyGroups = new Map<
    string,
    { rows: GenreEvidence[]; totalConf: number; maxConf: number }
  >();
  for (const r of siblings) {
    const key = r.genreFamily.toLowerCase();
    const group = familyGroups.get(key) ?? {
      rows: [],
      totalConf: 0,
      maxConf: 0,
    };
    group.rows.push(r);
    group.totalConf += r.confidence;
    group.maxConf = Math.max(group.maxConf, r.confidence);
    familyGroups.set(key, group);
  }

  // Emit one collapsed row per family
  const collapsed: GenreEvidence[] = [];
  for (const [, group] of familyGroups) {
    // Use the highest-confidence source as the representative
    const best = group.rows.toSorted((a, b) => b.confidence - a.confidence)[0];
    if (best === undefined) continue;
    collapsed.push({
      ...best,
      annotatorId: `sibling:collapsed:${best.annotatorId}`,
      confidence: group.maxConf,
      evidence: `collapsed ${group.rows.length} sibling sources`,
    });
  }

  return {
    trackId,
    collapsed,
    direct,
    siblingRowsIn: siblings.length,
    siblingRowsOut: collapsed.length,
  };
}

/**
 * Collapse evidence for many tracks at once.
 * Returns a flat list of evidence rows ready for the estimator:
 * direct evidence + collapsed sibling evidence.
 */
export function collapseEvidenceBatch(
  evidenceByTrack: ReadonlyMap<string, readonly GenreEvidence[]>,
): {
  rows: GenreEvidence[];
  stats: {
    tracksProcessed: number;
    siblingRowsIn: number;
    siblingRowsOut: number;
  };
} {
  const allRows: GenreEvidence[] = [];
  let totalSibIn = 0;
  let totalSibOut = 0;

  for (const [trackId, rows] of evidenceByTrack) {
    const result = collapseEvidence(trackId, rows);
    allRows.push(...result.direct, ...result.collapsed);
    totalSibIn += result.siblingRowsIn;
    totalSibOut += result.siblingRowsOut;
  }

  return {
    rows: allRows,
    stats: {
      tracksProcessed: evidenceByTrack.size,
      siblingRowsIn: totalSibIn,
      siblingRowsOut: totalSibOut,
    },
  };
}

/** Version types that qualify for the remixer prior. */
const REMIXER_VERSION_TYPES = new Set([
  "remix",
  "edit",
  "bootleg",
  "flip",
  "vip",
  "rework",
]);

/**
 * Build remixer prior evidence for a track.
 *
 * For tracks with a remix/edit/bootleg version type, the remixer's
 * catalog genres serve as prior evidence at the `remixer` scope.
 *
 * @param trackId - Track identifier
 * @param versionType - From parseVersion result
 * @param versionArtists - Remixer name(s)
 * @param remixerGenres - Families from the remixer's catalog (e.g. Beatport artist page)
 * @returns Evidence rows for the remixer prior, or empty if not applicable
 */
export function buildRemixerPrior(
  trackId: string,
  versionType: string,
  versionArtists: readonly string[],
  remixerGenres: readonly { family: string; confidence: number }[],
): GenreEvidence[] {
  if (!REMIXER_VERSION_TYPES.has(versionType)) return [];
  if (versionArtists.length === 0) return [];
  if (remixerGenres.length === 0) return [];

  const remixerName = versionArtists.join(" & ");
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  return remixerGenres.map((g) => ({
    trackId,
    annotatorId: `remixer:catalog:${remixerName.toLowerCase()}`,
    scope: "remixer" as EvidenceScope,
    genreFamily: g.family,
    genreSubgenre: null,
    confidence: g.confidence,
    verified: false,
    audioMatch: null,
    sourceUrl: null,
    evidence: `remixer prior from ${remixerName}'s catalog`,
    createdAt: now,
  }));
}
