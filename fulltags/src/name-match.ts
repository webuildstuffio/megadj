/**
 * name-match.ts — the ONE name-matching vocabulary for catalog searches.
 *
 * Three sources score "is this hit the same track as my query?" —
 * SoundCloud (art-sources.ts), Beatport (beatport.ts), and now Bandcamp
 * (bandcamp.ts). Each used to hand-roll its own tokenizer/overlap math;
 * three near-copies drift (issue #85 flagged the hygiene twin; the
 * search-side twins were the same class). One seam, three named pieces:
 *
 *  - artistGate(queryArtist, candidateArtists): the HARD gate — a query
 *    artist ≥ ARTIST_MIN_LEN must appear among the candidate's artists
 *    (exact or substring), else the candidate is a different track and
 *    scores 0 outright. Remixer-safe: "must contain, allow remix" — the
 *    gate checks who PUT the track out (uploader/artist list), never the
 *    title text, so "Artist - Track (Other Guy Remix)" on the remixer's
 *    channel passes while a compilation channel's rip fails.
 *  - artistScore(candidateArtist, queryArtist): 6 = exact, 4 = contains.
 *  - titleOverlap(a, b): shared-token ratio 0..1 over the >2-char
 *    alphanumeric tokens of both strings (order/separator insensitive).
 *
 * Word floors live here: ARTIST_MIN_LEN = 3 ("DJ" matches half a
 * catalog), token floor >2 chars (function words carry no signal).
 */

/** Artist gate floor: shorter strings can't separate one artist from
 *  another ("DJ" matches half the catalog), so below this the artist
 *  component is skipped rather than gating everything out. Shared by the
 *  SC and Beatport scorers (Beatport's BP_ARTIST_MIN_LEN aliases this). */
export const ARTIST_MIN_LEN = 3;

/** First listed artist of a comma/comma-separated query ("A, B & C" →
 *  "a") — catalog searches are keyed on the primary artist. */
export function primaryArtist(artist: string | null | undefined): string {
  return (artist ?? "").split(/[,&]/)[0]?.trim().toLowerCase() ?? "";
}

/** Tokenize a free-text name for overlap scoring: lowercase, fold every
 *  non-alphanumeric to spaces, drop tokens of ≤2 chars. Pure. */
export function nameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/** Shared-token ratio 0..1 between two names (1 = same token set). The
 *  single title-overlap implementation — the dupe hunter's filename
 *  tokenizer and the SC/Beatport/Bandcamp scorers all call this. */
export function titleOverlap(a: string, b: string): number {
  const at = new Set(nameTokens(a));
  const bt = new Set(nameTokens(b));
  if (at.size === 0 || bt.size === 0) return 0;
  let shared = 0;
  for (const w of at) if (bt.has(w)) shared++;
  return shared / Math.max(at.size, bt.size);
}

/** At least one query token appears in the candidate name? The SC
 *  relevance gate (overlap ≥ 1) expressed directly. */
export function hasTitleTokenOverlap(a: string, b: string): boolean {
  const at = nameTokens(a);
  if (at.length === 0) return false;
  const bt = new Set(nameTokens(b));
  return at.some((w) => bt.has(w));
}

/** The HARD artist gate. Returns 0 (drop the candidate entirely) when a
 *  real query artist matches none of the candidate's artist strings;
 *  6 for an exact primary-artist match, 4 for a substring/contained
 *  match. Query artists shorter than ARTIST_MIN_LEN return 0 points but
 *  DON'T fail the gate (they can't separate anything) — callers add
 *  title/duration points on top, exactly as the Beatport scorer did.
 *
 *  `candidates` = every artist string the candidate page/row exposes:
 *  the uploader (SC), the artists+remixers list (Beatport), or the
 *  band name + track-artist credit (Bandcamp). */
export function artistGate(
  queryArtist: string | null | undefined,
  candidates: string[],
): 0 | 4 | 6 {
  const a = primaryArtist(queryArtist);
  if (a.length < ARTIST_MIN_LEN) return 0;
  const hit = candidates
    .map((c) => c.toLowerCase())
    .find((c) => c === a || c.includes(a));
  if (!hit) return 0;
  return hit === a ? 6 : 4;
}

/** True when the gate would fail (a known query artist with no candidate
 *  match) — for callers that want to DROP before scoring rather than
 *  weight a 0. Equivalent to artistGate(...) === 0 && gate applies. */
export function artistGateFails(
  queryArtist: string | null | undefined,
  candidates: string[],
): boolean {
  const a = primaryArtist(queryArtist);
  return a.length >= ARTIST_MIN_LEN && artistGate(a, candidates) === 0;
}

/** THE shared-token name similarity (issue #85): lowercase, strip the
 *  file extension, split on non-alphanumerics, ratio of shared tokens
 *  over the larger set. 1.0 fast-path when both names reduce to the
 *  same token set (separator flips: "ANOTR x 54" vs "ANOTR, 54").
 *  Unicode-hyphen safe (folded by the split). Used by hygiene's
 *  folder-variant check AND fulltags' fingerprint-dedupe — the two
 *  prior implementations tokenized identically (both strip ext; the
 *  issue's behavior-delta premise was stale), so ONE body is safe.
 *  Distinct from nameTokens() above: the search scorer drops ≤2-char
 *  tokens; this similarity must keep every token. Pure — module-level
 *  tokenizer, not re-created per call. */
const similarityTokens = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

export function sharedTokenRatio(a: string, b: string): number {
  const at = new Set(similarityTokens(a));
  const bt = new Set(similarityTokens(b));
  if (at.size === 0 || bt.size === 0) return 0;
  if (at.size === bt.size && [...at].every((t) => bt.has(t))) return 1;
  let shared = 0;
  for (const t of at) if (bt.has(t)) shared++;
  return shared / Math.max(at.size, bt.size);
}
