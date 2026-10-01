/**
 * sc-tag-sanitizer.ts — Multi-layer SoundCloud tag sanitizer.
 *
 * SoundCloud track tags (hashtags applied by uploaders) carry rich
 * subgenre, mood, and scene information, but ~30-40% are spam/self-promo
 * junk. This module provides a 3-layer sanitization pipeline:
 *
 * Layer 1: Blocklist — kills known junk patterns (free*, download*,
 *          follow*, repost*, promo*, URLs, numeric-only, single-char).
 * Layer 2: Genre vocabulary gate — only tags that map through
 *          canonicalizeClaim → a known genre label survive as genre tags.
 *          Unknown tags go to "mood/scene" bucket.
 * Layer 3: Mood/scene extraction — tags that fail the genre gate but
 *          match mood/energy/scene patterns feed booth comment enrichment.
 *
 * Pure — no DB, no IO, no network calls.
 */
import { canonicalizeClaim } from "../genre/genre-vocab";
import { mapToFamily, isUmbrella } from "../genre/taxonomy-v3";

/** A sanitized SC tag with classification. */
export interface SanitizedTag {
  readonly raw: string;
  readonly kind: "genre" | "mood" | "scene" | "junk";
  /** Canonicalized genre label (only for kind=genre). */
  readonly genre: string | null;
  /** L2 family (only for kind=genre). */
  readonly family: string | null;
}

/** Result from sanitizing a track's tag set. */
export interface SanitizeResult {
  /** Tags that mapped to a genre (L2/L3). */
  readonly genreTags: readonly SanitizedTag[];
  /** Tags that matched mood/scene patterns. */
  readonly moodTags: readonly SanitizedTag[];
  /** Tags rejected as junk. */
  readonly junkTags: readonly string[];
  /** Best genre label from the tag set (highest-confidence). */
  readonly bestGenre: string | null;
  /** Best L2 family. */
  readonly bestFamily: string | null;
}

// ---- Layer 1: Blocklist patterns ----

/** Patterns that indicate junk/spam tags. */
const JUNK_PATTERNS: RegExp[] = [
  /^free/i,
  /download/i,
  /^follow/i,
  /^repost/i,
  /^promo/i,
  /^buy/i,
  /^listen/i,
  /^click/i,
  /^share/i,
  /^submit/i,
  /^support/i,
  /^check/i,
  /^stream/i,
  /^available/i,
  /^out\s*now/i,
  /^new\s*release/i,
  /^premiere/i,
  /^exclusive/i,
  /^unsigned/i,
  /^send\s*demo/i,
  /https?:\/\//i,
  /\.com$/i,
  /\.net$/i,
  /\.io$/i,
  /^@/,
  /^\d+$/,
  /^.$/,
];

/** Tags that are artist self-promotion or platform noise. */
const JUNK_EXACT = new Set([
  "na",
  "n/a",
  "none",
  "other",
  "various",
  "unknown",
  "music",
  "soundcloud",
  "spotify",
  "youtube",
  "bandcamp",
  "beatport",
  "dj",
  "producer",
  "remix",
  "original",
  "official",
  "audio",
  "video",
  "mix",
  "set",
  "live",
  "new",
  "hot",
  "best",
  "top",
  "2024",
  "2025",
  "2026",
  "2027",
]);

function isJunk(tag: string): boolean {
  const lower = tag.toLowerCase().trim();
  if (lower.length < 2) return true;
  if (JUNK_EXACT.has(lower)) return true;
  return JUNK_PATTERNS.some((p) => p.test(lower));
}

// ---- Layer 3: Mood/scene patterns ----

const MOOD_PATTERNS: RegExp[] = [
  /\b(?:dark|light|bright|warm|cold|cool)\b/i,
  /\b(?:groovy|funky|bouncy|heavy|hard|soft)\b/i,
  /\b(?:uplifting|euphoric|melancholic|sad|happy|aggressive)\b/i,
  /\b(?:chill|relaxed|dreamy|atmospheric|ethereal|hypnotic)\b/i,
  /\b(?:energetic|intense|powerful|raw|dirty|clean)\b/i,
  /\b(?:underground|mainstream|indie|alternative)\b/i,
];

const SCENE_PATTERNS: RegExp[] = [
  /\b(?:berlin|ibiza|detroit|london|chicago|nyc|amsterdam)\b/i,
  /\b(?:club|warehouse|festival|rave|afterhours?|after.?party)\b/i,
  /\b(?:peak\s*time|warm\s*up|closing|opening|sunrise|sunset)\b/i,
  /\b(?:90s|80s|00s|oldschool|old.?school|retro|classic|vintage)\b/i,
  /\b(?:summer|winter|night|morning)\b/i,
];

function isMood(tag: string): boolean {
  return MOOD_PATTERNS.some((p) => p.test(tag));
}

function isScene(tag: string): boolean {
  return SCENE_PATTERNS.some((p) => p.test(tag));
}

/**
 * Sanitize a set of SoundCloud track tags.
 * Returns classified tags: genre (mapped), mood/scene, or junk (dropped).
 */
export function sanitizeScTags(rawTags: readonly string[]): SanitizeResult {
  const genreTags: SanitizedTag[] = [];
  const moodTags: SanitizedTag[] = [];
  const junkTags: string[] = [];

  for (const raw of rawTags) {
    const trimmed = raw.replace(/^#/, "").trim();
    if (!trimmed) continue;

    // Layer 1: blocklist
    if (isJunk(trimmed)) {
      junkTags.push(trimmed);
      continue;
    }

    // Layer 2: genre vocabulary gate
    const canon = canonicalizeClaim(trimmed);
    const family = mapToFamily(canon);
    if (family !== null && !isUmbrella(canon)) {
      genreTags.push({ raw: trimmed, kind: "genre", genre: canon, family });
      continue;
    }

    // Layer 3: mood/scene extraction
    if (isMood(trimmed)) {
      moodTags.push({ raw: trimmed, kind: "mood", genre: null, family: null });
      continue;
    }
    if (isScene(trimmed)) {
      moodTags.push({
        raw: trimmed,
        kind: "scene",
        genre: null,
        family: null,
      });
      continue;
    }

    // Unmapped: try the raw string through mapToFamily directly
    const directFamily = mapToFamily(trimmed);
    if (directFamily !== null) {
      genreTags.push({
        raw: trimmed,
        kind: "genre",
        genre: canonicalizeClaim(trimmed),
        family: directFamily,
      });
      continue;
    }

    // Unclassified — drop silently (neither genre nor mood/scene)
    junkTags.push(trimmed);
  }

  // Best genre: first genre tag (they're in tag-order priority)
  const bestGenre = genreTags[0]?.genre ?? null;
  const bestFamily = genreTags[0]?.family ?? null;

  return { genreTags, moodTags, junkTags, bestGenre, bestFamily };
}
