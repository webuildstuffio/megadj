// genre-diagnostics.ts — Tier-0 diagnostics battery for the genre kNN
// (docs/archive/embedding-research-2026-09-14.md §5 items 0.1–0.4, the
// explicit "do first": ~4 h of measurement that decides whether the rest
// of the genre plan is worth 20 points or 5).
//
// Four measurements, all pure over (family, artist, vector) rows:
//   0.1  label-error clustering by artist — is the disagreement mass
//        concentrated on a few artists (systematic mislabelling ⇒ the
//        "label ceiling" story is wrong and relabelling buys ~nothing)
//        or spread thin (random noise ⇒ refold/active-labelling is
//        worth points)?
//   0.2  same-artist share of top-5 neighbours — effnet is the
//        Discogs-metadata tower, the likeliest to win LOO by artist
//        fingerprinting (Sturm's "horse"). >15% overlap ⇒ every LOO
//        number needs an artist-disjoint rerun before it means anything.
//   0.3  hubness histogram — k-occurrence distribution: how many tracks
//        appear in ≥10 of everyone's top-5 lists. A heavy tail means
//        whitening + CSLS is nearly-free retrieval points.
//   0.4  confusion matrix + top-2 accuracy — is the error mass the
//        house/techno/trance triangle (arguably not errors — genre
//        boundaries genuinely blur) or structural?
//
// Pure: no DB, no IO — the caller (genre.ts eval mode) feeds rows.

import {
  cosineSimilarity,
  type GenreSeed,
  type LoORowOutcome,
} from "../archive/similar";

/** The four Tier-0 readouts, one JSON-serializable shape. */
export interface GenreDiagnostics {
  /** 0.1 — artists ranked by LOO disagreement mass. */
  labelErrors: {
    /** distinct artists contributing disagreements */
    artists: number;
    /** share of all disagreements from the top 10 artists */
    top10Share: number;
    /** top contributors: artist, disagreements, share of total */
    top: { artist: string; disagreements: number; share: number }[];
    /** VERDICT: systematic ≥ 0.4, mixed ≥ 0.2, else random */
    verdict: "systematic" | "mixed" | "random";
  };
  /** 0.2 — artist leakage in the kNN itself. */
  artistOverlap: {
    /** mean same-artist share of each row's top-5 neighbours */
    meanTop5SameArtist: number;
    /** rows with >50% same-artist top-5 (the fingerprinted ones) */
    rowsMajoritySameArtist: number;
    /** VERDICT: rerun needed when mean > 0.15 */
    rerunNeeded: boolean;
  };
  /** 0.3 — hubness: k-occurrence histogram over top-5 membership. */
  hubness: {
    tracks: number;
    /** rows appearing in ≥10 of everyone's top-5 lists */
    hubs10: number;
    /** max top-5 appearances by one track */
    maxOccurrence: number;
    /** occurrences at p50/p90/p99 (0 when the bin is past the end) */
    p50: number;
    p90: number;
    p99: number;
  };
  /** 0.4 — confusion matrix + top-2. */
  confusion: {
    /** family × family counts, truth → predicted (gated votes only) */
    matrix: Record<string, Record<string, number>>;
    /** share of disagreements inside the house/techno/trance triangle */
    triangleShare: number;
    /** top-2 accuracy share (truth in the vote's best two) */
    top2Accuracy: number;
  };
}

const TRIANGLE = new Set(["house", "techno", "trance"]);

/**
 * Run the full Tier-0 battery. `pop` is the eval population with artists
 * and PRE-COMPUTED families (the caller reuses genreFamily so the family
 * map stays the single source of truth); `loo` supplies the per-row LOO
 * outcomes so the harness in similar.ts owns the voting math once.
 */
export function tier0Diagnostics(
  pop: (GenreSeed & { artist: string; family: string })[],
  loo: readonly LoORowOutcome[],
  k = 5,
): GenreDiagnostics {
  // ---- 0.1 label-error clustering (gated DISAGREEMENTS by artist) ----
  const gated = loo.filter((row) => row.predicted !== null);
  const disagreements = gated.filter((row) => row.predicted !== row.family);
  const byArtist = new Map<string, number>();
  for (const row of disagreements) {
    const artist =
      pop.find((p) => p.videoId === row.videoId)?.artist ?? "unknown";
    byArtist.set(artist, (byArtist.get(artist) ?? 0) + 1);
  }
  const total = disagreements.length;
  const ranked = [...byArtist.entries()]
    .map(([artist, count]) => ({
      artist,
      disagreements: count,
      share: total > 0 ? Math.round((count / total) * 1000) / 1000 : 0,
    }))
    .toSorted((a, b) => b.disagreements - a.disagreements);
  const top10Share =
    total > 0
      ? Math.round(
          (ranked.slice(0, 10).reduce((acc, r) => acc + r.disagreements, 0) /
            total) *
            1000,
        ) / 1000
      : 0;
  const verdict =
    top10Share >= 0.4 ? "systematic" : top10Share >= 0.2 ? "mixed" : "random";

  // ---- 0.2 artist overlap in top-5 + 0.3 hubness histogram ----
  // one shared pass: each row's top-k (id + artist) feeds both readouts
  let sameArtistSum = 0;
  let majorityRows = 0;
  const occurrence = new Map<string, number>();
  for (let i = 0; i < pop.length; i++) {
    const held = pop[i]!;
    const nn = pop
      .filter((s, j) => j !== i && s.vec.length === held.vec.length)
      .map((s) => ({
        id: s.videoId,
        artist: s.artist,
        score: cosineSimilarity(held.vec, s.vec),
      }))
      .toSorted((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, k);
    const same = nn.filter((n) => n.artist === held.artist).length;
    sameArtistSum += same / Math.max(1, nn.length);
    if (nn.length > 0 && same > nn.length / 2) majorityRows++;
    for (const n of nn) occurrence.set(n.id, (occurrence.get(n.id) ?? 0) + 1);
  }
  const meanTop5 =
    pop.length > 0 ? Math.round((sameArtistSum / pop.length) * 1000) / 1000 : 0;
  const counts = [...occurrence.values()].toSorted((a, b) => a - b);
  const at = (p: number): number =>
    counts.length === 0
      ? 0
      : counts[
          Math.min(counts.length - 1, Math.floor((p / 100) * counts.length))
        ]!;

  // ---- 0.4 confusion matrix + top-2 ----
  const matrix: Record<string, Record<string, number>> = {};
  let triangle = 0;
  let disagreeTotal = 0;
  for (const row of loo) {
    if (row.predicted === null) continue;
    const held = pop.find((p) => p.videoId === row.videoId);
    if (!held) continue;
    matrix[held.family] ??= {};
    matrix[held.family]![row.predicted] =
      (matrix[held.family]![row.predicted] ?? 0) + 1;
    if (row.predicted !== held.family) {
      disagreeTotal++;
      if (TRIANGLE.has(held.family) && TRIANGLE.has(row.predicted)) triangle++;
    }
  }
  const top2Hit = loo.filter((row) => {
    if (row.predicted === null) return false;
    const held = pop.find((p) => p.videoId === row.videoId);
    return held !== undefined && row.top2.includes(held.family);
  }).length;

  return {
    labelErrors: {
      artists: byArtist.size,
      top10Share,
      top: ranked.slice(0, 10),
      verdict,
    },
    artistOverlap: {
      meanTop5SameArtist: meanTop5,
      rowsMajoritySameArtist: majorityRows,
      rerunNeeded: meanTop5 > 0.15,
    },
    hubness: {
      tracks: occurrence.size,
      hubs10: counts.filter((c) => c >= 10).length,
      maxOccurrence: counts[counts.length - 1] ?? 0,
      p50: at(50),
      p90: at(90),
      p99: at(99),
    },
    confusion: {
      matrix,
      triangleShare:
        disagreeTotal > 0
          ? Math.round((triangle / disagreeTotal) * 1000) / 1000
          : 0,
      top2Accuracy:
        gated.length > 0
          ? Math.round((top2Hit / gated.length) * 1000) / 1000
          : 0,
    },
  };
}
