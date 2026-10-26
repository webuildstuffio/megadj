/**
 * identity/version.ts — title version parser for the remix-identity fix (WS3).
 *
 * Parses a track title + artist field into a structured VersionIdentity:
 * baseTitle, originalArtists, versionType, versionArtists, featured.
 * Used by the name-match SSOT to gate evidence by recording identity.
 *
 * Strategy: ordered regex table (first hit wins), each pattern unit-tested.
 * LLM fallback (B3.2) only when confidence < 0.7.
 */

export type VersionType =
  | "original"
  | "extended"
  | "radio"
  | "remix"
  | "edit"
  | "bootleg"
  | "flip"
  | "vip"
  | "rework"
  | "dub"
  | "instrumental"
  | "acapella"
  | "acoustic"
  | "live"
  | "unknown";

export interface VersionIdentity {
  /** Normalized base title, NFC + casefold via name-key SSOT. */
  baseTitle: string;
  /** Split on feat./&/x/,/vs. */
  originalArtists: string[];
  /** Featured artists extracted from title or artist field. */
  featured: string[];
  versionType: VersionType;
  /** Remixer(s) / editor(s). */
  versionArtists: string[];
  /** Text inside the brackets, verbatim. */
  rawVersion: string | null;
  /** 1.0 = clean regex hit; <0.7 → LLM fallback needed. */
  confidence: number;
  parser: "regex" | "llm";
}

// ---------------------------------------------------------------------------
// Regex table — ordered, first hit wins
// ---------------------------------------------------------------------------

interface VersionPattern {
  /** Regex matching the version bracket/suffix in the title. */
  pattern: RegExp;
  /** VersionType this pattern produces. */
  type: VersionType;
  /** Whether the match has a version-artist capture group. */
  hasArtist: boolean;
}

/** Open bracket: ( or [ */
const OB = "(?:\\(|\\[)";
/** Close bracket: ) or ] */
const CB = "(?:\\)|\\])";
/** Helper to build bracket-delimited version patterns. */
function vp(inner: string, flags = "iu"): RegExp {
  return new RegExp(`${OB}\\s*${inner}\\s*${CB}`, flags);
}
function vpa(inner: string, flags = "iu"): RegExp {
  return new RegExp(`${OB}\\s*(.+?)\\s+${inner}\\s*${CB}`, flags);
}

const VERSION_PATTERNS: readonly VersionPattern[] = [
  // Remix variants
  { pattern: vpa("(?:re-?mix|rmx)"), type: "remix", hasArtist: true },
  { pattern: /\s+-\s+(.+?)\s+(?:re-?mix|rmx)\s*$/iu, type: "remix", hasArtist: true },
  // Radio edit must come before generic edit — "Radio Edit" is not an artist
  { pattern: vp("radio\\s+edit"), type: "radio", hasArtist: false },
  // Edit variants
  { pattern: vpa("edit"), type: "edit", hasArtist: true },
  // Bootleg variants
  { pattern: vpa("bootleg"), type: "bootleg", hasArtist: true },
  // Flip
  { pattern: vpa("flip"), type: "flip", hasArtist: true },
  // VIP
  { pattern: vpa("vip"), type: "vip", hasArtist: true },
  { pattern: vp("vip"), type: "vip", hasArtist: false },
  // Rework
  { pattern: vpa("rework"), type: "rework", hasArtist: true },
  // Dub
  { pattern: vpa("dub(?:\\s+mix)?"), type: "dub", hasArtist: true },
  // Refix
  { pattern: vpa("refix"), type: "refix" as VersionType, hasArtist: true },
  // Extended / Original / Club — no version artist
  { pattern: vp("extended\\s+mix"), type: "extended", hasArtist: false },
  { pattern: vp("original\\s+mix"), type: "original", hasArtist: false },
  { pattern: vp("club\\s+mix"), type: "extended", hasArtist: false },
  // Performance/production variants — no version artist
  { pattern: vp("acoustic"), type: "acoustic", hasArtist: false },
  { pattern: new RegExp(`${OB}\\s*live\\b[^)\\]]*${CB}`, "iu"), type: "live", hasArtist: false },
  { pattern: vp("instrumental"), type: "instrumental", hasArtist: false },
  { pattern: vp("acapella"), type: "acapella", hasArtist: false },
  { pattern: vp("a\\s*cappella"), type: "acapella", hasArtist: false },
];

// ---------------------------------------------------------------------------
// Featured artist extraction
// ---------------------------------------------------------------------------

const FEAT_PATTERN = /\s*(?:feat\.?|ft\.?|featuring)\s+(.+?)(?:\s*[([]|$)/iu;
const ARTIST_SEPARATORS = /\s*(?:,\s*|\s+&\s+|\s+x\s+|\s+vs\.?\s+)/iu;

function splitArtists(raw: string): string[] {
  return raw
    .split(ARTIST_SEPARATORS)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function extractFeatured(
  title: string,
  artist: string,
): { cleanTitle: string; featured: string[] } {
  const featured: string[] = [];

  // From title
  const titleFeat = FEAT_PATTERN.exec(title);
  let cleanTitle = title;
  if (titleFeat?.[1]) {
    featured.push(...splitArtists(titleFeat[1]));
    cleanTitle = title.slice(0, titleFeat.index).trim();
  }

  // From artist field
  const artistFeat = FEAT_PATTERN.exec(artist);
  if (artistFeat?.[1]) {
    featured.push(...splitArtists(artistFeat[1]));
  }

  return { cleanTitle, featured: [...new Set(featured)] };
}

// ---------------------------------------------------------------------------
// Core parser
// ---------------------------------------------------------------------------

function normalizeTitle(raw: string): string {
  return raw.normalize("NFC").trim();
}

/**
 * Parse a track title + artist field into a VersionIdentity.
 *
 * The regex table runs in order; the first hit wins. Nested/double
 * brackets pick the most specific bracket. Artist field containing the
 * remixer with title "(X Remix)" → X moves to versionArtists.
 */
export function parseVersion(title: string, artistField: string): VersionIdentity {
  const normTitle = normalizeTitle(title);
  const { cleanTitle, featured } = extractFeatured(normTitle, artistField);

  // Try each pattern in order
  for (const { pattern, type, hasArtist } of VERSION_PATTERNS) {
    const m = pattern.exec(cleanTitle);
    if (!m) continue;
    const rawVersion = m[0]!.replace(/^[([\s]+/u, "").replace(/[\s)\]]+$/u, "");
    const versionArtists = hasArtist && m[1] ? splitArtists(m[1]) : [];
    const baseTitle = cleanTitle
      .slice(0, m.index)
      .trim()
      .replace(/\s*[-–—]\s*$/u, "");
    const originalArtists = splitArtists(artistField.replace(FEAT_PATTERN, "").trim()).filter(
      (a) => !versionArtists.some((v) => v.toLowerCase() === a.toLowerCase()),
    );

    return {
      baseTitle: baseTitle.toLowerCase(),
      originalArtists,
      featured,
      versionType: type,
      versionArtists,
      rawVersion,
      confidence: 1.0,
      parser: "regex",
    };
  }

  // No version bracket found — it's an original
  const baseTitle = cleanTitle.replace(/\s*[-–—]\s*$/u, "").trim();
  const originalArtists = splitArtists(artistField.replace(FEAT_PATTERN, "").trim());

  return {
    baseTitle: baseTitle.toLowerCase(),
    originalArtists,
    featured,
    versionType: "original",
    versionArtists: [],
    rawVersion: null,
    confidence: 0.9,
    parser: "regex",
  };
}

// ---------------------------------------------------------------------------
// Version compatibility (§4.2)
// ---------------------------------------------------------------------------

export type VersionMatch = "exact" | "sibling" | "reject";

/**
 * Check whether a query version and a candidate version are compatible
 * for evidence purposes.
 *
 * - exact: same baseTitle, same versionType class, overlapping versionArtists
 * - sibling: same baseTitle + originalArtists, different version
 * - reject: anything else
 */
export function versionCompatible(q: VersionIdentity, c: VersionIdentity): VersionMatch {
  if (q.baseTitle !== c.baseTitle) return "reject";
  // Same base title — check version compatibility
  const sameType = q.versionType === c.versionType;
  const bothNoArtist = q.versionArtists.length === 0 && c.versionArtists.length === 0;
  const overlappingArtists =
    q.versionArtists.length > 0 &&
    c.versionArtists.length > 0 &&
    q.versionArtists.some((a) => c.versionArtists.some((b) => a.toLowerCase() === b.toLowerCase()));
  if (sameType && (bothNoArtist || overlappingArtists)) return "exact";
  return "sibling";
}
