/**
 * comment-v3.ts — Comment string v3.
 *
 * Tier 2 format: `E6·Driving·A46·H27·Tech House`
 * Tier 3 format: `E6·Driving·A46·H27·Tech House-Progressive·Build`
 *
 * Rules:
 * - No Key (redundant — RB shows it in its own column)
 * - Energy integer 1–10 prefixed "E"
 * - Vibe from 7-bucket system (incorporates happy via Bright/Groovy)
 * - Aggressive % ("A" + 0–99, omit when < 5 — reads as chill)
 * - Happy % ("H" + 0–99, omit when < 5 — reads as neutral)
 * - Up to 2 genres: secondary-tertiary (primary already in RB Genre column)
 *   Secondary = primary → skip, promote tertiary
 * - Set placement (Tier 3 only): Peak/Build/Floor/Opener/Closer
 * - Separator: `·` (no spaces — compact for CDJ screens)
 * - Genres dash-separated: `House-Tech House`
 * - All characters fleet-safe (ASCII + `·`, no emoji/geometric/arrows)
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

/** Set placement labels derived from energy × vibe. */
export type SetPlacement = "Peak" | "Build" | "Floor" | "Opener" | "Closer";

/** Derive set placement from energy + vibe (zero new analysis). */
export function setPlacement(energy: number, vibe: Vibe): SetPlacement {
  if (vibe === "Hard") return energy >= 8 ? "Peak" : "Build";
  if (vibe === "Driving") return energy >= 7 ? "Build" : "Floor";
  if (vibe === "Groovy") return "Floor";
  if (vibe === "Medium") return "Floor";
  if (vibe === "Bright") return energy >= 6 ? "Floor" : "Opener";
  if (vibe === "Smooth") return energy >= 5 ? "Floor" : "Opener";
  // Deep
  return "Closer";
}

/** Aggressive/happy percentage omission threshold. Values below this
 *  are omitted — the absence reads as "not notably aggressive/happy". */
const AH_OMIT_THRESHOLD = 5;

export interface CommentV3Input {
  /** Energy integer 1–10. Null = not available. */
  readonly energy: number | null;
  /** Vibe bucket. Null = no mood data. */
  readonly vibe: Vibe | null;
  /** Aggressive percentage 0–99 (from moodAggressive × 100). Null = unavailable. */
  readonly aggressive: number | null;
  /** Happy percentage 0–99 (from moodHappy × 100). Null = unavailable. */
  readonly happy: number | null;
  /** Secondary genre (2nd place vote). Null = unavailable. */
  readonly genre2: string | null;
  /** Tertiary genre (3rd place vote). Null = unavailable. */
  readonly genre3: string | null;
  /** Primary genre (for dedup — secondary matching primary is skipped). Null = no primary. */
  readonly primaryGenre: string | null;
  /** Set placement (Tier 3). Null = omit. */
  readonly placement: SetPlacement | null;
}

/** Build the v3 comment string. Compact `·` separator, genres dash-joined.
 *
 *  Tier 2: `E6·Driving·A46·H27·Tech House`
 *  Tier 3: `E6·Driving·A46·H27·Tech House-Progressive·Build` */
export function buildCommentV3(input: CommentV3Input): string {
  const parts: string[] = [];

  if (input.energy !== null && Number.isFinite(input.energy)) {
    parts.push(`E${Math.round(input.energy)}`);
  }

  if (input.vibe !== null) {
    parts.push(input.vibe);
  }

  // Aggressive % — omit below threshold (reads as "chill")
  if (
    input.aggressive !== null &&
    Number.isFinite(input.aggressive) &&
    Math.round(input.aggressive) >= AH_OMIT_THRESHOLD
  ) {
    parts.push(`A${Math.round(input.aggressive)}`);
  }

  // Happy % — omit below threshold (reads as "neutral")
  if (
    input.happy !== null &&
    Number.isFinite(input.happy) &&
    Math.round(input.happy) >= AH_OMIT_THRESHOLD
  ) {
    parts.push(`H${Math.round(input.happy)}`);
  }

  // Genres: secondary-tertiary (both optional).
  // Dedup: skip secondary when it matches primary (casefold compare).
  const primaryLower = input.primaryGenre?.toLowerCase() ?? "";
  const genres = [input.genre2, input.genre3].filter(
    (g): g is string =>
      g !== null && g.length > 0 && g.toLowerCase() !== primaryLower,
  );
  if (genres.length > 0) {
    parts.push(genres.join("-"));
  }

  // Set placement (Tier 3 — omit null)
  if (input.placement !== null) {
    parts.push(input.placement);
  }

  return parts.join("·");
}

const VIBES = new Set<string>([
  "Hard",
  "Driving",
  "Groovy",
  "Medium",
  "Bright",
  "Deep",
  "Smooth",
]);

const PLACEMENTS = new Set<string>([
  "Peak",
  "Build",
  "Floor",
  "Opener",
  "Closer",
]);

/** Parse a v3 comment string back into components. */
export function parseCommentV3(comment: string): {
  energy: number | null;
  vibe: string | null;
  aggressive: number | null;
  happy: number | null;
  genres: string | null;
  placement: string | null;
} {
  const parts = comment.split("·");
  let energy: number | null = null;
  let vibe: string | null = null;
  let aggressive: number | null = null;
  let happy: number | null = null;
  let genres: string | null = null;
  let placement: string | null = null;

  for (const part of parts) {
    if (/^E\d{1,2}$/i.test(part)) {
      const eVal = Number(part.slice(1));
      energy = Number.isFinite(eVal) ? eVal : null;
    } else if (/^A\d{1,2}$/i.test(part)) {
      const aVal = Number(part.slice(1));
      aggressive = Number.isFinite(aVal) ? aVal : null;
    } else if (/^H\d{1,2}$/i.test(part)) {
      const hVal = Number(part.slice(1));
      happy = Number.isFinite(hVal) ? hVal : null;
    } else if (VIBES.has(part)) {
      vibe = part;
    } else if (PLACEMENTS.has(part)) {
      placement = part;
    } else if (part.length > 0) {
      genres = part;
    }
  }

  return { energy, vibe, aggressive, happy, genres, placement };
}
