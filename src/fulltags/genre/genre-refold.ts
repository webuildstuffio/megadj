// genre-refold.ts — the P94 label refold (genre-audit §5b.3 step 1, archived ideas (docs/archive/ideas-2026-09-15.md)
// #94): two halves, one seam.
//
// 1. DATA canonicalization (`refoldLabel`): repair `\uXXXX` escape
//    artifacts, split multi-label strings on `/ , &` into a ranked
//    PRIMARY (established `&`-compounds like "Drum & Bass", "R&B",
//    "Melodic House & Techno", "Hip-Hop & Rap" are protected first), and
//    canonicalize casing/spelling against a small irregular table +
//    title-case fallback. Never invents a label: junk ("Music",
//    "unknown", URL spam) returns null = no proposal, and the umbrella
//    labels are passed through untouched (their refinement is a scoring
//    decision, not a rewrite).
//
// 2. SCORING policy (`scoringFamily`): plain umbrella labels — "EDM",
//    "Dance", "Electronic", "Mainstage EDM" — are PARENTS of
//    house/techno/trance sitting as siblings in GENRE_FAMILY, so every
//    plain-`edm` seed poisons votes toward `edm` and every held-out
//    plain-`edm` row is a forced LOO error (the B1 `dance` bug one level
//    up; Tier-0 measured `edm↔house` = 360/896 disagreements). Umbrella
//    rows therefore ABSTAIN in the vote (they only know the parent) and
//    drop out of the scored population. Genuinely-hard EDM
//    (hard-dance/eurodance/nightcore/big room) and ALL Tier-1 sub-genre
//    labels keep their families unchanged — hardtekk stays; only the
//    scoring family arbitration changes. The collection labels are never
//    rewritten by this file's scoring half (genres come from real
//    sources; the kNN refines the vote, not the column).
//
// Pure — no DB, no IO; genre.ts wires it into `--refold` and `--eval`.

// The shared vocabulary lives in genre-vocab.ts (#187): escape repair,
// umbrella labels, and the family map are owned there — this file keeps
// only the DATA canonicalization + the SCORING arbitration policy.
import {
  familyOf as genreFamily,
  isUmbrellaLabel,
  repairEscapes,
} from "./genre-vocab";

/** Established compound labels containing the `&` separator. Protected
 *  BEFORE splitting so "R&B" does not become "R" + "B". Measured against
 *  the live label census (Sep 15); kept small and finite on purpose. */
const COMPOUNDS: string[] = [
  "r&b",
  "r & b",
  "drum & bass",
  "drum and bass",
  "hip-hop & rap",
  "hip hop & rap",
  "melodic house & techno",
];

/** Casing/spelling irregulars that title-case would get wrong, plus the
 *  measured variant spellings worth collapsing ("hiphop" ×7, "nu disco"
 *  vs "Nu-Disco"). Lowercase key → canonical display label. */
const IRREGULARS: Readonly<Record<string, string>> = {
  edm: "EDM",
  "mainstage edm": "Mainstage EDM",
  "r&b": "R&B",
  "r & b": "R&B",
  hiphop: "Hip-Hop",
  "hip hop": "Hip-Hop",
  "hip-hop": "Hip-Hop",
  "hip-hop & rap": "Hip-Hop & Rap",
  "hip hop & rap": "Hip-Hop & Rap",
  "drum & bass": "Drum & Bass",
  "drum and bass": "Drum & Bass",
  "melodic house & techno": "Melodic House & Techno",
  "nu disco": "Nu-Disco",
  "nu-disco": "Nu-Disco",
  "edm bass": "EDM Bass",
};

const titleWord = (word: string): string =>
  word
    .split("-")
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join("-");

/** Title-case a lowercase label ("deep house" → "Deep House"). The `&`
 *  inside an IRREGULARS hit is already canonical; in title-case fallbacks
 *  ("r&b soul") the `&` glues its neighbours — split it into its own
 *  token, title-case each, and rejoin with the ampersand glued back
 *  ("r&b soul" → "R&B Soul", never "R&b" or "R & B Soul"). */
const titleCase = (label: string): string =>
  label
    .split(/(?=&)|(?<=&)/)
    .map((chunk) =>
      chunk === "&"
        ? "&"
        : chunk
            .split(" ")
            .filter((w) => w.length > 0)
            .map(titleWord)
            .join(" "),
    )
    .join("");

/** URL/junk spam guard: a label that is (or contains) a bare domain is
 *  never canonicalized — it would only launder spam into a display
 *  label. Returns null so the refold proposes NOTHING for it. */
const isUrlJunk = (label: string): boolean =>
  /https?:\/\//.test(label) ||
  /\b[\w-]+\.(com|net|org|io|co|ru|xyz|top)\b/i.test(label);

/** Word-soup guard: sentences (5+ words) are YouTube description residue,
 *  not a genre label — canonicalizing them would manufacture a fake
 *  label like "House Electronic Swedish European Edm Trance". */
const isWordSoup = (label: string): boolean => label.split(" ").length >= 5;

/** Character sanity: a genre token is letters/digits/spaces plus the
 *  ampersand/hyphen/apostrophe separators. Anything else (trailing
 *  backslashes, brackets, punctuation soup) is corrupted metadata —
 *  title-casing it would just launder the corruption. */
const isSaneLabel = (label: string): boolean =>
  /^[a-z0-9][a-z0-9 &'-]*$/.test(label.toLowerCase());

export interface RefoldOutcome {
  /** Canonical primary label, or null when the refold proposes nothing
   *  (junk/empty input — never a deletion of an existing label). */
  label: string | null;
  /** A `\uXXXX` escape artifact was repaired. */
  escaped: boolean;
  /** A multi-label string was split and a primary picked. */
  split: boolean;
  /** Casing/spelling canonicalization changed the token. */
  aliased: boolean;
}

/** Full data-half pipeline on one RAW stored label. Idempotent:
 *  refoldDetail(refoldLabel(x).label) reports no changes. */
export function refoldDetail(genre: string): RefoldOutcome {
  const trimmed = genre.trim();
  if (
    !trimmed ||
    trimmed.toLowerCase() === "music" ||
    trimmed.toLowerCase() === "unknown" ||
    trimmed.toLowerCase() === "fixme"
  )
    return { label: null, escaped: false, split: false, aliased: false };

  const escaped = /\\u[0-9a-fA-F]{4}/.test(trimmed);
  // URL junk dies on the WHOLE string before splitting: "https://x.com"
  // splits into "https:" + domain, and the scheme alone would survive.
  if (isUrlJunk(trimmed))
    return { label: null, escaped, split: false, aliased: false };
  // parenthetical qualifiers are stripped BEFORE splitting so
  // "Techno (Peak Time / Driving)" stays ONE token (its slash is inside
  // parens); matches normalizeGenre's paren-stripping semantics.
  const repaired = repairEscapes(trimmed).replace(/\(.*?\)/g, "");
  const lower = repaired.toLowerCase();

  // protect established &-compounds with sentinel placeholders (a token
  // boundary impossible inside a genre label: word-char + digit + word-char)
  const stash: string[] = [];
  const SENTINEL = "zzrefoldzz";
  const protectedStr = COMPOUNDS.reduce((acc, compound) => {
    const needle = compound.replace(/ /g, "\\s*");
    return acc.replace(new RegExp(needle, "gi"), (match: string) => {
      stash.push(match);
      return `${SENTINEL}${stash.length - 1}${SENTINEL}`;
    });
  }, lower);

  const tokens = protectedStr
    .split(/[/,&]/)
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0)
    return { label: null, escaped, split: false, aliased: false };

  // Rank multi-label tokens: the SPECIFIC label outranks a bare parent
  // (archived ideas #94 (docs/archive/ideas-2026-09-15.md): "Electronic/House" must refold to House, not stay the
  // umbrella Electronic). A token is "umbrella" when its canonical form
  // is a parent-only label; among the rest, order is the stored rank.
  const isUmbrella = (token: string): boolean => {
    const canonicalToken = IRREGULARS[token];
    return isUmbrellaLabel(
      canonicalToken === undefined ? token : canonicalToken.toLowerCase(),
    );
  };
  const ranked = [...tokens].toSorted((a, b) => {
    const au = isUmbrella(a) ? 1 : 0;
    const bu = isUmbrella(b) ? 1 : 0;
    return au - bu; // stable sort keeps stored order within each class
  });
  const split = tokens.length > 1;

  // restore stashed compounds, then canonicalize
  const primary = ranked[0]!
    .replace(
      new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, "g"),
      (_m: string, i: string) => stash[Number(i)] ?? "",
    )
    .trim();
  // A proposal must be sane AND musically meaningful: "Edits" (from
  // "Edits / Bootlegs") is a junk-metadata token with no genre family —
  // rewriting it would trade one junk label for a shorter one.
  if (
    !primary ||
    isUrlJunk(primary) ||
    isWordSoup(primary) ||
    !isSaneLabel(primary) ||
    genreFamily(primary) === null
  )
    return { label: null, escaped, split, aliased: false };

  const canonical = IRREGULARS[primary] ?? titleCase(primary);
  return {
    label: canonical,
    escaped,
    split,
    aliased: canonical !== primary,
  };
}

/** Convenience wrapper — just the canonical label. */
export function refoldLabel(genre: string): string | null {
  return refoldDetail(genre).label;
}

/** The SCORING family map (genre-audit §5b.3 step 1, the "only the
 *  scoring family arbitration changes" clause). Umbrella rows abstain
 *  (null): they cannot vote (a parent label carries no child-family
 *  evidence) and cannot be scored (any child-family vote would count as
 *  a forced disagreement). Everything else falls through to the pinned
 *  `genreFamily` unchanged — including junk rows (URL spam, word soup):
 *  normalizeGenre never scored those as usable seeds either, so
 *  abstention and scoring agree on what is simply unusable. */
export function scoringFamily(genre: string): string | null {
  const label = refoldLabel(genre);
  if (label === null) return genreFamily(genre);
  if (isUmbrellaLabel(label)) return null;
  return genreFamily(genre);
}
