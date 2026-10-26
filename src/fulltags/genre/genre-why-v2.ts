/**
 * genre-why-v2.ts — V2 explainability: evidence, scope, reliability, posterior (B5.6).
 *
 * Upgrades the genre-why output with:
 * - Per-evidence-row detail (source, scope, audio_match, verification)
 * - Annotator reliability from Dawid-Skene
 * - Calibrated posterior distribution over L2 families
 * - L3 ranked subgenres within the elected family
 * - Version identity context (exact / sibling / reject)
 *
 * Wire shape is a superset of genre-why v1 — the `votes` array is replaced
 * by `evidence` with richer fields, and `posterior` + `annotators` are added.
 */
import type { Annotation, AnnotatorReliability, TrackPosterior } from "./dawid-skene";
import type { L3Ranked } from "./l3-rank";

/** A single evidence row in the v2 breakdown. */
export interface GenreWhyEvidence {
  /** Source identifier (e.g. "beatport", "soundcloud", "itunes"). */
  readonly source: string;
  /** Evidence scope: exact_recording, same_song_other_version, remixer, user, fallback. */
  readonly scope: string;
  /** Raw genre string from the source. */
  readonly rawGenre: string;
  /** Mapped L2 family (null if unmappable). */
  readonly family: string | null;
  /** Evidence weight (from the vote system). */
  readonly weight: number;
  /** Whether this evidence was collapsed (sibling collapse). */
  readonly collapsed: boolean;
  /** Audio match confidence (0–1), null if no audio verification. */
  readonly audioMatch: number | null;
  /** Verification status. */
  readonly verification: "verified" | "unverified" | "disputed";
}

/** The full v2 genre-why output. */
export interface GenreWhyV2Result {
  readonly videoId: string;
  readonly title: string;
  readonly artist: string;
  /** Current DB genre (may differ from posterior). */
  readonly dbGenre: string | null;
  /** Evidence rows. */
  readonly evidence: readonly GenreWhyEvidence[];
  /** Calibrated posterior from Dawid-Skene. */
  readonly posterior: TrackPosterior | null;
  /** L3 ranked subgenres within the elected family. */
  readonly l3Ranked: readonly L3Ranked[];
  /** Per-annotator reliability scores. */
  readonly annotators: readonly AnnotatorReliability[];
  /** Version identity context. */
  readonly versionType: string | null;
  /** Whether the posterior agrees with the DB genre. */
  readonly posteriorMatchesDb: boolean;
  /** Confidence of the posterior top-1 (0–1). */
  readonly confidence: number;
}

/**
 * Build annotations from evidence rows for Dawid-Skene input.
 * Each evidence row becomes one annotation: annotatorId = `source:scope`.
 */
export function evidenceToAnnotations(
  trackId: string,
  evidence: readonly GenreWhyEvidence[],
): Annotation[] {
  return evidence
    .filter((e) => e.family !== null)
    .map((e) => ({ trackId, annotatorId: `${e.source}:${e.scope}`, label: e.family! }));
}

/**
 * Format a v2 genre-why result as human-readable lines.
 */
export function formatGenreWhyV2(result: GenreWhyV2Result): string[] {
  const lines: string[] = [];
  lines.push(`Track: ${result.title} — ${result.artist}`);
  lines.push(`DB Genre: ${result.dbGenre ?? "null"}`);

  if (result.versionType) {
    lines.push(`Version: ${result.versionType}`);
  }

  if (result.evidence.length > 0) {
    lines.push("");
    lines.push("Evidence:");
    for (const e of result.evidence) {
      const scope = e.collapsed ? `${e.scope}↓` : e.scope;
      const verified =
        e.verification === "verified" ? " ✓" : e.verification === "disputed" ? " ✗" : "";
      lines.push(
        `  ${e.source.padEnd(12)} ${scope.padEnd(28)} → ${e.rawGenre} (${e.family ?? "?"}) w=${e.weight.toFixed(2)}${verified}`,
      );
    }
  }

  if (result.posterior) {
    lines.push("");
    lines.push(
      `Posterior: ${result.posterior.family} (${(result.posterior.probability * 100).toFixed(1)}%)`,
    );
    if (result.posterior.family2) {
      lines.push(
        `  Runner-up: ${result.posterior.family2} (${((result.posterior.probability2 ?? 0) * 100).toFixed(1)}%)`,
      );
    }
    if (!result.posteriorMatchesDb) {
      lines.push(
        `  DRIFT: posterior elects "${result.posterior.family}" but DB stores "${result.dbGenre ?? "null"}"`,
      );
    }
  }

  if (result.l3Ranked.length > 0) {
    lines.push("");
    lines.push("L3 Subgenres:");
    for (const l3 of result.l3Ranked) {
      lines.push(`  ${l3.subgenre} (${(l3.probability * 100).toFixed(1)}%, ${l3.voteCount} votes)`);
    }
  }

  if (result.annotators.length > 0) {
    lines.push("");
    lines.push("Annotator Reliability:");
    for (const a of result.annotators) {
      lines.push(`  ${a.annotatorId.padEnd(30)} accuracy=${(a.accuracy * 100).toFixed(1)}%`);
    }
  }

  return lines;
}
