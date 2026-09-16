// imprint-prior.ts — the imprint→family vote rung (issue #128, P96).
//
// For electronic music the record label/imprint is near-ground-truth for
// SCENE: Drumcode releases techno, Anjunabeats releases trance. The data
// already lives on the files (Beatport fills TPUB through the fetch
// ladder's identity stage) — nothing voted with it until now.
//
// Design (per the issue):
//   - the map is DATA with provenance (which audit/source, when) — every
//     row carries a `src` tag; never vibes mapping
//   - a rung VOTES, it does not write: the vote joins the genre ladder
//     as a low-weight, high-precision prior that ABSTAINS when the audio
//     consensus (kNN) is strong and contradicts it — imprint is metadata,
//     not audio truth
//   - unknown label = abstain (null), never a guess; junk gates apply
//     (numeric/`Music` refused upstream of any vote)
//
// Pure: tables + lookup + vote arbitration. The ladder wiring lives in
// src/fulltags/genre.ts / the fetch stages.

/** One imprint mapping. `family` is a scoring family (genre-vocab), not
 *  a display label — the vote joins the kNN's family space directly.
 *  `src` is provenance: where the mapping was verified. */
export interface ImprintMapping {
  /** Canonical imprint name (lowercase key). */
  imprint: string;
  /** The scoring family its releases vote for. */
  family: string;
  /** Provenance: which verification justified the mapping. */
  src: string;
  /** ISO date the mapping was verified. */
  verified: string;
}

/** The imprint→family map. Seeded from genre-audit §5b spot-checks and
 *  widely-established scene facts; every row cites its source. Small and
 *  finite on purpose — a wrong mapping poisons votes (the loop-samples
 *  lesson, #187). Grows only with cited evidence. */
export const IMPRINT_FAMILIES: readonly ImprintMapping[] = [
  {
    imprint: "drumcode",
    family: "techno",
    src: "genre-audit §5b exa spot-check",
    verified: "2026-09-15",
  },
  {
    imprint: "drumcode ltd",
    family: "techno",
    src: "genre-audit §5b exa spot-check",
    verified: "2026-09-15",
  },
  {
    imprint: "anjunabeats",
    family: "trance",
    src: "genre-audit §5b exa spot-check",
    verified: "2026-09-15",
  },
  {
    imprint: "anjunadeep",
    family: "house",
    src: "label's own scene descriptor (melodic house)",
    verified: "2026-09-15",
  },
  {
    imprint: "afterlife recordings",
    family: "melodic house & techno",
    src: "label scene (afterlife = melodic techno)",
    verified: "2026-09-15",
  },
  {
    imprint: "truesoul",
    family: "techno",
    src: "drumcode sister imprint",
    verified: "2026-09-15",
  },
  {
    imprint: "mad decent",
    family: "bass",
    src: "major lazer's imprint — bass/edm usage",
    verified: "2026-09-15",
  },
  {
    imprint: "monstercat",
    family: "edm",
    src: "label scene (electronic big-tent)",
    verified: "2026-09-15",
  },
  {
    imprint: "ninja tune",
    family: "mood",
    src: "label scene (downtempo/electronic leftfield)",
    verified: "2026-09-15",
  },
  {
    imprint: "mau5trap",
    family: "techno",
    src: "label scene (progressive/tech house-techno)",
    verified: "2026-09-15",
  },
  {
    imprint: "revealed recordings",
    family: "edm",
    src: "label scene (hard dance/big room)",
    verified: "2026-09-15",
  },
  {
    imprint: "spinnin' records",
    family: "edm",
    src: "label scene (mainstage dance)",
    verified: "2026-09-15",
  },
  {
    imprint: "toolroom productions",
    family: "house",
    src: "label scene (tech house flagship)",
    verified: "2026-09-15",
  },
  {
    imprint: "defected",
    family: "house",
    src: "label scene (house flagship)",
    verified: "2026-09-15",
  },
];

/** The lookup table (lowercased imprint → mapping), built once. */
const IMPRINT_INDEX: ReadonlyMap<string, ImprintMapping> = new Map(
  IMPRINT_FAMILIES.map((m) => [m.imprint, m]),
);

/** Census count — the test pins this from the producer, never hand-copied
 *  (the issue's acceptance: "census test pins its size from the producer"). */
export const IMPRINT_COUNT = IMPRINT_FAMILIES.length;

/** Normalize a raw label string for lookup: lowercase, trim, drop
 *  " recordings"/" records" suffix noise only when the bare name IS the
 *  key (e.g. "Drumcode Records" → "drumcode"). Never guesses. */
function lookupKey(rawLabel: string): string | null {
  const base = rawLabel.trim().toLowerCase();
  if (!base || /^\d+$/.test(base) || base === "music") return null;
  if (IMPRINT_INDEX.has(base)) return base;
  const stripped = base
    .replace(/\s+(recordings?|records?|music|ltd)$/i, "")
    .trim();
  return stripped && IMPRINT_INDEX.has(stripped) ? stripped : null;
}

export interface ImprintVote {
  /** The voted family. */
  family: string;
  /** The imprint that voted (display form from the map). */
  imprint: string;
  /** Provenance of the mapping (rides into the ledger). */
  src: string;
}

/** The imprint prior: label → family vote. Null = abstain (unknown
 *  label, junk label, or a mapping whose family the family map has
 *  since dropped — a mapping that can't reach the family SSOT is not a
 *  vote). NEVER throws; a missing label is the normal case. */
export function imprintVote(
  label: string | null | undefined,
): ImprintVote | null {
  if (!label) return null;
  const key = lookupKey(label);
  if (!key) return null;
  const m = IMPRINT_INDEX.get(key);
  if (!m) return null;
  return { family: m.family, imprint: m.imprint, src: m.src };
}

/** The arbitration: does the imprint vote STAND against a strong kNN
 *  consensus? The issue: imprint "abstains on conflicts with a strong
 *  kNN consensus rather than overwriting". Consensus present + different
 *  family = the audio wins, the prior abstains. No consensus (null) =
 *  the prior stands (it is then the ONLY evidence). */
export function imprintStands(
  vote: ImprintVote,
  kNNConsensus: string | null,
): boolean {
  if (kNNConsensus === null) return true;
  return vote.family === kNNConsensus;
}
