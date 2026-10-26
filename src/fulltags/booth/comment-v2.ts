/**
 * comment-v2.ts — Comment string v2 (B10.1).
 *
 * Format: `8A · E6 · VOX · house` (gated fields only, discriminative tag)
 *
 * Rules:
 * - Only gated fields render (key, energy, mood heads, genre)
 * - Mood heads with fire rate > 70% of library NEVER render (uninformative)
 * - One discriminative mood tag at most
 * - Genre renders only when the estimator passes its gate
 * - Energy is the integer 1–10 band, prefixed with "E"
 * - Key is Camelot notation (e.g. "8A")
 * - Separator: " · " (middle dot)
 */

/** Mood heads and their rendered labels. */
const MOOD_HEAD_LABELS: ReadonlyMap<string, string> = new Map([
  ["mood_party", "PARTY"],
  ["mood_dance", "DANCE"],
  ["mood_electronic", "ELEC"],
  ["mood_aggressive", "AGGRO"],
  ["mood_happy", "HAPPY"],
]);

/** Fields for building the comment. */
export interface CommentV2Input {
  /** Camelot key (e.g. "8A", "11B"). Null = key not gated. */
  readonly key: string | null;
  /** Energy integer 1–10. Null = energy not gated. */
  readonly energy: number | null;
  /** Mood head fire states: head name → fired (true/false). */
  readonly moodHeads: ReadonlyMap<string, boolean>;
  /** Per-head library fire rate (0–1). Used to suppress uninformative heads. */
  readonly headFireRates: ReadonlyMap<string, number>;
  /** Genre family from the estimator. Null = genre not gated. */
  readonly genre: string | null;
  /** Maximum fire rate for a head to be shown (default: 0.70). */
  readonly maxFireRate?: number | undefined;
}

/**
 * Build the v2 comment string.
 *
 * Only gated fields appear. Mood heads firing on > 70% of the library
 * are suppressed (they carry no information). At most one discriminative
 * mood tag is shown (the first fired head below the fire-rate cap).
 */
export function buildCommentV2(input: CommentV2Input): string {
  const maxRate = input.maxFireRate ?? 0.7;
  const parts: string[] = [];

  // Key
  if (input.key !== null && input.key.length > 0) {
    parts.push(input.key);
  }

  // Energy
  if (input.energy !== null && Number.isFinite(input.energy)) {
    parts.push(`E${Math.round(input.energy)}`);
  }

  // Discriminative mood tag (first fired head below fire-rate cap)
  for (const [head, fired] of input.moodHeads) {
    if (!fired) continue;
    const rate = input.headFireRates.get(head) ?? 1;
    if (rate > maxRate) continue;
    const label = MOOD_HEAD_LABELS.get(head) ?? head.replace("mood_", "").toUpperCase();
    parts.push(label);
    break; // at most one
  }

  // Genre
  if (input.genre !== null && input.genre.length > 0) {
    parts.push(input.genre);
  }

  return parts.join(" · ");
}

/**
 * Parse a v2 comment string back into its components.
 * Used by round-trip tests.
 */
export function parseCommentV2(comment: string): {
  key: string | null;
  energy: number | null;
  mood: string | null;
  genre: string | null;
} {
  const parts = comment.split(" · ").map((p) => p.trim());
  let key: string | null = null;
  let energy: number | null = null;
  let mood: string | null = null;
  let genre: string | null = null;

  for (const part of parts) {
    if (/^\d{1,2}[AB]$/i.test(part)) {
      key = part;
    } else if (/^E\d{1,2}$/i.test(part)) {
      energy = Number(part.slice(1));
    } else if ([...MOOD_HEAD_LABELS.values()].some((l) => l.toUpperCase() === part.toUpperCase())) {
      mood = part;
    } else if (part.length > 0) {
      genre = part;
    }
  }

  return { key, energy, mood, genre };
}
