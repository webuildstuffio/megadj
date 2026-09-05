/**
 * FullTags schema — the single source of truth for what a "fully tagged"
 * audio file means, plus the genre vocabulary every source normalizes into.
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
  /** Source URL — provenance, shows in the comment field. */
  comment: string | null;
  bpm: number | null;
  /** Harmonic key (Initial Key / Camelot) — roadmap P1, not yet auto-filled. */
  key: string | null;
  /** DJ energy 1–10 from integrated RMS loudness. */
  energy: number | null;
  /** MusicBrainz recording MBID — metadata provenance. */
  mbid: string | null;
  /** Embedded front cover present. */
  art: boolean;
}

/** The fields the archive completeness gate requires (megadj audit parity). */
export const COMPLETENESS_FIELDS = [
  "art",
  "title",
  "artist",
  "album",
  "genre",
  "year",
] as const satisfies ReadonlyArray<keyof FullTag>;

/** Which required fields are missing from a tag record. */
export function completeness(tag: Partial<FullTag>): {
  complete: boolean;
  missing: string[];
} {
  const missing = COMPLETENESS_FIELDS.filter((f) => !tag[f]);
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

/** A partial write: only these fields are merged into the file. */
export interface TagPatch {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  genre?: string;
  /** Release year of this version (integer, 1900–2100). */
  year?: number;
  composer?: string;
  grouping?: string;
  remixer?: string;
  comment?: string;
  mbid?: string;
  /** Written where the container supports it (mp3/flac + mutagen paths). */
  bpm?: number;
  /** DJ energy 1–10, written as TXXX:ENERGY where supported. */
  energy?: number;
}

/** Genre → folder name safe for filesystems ("R&B / Soul" → "R&B Soul"). */
export function sanitizeGenreFolder(genre: string): string {
  return genre
    .replace(/\s*\/\s*/g, " ")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Word-bounded patterns only — substring matches put "Soulji Remix" in
// R&B and "Sunset" in House.
const GENRE_MAP: Array<[RegExp, string]> = [
  [/\b(?:hip.?hop|rap|trap|drill)\b/i, "Hip-Hop"],
  [/\b(?:r&b|soul|neo.?soul)\b/i, "R&B / Soul"],
  [/\b(?:deep house|tech house|afro house|house|house music)\b/i, "House"],
  [/\b(?:techno|trance|hardstyle|psytrance)\b/i, "Techno / Trance"],
  [
    /\b(?:edm|electro|dubstep|bass|dnb|drum.?and.?bass|drum.?n.?bass)\b/i,
    "EDM / Bass",
  ],
  [/\b(?:lofi|lo.?fi|chill|downtempo|ambient)\b/i, "Chill / Lo-Fi"],
  [/\b(?:reggae|dancehall|afrobeat|afro beats?)\b/i, "Reggae / Afro"],
  [/\b(?:rock|metal|punk|indie rock)\b/i, "Rock"],
  [/\b(?:jazz|blues|soul jazz)\b/i, "Jazz / Blues"],
  [/\b(?:country|folk|americana)\b/i, "Country / Folk"],
  [/\b(?:classical|orchestra|symphony|piano solo)\b/i, "Classical"],
  [/\bpop\b/i, "Pop"],
];

/** Infer a canonical genre from free text (titles, channel names, MB tags). */
export function inferGenre(
  inputs: Array<string | null | undefined>,
): string | null {
  const blob = inputs.filter(Boolean).join(" ").toLowerCase();
  if (!blob) return null;
  // Channel "- Topic" uploads and explicit genre tags carry the most signal.
  for (const [pattern, genre] of GENRE_MAP) {
    if (pattern.test(blob)) return genre;
  }
  return null;
}

/** SoundCloud genre label → canonical megadj genre. */
export const SC_GENRE_CANON: Record<string, string> = {
  "hip-hop & rap": "Hip-Hop",
  "hip hop": "Hip-Hop",
  rap: "Hip-Hop",
  "dance & edm": "EDM",
  dance: "EDM",
  electronic: "EDM",
  edm: "EDM",
  house: "House",
  "deep house": "Deep House",
  "tech house": "Tech House",
  "bass house": "Bass House",
  "progressive house": "Progressive House",
  techno: "Techno",
  "techno trance": "Trance",
  trance: "Trance",
  "drum & bass": "Drum & Bass",
  dnb: "Drum & Bass",
  "r&b": "R&B",
  "r&b / soul": "R&B",
  "r&b soul": "R&B",
  soul: "R&B",
  rock: "Rock",
  alternative: "Rock",
  pop: "Pop",
};

export function canonGenre(g: string): string {
  const key = g.replace(/^#/, "").toLowerCase().trim();
  return SC_GENRE_CANON[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/** The closed genre vocabulary offered to the AI classifier (sources/ai). */
export const DJ_GENRES =
  "House, Tech House, Deep House, Progressive House, Afro House, Bass House, Techno, Trance, Drum & Bass, Dubstep, Trap, Future Bass, Garage, Hip-Hop, Pop, R&B, Soul, Funk, Disco, Nu-Disco, Rock, Edits / Bootlegs, Ambient, World";
