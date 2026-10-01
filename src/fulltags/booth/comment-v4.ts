/**
 * comment-v4.ts — Booth Metadata v4 comment builder + parser.
 *
 * Format: `E8 IN:32 OUT:16 VOX Drop Dark · MelTechno`
 *
 * Rules:
 * - Energy E1–E9 (library-relative percentile, always present)
 * - IN:/OUT: mix window bars (present when phrase data exists)
 * - VOX/HOOK vocal clash (present when vocal analysis exists)
 * - Drop/Roll structure (present when structure analysis exists)
 * - Hard/Soft genre-relative aggression (within-family top/bottom 20%)
 * - Dark/Euph genre-relative happiness (within-family top/bottom 20%)
 * - VAR variable tempo warning (when beat grid is non-constant)
 * - Subgenre after `·` (when confident)
 * - Separator: space between tokens, `·` before subgenre
 * - All characters fleet-safe (ASCII + `·`, no emoji/symbols)
 */

/** Valid mix-window bar counts — always round DOWN. */
export const MIX_WINDOW_STEPS = [0, 8, 16, 32, 64] as const;
export type MixWindowBars = (typeof MIX_WINDOW_STEPS)[number];

/** Round a raw bar count DOWN to the nearest valid step.
 *  Always round down so the number is a guaranteed minimum. */
export function roundBarsDown(bars: number): MixWindowBars {
  if (bars >= 64) return 64;
  if (bars >= 32) return 32;
  if (bars >= 16) return 16;
  if (bars >= 8) return 8;
  return 0;
}

/** Compute the library-relative energy band (E1–E9).
 *  Tracks are ranked by energy score, then cut into 9 equal groups.
 *  The input is the track's percentile rank (0–1) within the library. */
export function energyBand(percentile: number): number {
  const band = Math.ceil(percentile * 9);
  return Math.max(1, Math.min(9, band));
}

/** Compute energy band from a track's energy score and all library scores.
 *  Returns E1–E9. */
export function energyBandFromScores(
  trackEnergy: number,
  allEnergies: readonly number[],
): number {
  if (allEnergies.length === 0) return 5;
  const sorted = [...allEnergies].toSorted((a, b) => a - b);
  let rank = 0;
  for (const e of sorted) {
    if (e <= trackEnergy) rank++;
    else break;
  }
  return energyBand(rank / sorted.length);
}

/** Within-family percentile for a mood dimension.
 *  Returns 0–1 percentile rank within the genre family.
 *  Families under 300 tracks fall back to the full allValues. */
export function familyPercentile(
  value: number,
  familyValues: readonly number[],
  allValues: readonly number[],
): number {
  const pool = familyValues.length >= 300 ? familyValues : allValues;
  if (pool.length === 0) return 0.5;
  const sorted = [...pool].toSorted((a, b) => a - b);
  let rank = 0;
  for (const v of sorted) {
    if (v <= value) rank++;
    else break;
  }
  return rank / sorted.length;
}

/** Subgenre confidence gate: emit only when top score ≥ 0.5
 *  and lead over runner-up ≥ 0.15. */
export function passesSubgenreGate(
  topScore: number,
  runnerUpScore: number,
): boolean {
  return topScore >= 0.5 && topScore - runnerUpScore >= 0.15;
}

/** The subgenre abbreviation map. One word each, max 12 chars. */
export const SUBGENRE_ABBREV: ReadonlyMap<string, string> = new Map([
  ["tech house", "TechHouse"],
  ["deep house", "DeepHouse"],
  ["afro house", "AfroHouse"],
  ["progressive house", "ProgHouse"],
  ["melodic house", "MelHouse"],
  ["organic house", "OrgHouse"],
  ["bass house", "BassHouse"],
  ["future house", "FutHouse"],
  ["melodic techno", "MelTechno"],
  ["peak-time techno", "PeakTechno"],
  ["hard techno", "HardTechno"],
  ["minimal", "Minimal"],
  ["minimal deep tech", "Minimal"],
  ["deep tech", "Minimal"],
  ["big room", "BigRoom"],
  ["drum & bass", "DnB"],
  ["drum and bass", "DnB"],
  ["psytrance", "Psy"],
  ["hip-hop", "HipHop"],
  ["hip hop", "HipHop"],
  ["uk garage", "UKG"],
  ["trance", "Trance"],
  ["dubstep", "Dubstep"],
  ["trap", "Trap"],
  ["techhouse", "TechHouse"],
  ["melodic house & techno", "MelHouse"],
  ["melodic house and techno", "MelHouse"],
  ["electro", "Electro"],
  ["electronica", "Electronica"],
  ["indie dance", "IndieDance"],
  ["nu disco", "NuDisco"],
  ["disco", "Disco"],
  ["amapiano", "Amapiano"],
  ["jersey club", "JerseyClub"],
  ["breakbeat", "Breakbeat"],
  ["downtempo", "Downtempo"],
  ["ambient", "Ambient"],
  ["r&b", "RnB"],
  ["edm/bass", "EDMBass"],
  ["hip-hop & rap", "HipHop"],
  ["hip-hop&rap", "HipHop"],
  ["alternative rock", "AltRock"],
  ["contemporary r&b", "RnB"],
  ["soulful house", "SoulHouse"],
]);

/** Abbreviate a subgenre label. Returns the abbreviated token.
 *  Strips slashes, apostrophes, and whitespace from unrecognized genres
 *  to keep the comment fleet-safe (ASCII + `·` only). */
export function abbreviateSubgenre(subgenre: string): string {
  const lower = subgenre.toLowerCase().trim();
  return SUBGENRE_ABBREV.get(lower) ?? subgenre.replace(/[\s/']+/g, "");
}

export interface CommentV4Input {
  /** Energy band E1–E9. Null = not computed. */
  readonly energy: number | null;
  /** Intro mix window in bars. Null = no phrase data. */
  readonly introBars: MixWindowBars | null;
  /** Outro mix window in bars. Null = no phrase data. */
  readonly outroBars: MixWindowBars | null;
  /** Vocal clash in mix zones. */
  readonly vox: boolean;
  /** Vocals in body only (clean mix zones). */
  readonly hook: boolean;
  /** Build-and-drop structure. */
  readonly drop: boolean;
  /** Rolling groove structure. */
  readonly roll: boolean;
  /** Aggressive for its genre (top 20%). */
  readonly hard: boolean;
  /** Gentle for its genre (bottom 20%). */
  readonly soft: boolean;
  /** Dark for its genre (bottom 20% happy). */
  readonly dark: boolean;
  /** Euphoric for its genre (top 20% happy). */
  readonly euph: boolean;
  /** Variable tempo warning. */
  readonly varTempo: boolean;
  /** Subgenre abbreviation (already passed confidence gate). Null = omit. */
  readonly subgenre: string | null;
}

/** Build the v4 comment string.
 *
 *  `E8 IN:32 OUT:16 VOX Drop Dark · MelTechno` */
export function buildCommentV4(input: CommentV4Input): string {
  const parts: string[] = [];

  if (input.energy !== null && Number.isFinite(input.energy)) {
    parts.push(`E${Math.max(1, Math.min(9, Math.round(input.energy)))}`);
  }

  if (input.introBars !== null && input.outroBars !== null) {
    parts.push(`IN:${input.introBars} OUT:${input.outroBars}`);
  }

  if (input.vox) parts.push("VOX");
  else if (input.hook) parts.push("HOOK");

  if (input.drop) parts.push("Drop");
  else if (input.roll) parts.push("Roll");

  if (input.hard) parts.push("Hard");
  else if (input.soft) parts.push("Soft");

  if (input.dark) parts.push("Dark");
  else if (input.euph) parts.push("Euph");

  if (input.varTempo) parts.push("VAR");

  if (input.subgenre !== null && input.subgenre.length > 0) {
    return `${parts.join(" ")} · ${input.subgenre}`;
  }

  return parts.join(" ");
}

const MOOD_TOKENS = new Set(["Hard", "Soft", "Dark", "Euph"]);
const STRUCTURE_TOKENS = new Set(["Drop", "Roll"]);
const VOCAL_TOKENS = new Set(["VOX", "HOOK"]);

/** Parse a v4 comment string back into components. */
export function parseCommentV4(comment: string): {
  energy: number | null;
  introBars: number | null;
  outroBars: number | null;
  vox: boolean;
  hook: boolean;
  drop: boolean;
  roll: boolean;
  hard: boolean;
  soft: boolean;
  dark: boolean;
  euph: boolean;
  varTempo: boolean;
  subgenre: string | null;
} {
  let subgenre: string | null = null;
  let main = comment;

  const dotIdx = comment.indexOf(" · ");
  if (dotIdx !== -1) {
    subgenre = comment.slice(dotIdx + 3).trim() || null;
    main = comment.slice(0, dotIdx);
  }

  const tokens = main.split(" ").filter((t) => t.length > 0);
  let energy: number | null = null;
  let introBars: number | null = null;
  let outroBars: number | null = null;
  let vox = false;
  let hook = false;
  let drop = false;
  let roll = false;
  let hard = false;
  let soft = false;
  let dark = false;
  let euph = false;
  let varTempo = false;

  for (const tok of tokens) {
    if (/^E[1-9]$/i.test(tok)) {
      const eVal = Number(tok.slice(1));
      energy = Number.isFinite(eVal) ? eVal : null;
    } else if (/^IN:\d+$/.test(tok)) {
      const iVal = Number(tok.slice(3));
      introBars = Number.isFinite(iVal) ? iVal : null;
    } else if (/^OUT:\d+$/.test(tok)) {
      const oVal = Number(tok.slice(4));
      outroBars = Number.isFinite(oVal) ? oVal : null;
    } else if (VOCAL_TOKENS.has(tok)) {
      vox = tok === "VOX";
      hook = tok === "HOOK";
    } else if (STRUCTURE_TOKENS.has(tok)) {
      drop = tok === "Drop";
      roll = tok === "Roll";
    } else if (MOOD_TOKENS.has(tok)) {
      if (tok === "Hard") hard = true;
      if (tok === "Soft") soft = true;
      if (tok === "Dark") dark = true;
      if (tok === "Euph") euph = true;
    } else if (tok === "VAR") {
      varTempo = true;
    }
  }

  return {
    energy,
    introBars,
    outroBars,
    vox,
    hook,
    drop,
    roll,
    hard,
    soft,
    dark,
    euph,
    varTempo,
    subgenre,
  };
}
