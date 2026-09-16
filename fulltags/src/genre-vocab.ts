/**
 * Genre vocabulary — ONE module owning every named genre map (#187).
 * The SSOT the fetch ladder, the embedding kNN (src/archive/similar.ts),
 * and the refold arbitration (src/fulltags/genre-refold.ts) read:
 *   repairEscapes          — shared `\uXXXX` ingestion-artifact repair
 *   SC_GENRE_CANON         — SC/MB/BP claim labels → canonical display
 *   canonicalizeClaim      — the claim canonicalization verb
 *   GENRE_MAP + guessFromFreeText — download-time free-text regex guess
 *   FAMILIES + familyOf    — label → one of 9 kNN vote families; junk
 *                            categories ("loop samples", "dj tools")
 *                            map to NO family (JUNK_CLAIMS)
 *   UMBRELLA_LABELS + isUmbrellaLabel — parent-only labels that abstain
 *                            from scoring (policy lives in genre-refold)
 *   AI_VOCAB               — closed AI classifier label set
 * `inferGenre` is the kNN inference in src/archive/similar.ts — the
 * free-text regex guess is `guessFromFreeText`, never the same name.
 * Pure — no DB, no IO, no tag writes.
 */

/** Escape-artifact repair: the ingestion layer measured `\uXXXX` soup in
 *  the live column (19+ rows, e.g. `Hip-hop \u0026 rap`). One shared
 *  implementation — normalizeGenre and the refold both run it. */
export function repairEscapes(genre: string): string {
  return genre.replace(/\\u([0-9a-fA-F]{4})/g, (_m: string, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

// ---------- claim canonicalization (SC / MB / BP labels) ----------

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

/** Canonicalize a source claim (SC genre, MB folksonomy tag, BP store
 *  genre): strip hashtag prefixes, collapse the canon map, title-case
 *  unknown labels. */
export function canonicalizeClaim(g: string): string {
  const key = g.replace(/^#/, "").toLowerCase().trim();
  return SC_GENRE_CANON[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

// ---------- free-text guessing (download-time) ----------

// Word-bounded patterns only — substring matches put "Soulji Remix" in
// R&B and "Sunset" in House.
const GENRE_MAP: [RegExp, string][] = [
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

/** Guess a coarse genre from free text (titles, channel names, MB tags).
 *  NOT the kNN inference — that is `inferGenre` in src/archive/similar.ts. */
export function guessFromFreeText(
  inputs: (string | null | undefined)[],
): string | null {
  const blob = inputs.filter(Boolean).join(" ").toLowerCase();
  if (!blob) return null;
  // Channel "- Topic" uploads and explicit genre tags carry the most signal.
  for (const [pattern, genre] of GENRE_MAP) {
    if (pattern.test(blob)) return genre;
  }
  return null;
}

// ---------- family mapping (the embedding kNN vote buckets) ----------

/** Normalize a raw genre string into a comparable label: lowercase, first
 * comma-separated token, strip parenthetical. "Music"/"unknown"/"fixme"
 * and empty are unusable seeds (the genre column has "Music" ×99 — a
 * YouTube-tier label that must not vote). Repairs `\uXXXX` escape
 * artifacts before matching. */
export function normalizeGenre(genre: string): string | null {
  const base = repairEscapes(genre)
    .toLowerCase()
    .split(",")[0]
    ?.trim()
    .replace(/\(.*?\)/g, "")
    .trim();
  if (!base || base === "music" || base === "unknown" || base === "fixme")
    return null;
  return base;
}

/** Store/category labels that are INTENTIONALLY unmapped (the junk
 *  criterion, genre-pipeline §5b): product categories, not genres —
 *  they abstain (null), never seed a family. The `loop samples → edm`
 *  mis-map lived in the family table until #187; the cross-map test
 *  enforces this gate from now on. */
const JUNK_CLAIMS = /\bloop samples\b|\bdj tools\b/;

/** Genre FAMILIES — the vote buckets. Raw ID3 labels fragment ("house" /
 * "deep house" / "progressive house" = three never-agreeing buckets), so
 * each normalized label collapses to the family that matches what the
 * embedding space actually clusters. Null = too niche/off-genre to vote.
 * Order matters: "bass house" / "bassline" are bass-music usage, so the
 * bass family is checked BEFORE house. The final mapping is mutually
 * exclusive by construction (tested).
 *
 * 2026-09-14 additions are audit-driven (genre-audit §7): labels found
 * unmapped on the live library, each verified against the Discogs-400
 * head's audio placement — grime/jersey club/donk cluster with bass
 * music; minimal/deep-tech/hard-tekk are techno families; eurodance/
 * nightcore sit in EDM; IDM/chillwave/synthwave in mood; country in pop.
 * Junk-URL labels (djsoundtop.com) are explicitly unusable. The
 * `loop samples|dj tools → edm` row is GONE (#187) — those live in
 * JUNK_CLAIMS and abstain, per the junk criterion they contradicted. */
export const FAMILIES: readonly (readonly [RegExp, string])[] = [
  [
    /drum ?and ?bass|jungle|breakbeat|breaks|bass|dubstep|footwork|juke|grime|jersey club|donk|wall slappers/,
    "bass",
  ],
  [/(?<!bass |afro )house|disco|garage|boogie/, "house"],
  [/techno|melodic|minimal(?! \/)|deep tech|hardtekk|softtekk|tekk/, "techno"],
  [/trance|psy(?![a-z])/, "trance"],
  [/hip ?[- ]?hop|rap|trap/, "hiphop"],
  [
    /edm|electro|big ?room|future (?!bass)|hardstyle|bounce|eurodance|euro ?dance|nightcore|uptempo|hard dance|hardcore/,
    "edm",
  ],
  [
    /pop|rock|indie|alternative|punk|metal|folk|singer|country|top 40|chanson/,
    "pop",
  ],
  [
    /r ?& ?b|soul|funk|amapiano|afrobeat|afro ?house|reggaeton|latin|dancehall|reggae/,
    "groove",
  ],
  [
    /jazz|blues|ambient|downtempo|lofi|lo ?fi|classical|soundtrack|idm|chillwave|synthwave|world|spoken word|tutorial/,
    "mood",
  ],
  [/\bgroove\b/, "groove"],
  [/\bdance\b|mainstream club/, "edm"],
];

/** Normalized genre → vote family. Null when no family claims it, or
 *  when the label is a junk category (JUNK_CLAIMS — those abstain,
 *  never vote). */
export function familyOf(genre: string): string | null {
  const base = normalizeGenre(genre);
  if (!base || JUNK_CLAIMS.test(base)) return null;
  for (const [re, fam] of FAMILIES) if (re.test(base)) return fam;
  return null;
}

// ---------- umbrella abstention vocabulary ----------

/** Labels that name a PARENT genre only: real vocabulary (the refold
 *  keeps them in the column) with no child-family evidence — the
 *  scoring arbitration abstains them from vote and LOO population. */
export const UMBRELLA_LABELS: ReadonlySet<string> = new Set([
  "edm",
  "dance",
  "electronic",
  "mainstage edm",
]);

/** True when the (already canonical) label names a parent genre only. */
export function isUmbrellaLabel(canonical: string): boolean {
  return UMBRELLA_LABELS.has(canonical.toLowerCase());
}

// ---------- AI classifier vocabulary ----------

/** The closed genre vocabulary offered to the AI classifier (sources/ai). */
export const AI_VOCAB =
  "House, Tech House, Deep House, Progressive House, Afro House, Bass House, Techno, Trance, Drum & Bass, Dubstep, Trap, Future Bass, Garage, Hip-Hop, Pop, R&B, Soul, Funk, Disco, Nu-Disco, Rock, Edits / Bootlegs, Ambient, World";
