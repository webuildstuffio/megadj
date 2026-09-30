/**
 * comment-v3.ts — Comment string v3.
 *
 * Format: `E6·Driving·House-Tech House`
 *
 * Rules:
 * - No Key (redundant — RB shows it in its own column)
 * - Energy integer 1–10 prefixed "E"
 * - Vibe from 7-bucket system (incorporates happy via Bright/Groovy)
 * - Up to 2 genres: secondary-tertiary (primary already in RB Genre column)
 * - Separator: `·` (no spaces — compact for CDJ screens)
 * - Genres dash-separated: `House-Tech House`
 */

/** The 7 vibe buckets derived from aggressive + happy + valence. */
export type Vibe =
  "Hard" | "Driving" | "Groovy" | "Medium" | "Bright" | "Deep" | "Smooth";

/** Derive vibe bucket from mood model dimensions. */
export function vibeFromMood(
  aggressive: number,
  happy: number,
  valence: number,
): Vibe {
  if (aggressive > 0.7) return "Hard";
  if (aggressive > 0.4) return "Driving";
  if (aggressive > 0.2 && happy > 0.3) return "Groovy";
  if (aggressive > 0.2) return "Medium";
  if (happy > 0.3) return "Bright";
  if (valence < 4.2) return "Deep";
  return "Smooth";
}

export interface CommentV3Input {
  /** Energy integer 1–10. Null = not available. */
  readonly energy: number | null;
  /** Vibe bucket. Null = no mood data. */
  readonly vibe: Vibe | null;
  /** Secondary genre (2nd place vote). Null = unavailable. */
  readonly genre2: string | null;
  /** Tertiary genre (3rd place vote). Null = unavailable. */
  readonly genre3: string | null;
}

/** Build the v3 comment string. Compact `·` separator, genres dash-joined. */
export function buildCommentV3(input: CommentV3Input): string {
  const parts: string[] = [];

  if (input.energy !== null && Number.isFinite(input.energy)) {
    parts.push(`E${Math.round(input.energy)}`);
  }

  if (input.vibe !== null) {
    parts.push(input.vibe);
  }

  // Genres: secondary-tertiary (both optional)
  const genres = [input.genre2, input.genre3].filter(
    (g): g is string => g !== null && g.length > 0,
  );
  if (genres.length > 0) {
    parts.push(genres.join("-"));
  }

  return parts.join("·");
}

/** Parse a v3 comment string back into components. */
export function parseCommentV3(comment: string): {
  energy: number | null;
  vibe: string | null;
  genres: string | null;
} {
  const parts = comment.split("·");
  let energy: number | null = null;
  let vibe: string | null = null;
  let genres: string | null = null;

  const VIBES = new Set<string>([
    "Hard",
    "Driving",
    "Groovy",
    "Medium",
    "Bright",
    "Deep",
    "Smooth",
  ]);

  for (const part of parts) {
    if (/^E\d{1,2}$/i.test(part)) {
      const n = Number(part.slice(1));
      energy = Number.isFinite(n) ? n : null;
    } else if (VIBES.has(part)) {
      vibe = part;
    } else if (part.length > 0) {
      genres = part;
    }
  }

  return { energy, vibe, genres };
}
