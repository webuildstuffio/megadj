/**
 * audio-exts.ts — THE audio-extension sets (issue #69).
 *
 * Seven hand-rolled extension sets/regexes walked the same audio with
 * diverging memberships, and the drift was LIVE: shelf-sync copies
 * ogg/opus onto the shelf while every scanner's set skipped them, so an
 * ogg/opus intake was invisible to hygiene, dedupe, and dupescan
 * forever (never reported, never deduplicated, never quarantined).
 *
 * The rule (#69 acceptance): either every walker sees an extension or
 * none — the sets below are the single decision point. Shelf-sync's
 * copy set (COPIED_AUDIO_RE) defines what the shelf can contain; the
 * scanner set (AUDIO_EXTS) is derived from the same membership list so
 * copy and scan can never disagree again.
 *
 * Membership (Sep 15): the six fulltags-core formats + ogg/opus (live
 * on shelves via shelf-sync) + aac/alac (raw ADTS/ALAC rips reach
 * archive intake; rb-fix-paths indexed them since Aug). Order is
 * irrelevant — these are Sets, not precedence lists (qualityRank owns
 * ranking).
 */

/** The authoritative membership list — edit HERE only. */
const AUDIO_EXT_LIST = [
  ".m4a",
  ".mp3",
  ".wav",
  ".flac",
  ".aiff",
  ".aif",
  ".ogg",
  ".opus",
  ".aac",
  ".alac",
] as const;

/** The scanner set: every audio extension any megadj pass recognizes. */
export const AUDIO_EXTS: ReadonlySet<string> = new Set(AUDIO_EXT_LIST);

/** Same membership as one case-insensitive regex, for the callers whose
 *  walker tests filenames (shelf-sync). Derived from the list, never
 *  hand-copied, so the two forms cannot drift. */
export const AUDIO_EXTS_RE = new RegExp(
  `(?:${AUDIO_EXT_LIST.map((e) => e.slice(1)).join("|")})$`,
  "i",
);

/** Extension of a path/basename, lowercase ("" when none). The one
 *  `lastIndexOf('.')` idiom every walker used to roll inline. */
export function audioExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** Is this filename/path audio the scanners must see? */
export function isAudioFile(name: string): boolean {
  return AUDIO_EXTS.has(audioExt(name));
}
