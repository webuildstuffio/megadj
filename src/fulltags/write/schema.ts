/**
 * FullTags schema — the single source of truth for what a "fully tagged"
 * audio file means. The genre vocabulary lives in genre-vocab.ts (#187);
 * this module owns the tag record, its completeness gate, and folder
 * sanitization.
 *
 * A file is COMPLETE when it has all of: embedded art, title, artist, album,
 * a real genre (not "Music"), and a year. Everything else in FullTag is
 * filled opportunistically (provenance, remix credit, energy, BPM…).
 */

/** The complete tag record. `year` is the year of THIS file's version — for
 * edits/remixes that is the remix year, never the original's. */
export interface FullTag {
  title: string | null;
  artist: string | null;
  albumArtist: string | null;
  album: string | null;
  genre: string | null;
  year: string | null;
  /** Remix credit ("Flozone Flip") — version/remix tag, shown by rekordbox. */
  remixer: string | null;
  /** Style/scene grouping (rekordbox reads grouping) for library filters. */
  grouping: string | null;
  /** Producer credits (parsed from descriptions / MusicBrainz relations). */
  composer: string | null;
  /** Record label — TPUB, read by rekordbox (roadmap #3 schema bonus). */
  label: string | null;
  /** Mix name ("Club Mix", "Radio Edit") — TIT3, read by rekordbox. */
  mixName: string | null;
  /** Source URL — provenance, shows in the comment field. */
  comment: string | null;
  bpm: number | null;
  /** Harmonic key — Camelot ("9A") or traditional ("E min"); TKEY on
   * AIFF/MP3 (WAV has no key field), filled by the key stage. */
  key: string | null;
  /** DJ energy 1–10 from integrated RMS loudness. */
  energy: number | null;
  /** MusicBrainz recording MBID — metadata provenance. */
  mbid: string | null;
  /** ISRC — the store-grade recording identity (Beatport rows carry it;
   * written as TSRC on ID3, freeform ----:com.apple.iTunes:ISRC on m4a). */
  isrc: string | null;
  /** Chromaprint fingerprint — content identity for dupes/upgrade
   * verification (TXXX:ACOUSTID). */
  fingerprint: string | null;
  /** Model-derived mood/dance profile, "k=v; k=v" stamped as TXXX:MOOD —
   * danceability, 4 mood heads, valence+arousal (roadmap #4). */
  mood: string | null;
  /** Embedded front cover present. */
  art: boolean;
}

/** The fields the archive completeness gate requires (megadj audit parity).
 * mood + energy joined rev 6.1 pass 2: both are real stamp fields written
 * by the analysis stages, the audit is the completeness gate, so a file
 * missing them IS a gap. */
/** Spec: the audit-gate required fields (mood + energy joined rev 6.1
 * pass 2: both are real stamp fields written by the analysis stages, the
 * audit is the completeness gate, so a file missing them IS a gap). */
const COMPLETENESS_FIELDS = [
  "art",
  "title",
  "artist",
  "album",
  "genre",
  "year",
  "mood",
  "energy",
] as const satisfies readonly (keyof FullTag)[];

/** Which required fields are missing from a tag record. The genre dim
 * carries the placeholder guard (issue #61/#97): a literal `Music` value
 * is the intake placeholder, not a genre — it counts as missing so the
 * gate never blesses legacy junk. THE completeness gate: `fulltags audit`
 * and megadj's `auditArchive` both derive their dim lists from here, so
 * a dim added to COMPLETENESS_FIELDS lights up in both gates at once. */
export function completeness(tag: Partial<FullTag>): {
  complete: boolean;
  missing: string[];
} {
  const missing = COMPLETENESS_FIELDS.filter((f) => {
    const v = tag[f];
    if (f === "genre")
      return v === undefined || v === null || v === false || v === "Music";
    return v === undefined || v === null || v === false;
  });
  return { complete: missing.length === 0, missing };
}

/**
 * LEGACY (megadj ingest/sync compat) tag shape. Kept byte-compatible with
 * the old `src/metadata.ts` interface: uses `date` instead of `year`.
 * New code should use FullTag / TagPatch; applyTags still accepts this.
 */
export interface EnrichedMetadata {
  title: string | null;
  artist: string | null;
  albumArtist: string | null;
  album: string | null;
  genre: string | null;
  date: string | null;
  composer: string | null;
  comment: string | null;
  bpm: number | null;
  remixer?: string | null;
  grouping?: string | null;
  mbid?: string | null;
}

/** A partial write: only these fields are merged into the file.
 *  Every optional is `| undefined` (exactOptionalPropertyTypes): callers
 *  build patches from nullable source records with `?? undefined`, which
 *  must be assignable. */
export interface TagPatch {
  title?: string | undefined;
  artist?: string | undefined;
  albumArtist?: string | undefined;
  album?: string | undefined;
  genre?: string | undefined;
  /** Release year of this version (integer, 1900–2100). */
  year?: number | undefined;
  composer?: string | undefined;
  grouping?: string | undefined;
  remixer?: string | undefined;
  /** Record label (TPUB). */
  label?: string | undefined;
  /** Mix name (TIT3). */
  mixName?: string | undefined;
  comment?: string | undefined;
  mbid?: string | undefined;
  /** ISRC (TSRC on ID3, freeform ISRC atom on m4a, TXXX:ISRC elsewhere). */
  isrc?: string | undefined;
  /** Written where the container supports it (mp3/flac + mutagen paths). */
  bpm?: number | undefined;
  /** Harmonic key — Camelot or traditional; TKEY/TXXX:CAMELOT. */
  key?: string | undefined;
  /** Camelot mirror of `key` — TXXX:CAMELOT, container-independent. */
  camelot?: string | undefined;
  /** DJ energy 1–10, written as TXXX:ENERGY where supported. */
  energy?: number | undefined;
  /** Chromaprint fingerprint, written as TXXX:ACOUSTID. */
  fingerprint?: string | undefined;
  /** AI provenance stamp: "value|confidence" → TXXX:AI-GENRE (trust in
   * automation: an AI-filled field is always identifiable). */
  aiGenre?: string | undefined;
  /** AI provenance stamp: "value|confidence" → TXXX:AI-YEAR. */
  aiYear?: string | undefined;
  /** Model mood/dance stamp, "k=v; …" → TXXX:MOOD (roadmap #4). */
  mood?: string | undefined;
  /** Beatport provenance stamp, "label=X; mix=Y; …" → TXXX:BP-FIELDS —
   * every Beatport-filled field is recorded here, never silently blended. */
  beatport?: string | undefined;
}

/** Genre → folder name safe for filesystems ("R&B / Soul" → "R&B Soul").
 *  Junk guard: a genre that is pure digits (unix timestamps baked into
 *  scraped tags) or the placeholder "Music" is not a genre — callers use
 *  it as a folder name and you get 278 one-file timestamp folders
 *  (Sep 11). Maps those (and null — no mint anywhere, #61) to
 *  "Unknown Genre" so organize keeps ONE bucket until fetch fills a real
 *  genre. */
export function sanitizeGenreFolder(genre: string | null): string {
  const cleaned = (genre ?? "")
    .replace(/\s*\/\s*/g, " ")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || /^\d+$/.test(cleaned) || /^music$/i.test(cleaned))
    return "Unknown Genre";
  return cleaned;
}

/** The genre vocabulary moved to genre-vocab.ts (#187 — one module owns
 *  every named genre map). The `canonGenre`/`SC_GENRE_CANON` re-exports
 *  below are a package-internal convenience for beatport.ts (whose #181
 *  refactor landed importing from here); the bridge exports the
 *  canonical names. No new external consumers. */
export {
  canonicalizeClaim as canonGenre,
  SC_GENRE_CANON,
} from "../genre/genre-vocab";
