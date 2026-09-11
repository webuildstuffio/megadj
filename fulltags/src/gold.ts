/**
 * gold.ts — the GA-00 gold-standard set (plan Part 0): a versioned JSON
 * file per annotated track, stored NEXT TO the audio (never in the repo —
 * the library is personal), keyed by the archive's blake2b content hash
 * so a re-encode or rename never orphans an annotation.
 *
 * One annotation = one truth row: first downbeat (ms), BPM, every 32-bar
 * phrase boundary (bar numbers, 1-based), the eight preferred hot-cue
 * positions (ms) — the plan captures the user's preferences, not a
 * textbook's — plus a genre branch for the house/trap variants.
 *
 * Pure module: schema guards + loader + dev/holdout split. No I/O except
 * reading the annotation dir. `megadj gold-report` (GA-00b) scores the
 * ledgers against this; measurement discipline (dev vs holdout) lives in
 * the split, not in the scorer.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Current annotation schema version. Bump on breaking shape changes. */
export const GOLD_SCHEMA_VERSION = 1;

/** The genre branch an annotation was made under (plan S3/AC-03). */
export type GoldBranch = "house" | "trap" | "unknown";

/**
 * One gold annotation. Field-level guards live in `parseGoldAnnotation`
 * — corrupt JSON must be a visible failure naming the file, never a
 * silent skip (AGENTS.md catch rule).
 */
export interface GoldAnnotation {
  /** blake2b256 hex of the audio content (the archive sweep's hash). */
  hash: string;
  /** Schema version — loader rejects newer, warns+skips older-with-diffs. */
  version: number;
  branch: GoldBranch;
  /** True first downbeat, milliseconds. */
  firstDownbeatMs: number;
  /** True BPM as the user counts it (double-time convention for trap). */
  bpm: number;
  /** Every 32-bar phrase boundary, 1-based bar numbers. */
  phraseBars: number[];
  /** Where the user would put each of the eight hot cues, ms. */
  hotCuesMs: number[];
  /** Optional free-text note (subgenre, awkwardness flags). */
  note?: string;
}

/** Loader failure detail: which file, why. Surfaced by the reporter. */
export interface GoldLoadIssue {
  file: string;
  error: string;
}

export interface GoldSet {
  /** Valid annotations, sorted by hash for stable reporting. */
  annotations: GoldAnnotation[];
  /** Files that exist but failed validation — visible, never swallowed. */
  issues: GoldLoadIssue[];
  /** Where the set was loaded from. */
  dir: string;
}

/**
 * Default location: `~/Music/DJ-Imports/_gold/` next to the archive —
 * same MEGADJ_MUSIC_DIR the archive sweep walks (the underscore keeps it
 * out of every artist-folder scan). Override with MEGADJ_GOLD_DIR.
 */
export function goldDir(musicDir: string): string {
  return process.env.MEGADJ_GOLD_DIR ?? join(musicDir, "_gold");
}

const BRANCHES: ReadonlySet<string> = new Set(["house", "trap", "unknown"]);

/**
 * Validate one parsed JSON value against the GA-00 schema. Returns the
 * error message (null = valid) — pure, so tests hit every rule.
 */
export function goldSchemaError(v: unknown): string | null {
  if (typeof v !== "object" || v === null)
    return "annotation must be a JSON object";
  const a = v as Record<string, unknown>;
  if (typeof a.hash !== "string" || !/^[0-9a-f]{64}$/u.test(a.hash))
    return "hash must be a 64-char blake2b256 hex string";
  if (a.version !== GOLD_SCHEMA_VERSION)
    return `version must be ${GOLD_SCHEMA_VERSION} (got ${JSON.stringify(a.version)})`;
  if (typeof a.branch !== "string" || !BRANCHES.has(a.branch))
    return `branch must be one of house|trap|unknown (got ${JSON.stringify(a.branch)})`;
  for (const [k, min] of [
    ["firstDownbeatMs", 0],
    ["bpm", 1],
  ] as const) {
    const n = a[k];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min)
      return `${k} must be a finite number ≥ ${min}`;
  }
  if (typeof a.bpm !== "number" || a.bpm > 400) return "bpm must be ≤ 400";
  if (!Array.isArray(a.phraseBars))
    return "phraseBars must be an array of 1-based bar integers ≥ 1";
  const bars: unknown[] = a.phraseBars;
  const bnums = bars.filter(
    (b): b is number => typeof b === "number" && Number.isInteger(b) && b >= 1,
  );
  if (bnums.length !== bars.length)
    return "phraseBars must be an array of 1-based bar integers ≥ 1";
  for (let i = 1; i < bnums.length; i++) {
    if (bnums[i]! <= bnums[i - 1]!)
      return "phraseBars must be strictly increasing";
  }
  if (!Array.isArray(a.hotCuesMs))
    return "hotCuesMs must be an array of ≤ 8 finite times (ms) ≥ 0";
  if (a.hotCuesMs.length > 8)
    return "hotCuesMs must be an array of ≤ 8 finite times (ms) ≥ 0";
  const cues: unknown[] = a.hotCuesMs;
  const cnums = cues.filter(
    (t): t is number => typeof t === "number" && Number.isFinite(t) && t >= 0,
  );
  if (cnums.length !== cues.length)
    return "hotCuesMs must be an array of ≤ 8 finite times (ms) ≥ 0";
  for (let i = 1; i < cnums.length; i++) {
    if (cnums[i]! <= cnums[i - 1]!)
      return "hotCuesMs must be strictly increasing";
  }
  if (a.note !== undefined && typeof a.note !== "string")
    return "note must be a string when present";
  return null;
}

/**
 * Parse + validate one annotation file's contents. Throws TypeError with
 * a precise message on bad input (the schema-guards pattern).
 */
export function parseGoldAnnotation(raw: string, file: string): GoldAnnotation {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch (e) {
    throw new TypeError(
      `${file}: not valid JSON (${e instanceof Error ? e.message : String(e)})`,
      { cause: e },
    );
  }
  const err = goldSchemaError(v);
  if (err) throw new TypeError(`${file}: ${err}`);
  const a = v as GoldAnnotation;
  return a;
}

/**
 * Load every `*.json` annotation in the dir. Files that fail validation
 * land in `issues` (reported by name + reason) — the load never fakes
 * success over corrupt input, and never crashes on one bad file.
 */
export function loadGoldSet(dir: string): GoldSet {
  const out: GoldSet = { annotations: [], issues: [], dir };
  if (!existsSync(dir)) return out;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .toSorted();
  for (const f of files) {
    const path = join(dir, f);
    try {
      out.annotations.push(parseGoldAnnotation(readFileSync(path, "utf8"), f));
    } catch (e) {
      out.issues.push({
        file: f,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  out.annotations.sort((x, y) => (x.hash < y.hash ? -1 : 1));
  return out;
}

export interface GoldSplit {
  dev: GoldAnnotation[];
  holdout: GoldAnnotation[];
}

/**
 * The measurement-discipline split (plan §0.3): deterministic, content-
 * keyed (hash order), 2/3 dev / 1/3 holdout — the same hash always lands
 * on the same side, so re-running the report never reshuffles the holdout.
 */
export function splitGoldSet(set: GoldSet): GoldSplit {
  // Sorts by hash ITSELF: a caller can never reshape the dev/holdout
  // split by passing unsorted input; the same hash always lands on the
  // same side (measurement discipline, plan §0.3).
  const sorted = [...set.annotations].toSorted((x, y) =>
    x.hash < y.hash ? -1 : 1,
  );
  const n = sorted.length;
  const devCount = Math.round((n * 2) / 3);
  return {
    dev: sorted.slice(0, devCount),
    holdout: sorted.slice(devCount),
  };
}

// ---------- GA-00b metric math (pure — the scorer consumes these) ----------

/** One track's scored metrics (plan §0.2 table). Null = not scoreable on
 * that axis (e.g. no ledger grid) — tracked as a miss, not skipped. */
export interface GoldTrackScore {
  hash: string;
  branch: GoldBranch;
  /** Anchor accuracy input: |predicted − truth| first downbeat, ms. Null
   * when either side has no grid. */
  anchorDeltaMs: number | null;
  /** BPM accuracy inputs: abs delta and the ratio (ratio errors counted
   * separately from the 0.05 window — an octave lock is not "0.05 off"). */
  bpmDelta: number | null;
  bpmRatio: number | null;
  /** Phrase alignment: fraction of truth boundaries with a predicted
   * boundary within 1 bar. Null when either side has none. */
  phraseAligned: number | null;
  /** Cue acceptance: fraction of the user's hot cues matched by a
   * predicted cue within 50 ms. Null when the user marked none. */
  cueAccepted: number | null;
}

/** Which fraction of phrase boundaries count as "within 1 bar" — the
 * plan's phrase-alignment window. */
export const PHRASE_WINDOW_BARS = 1;

/** Hot-cue acceptance window (ms) — "you'd accept it unchanged" at 15 ms
 * grid tolerance plus quantize slop; the plan B8 gate uses the same 15. */
export const CUE_ACCEPT_MS = 50;

/**
 * Score one track: predicted (ledger grid + BPM, phrase bars, cue times)
 * vs the annotation. All inputs seconds except noted ms fields; pure.
 *
 * `predFirstDownbeatS` null = no grid → anchor misses; `predPhraseBars`
 * empty → phrase alignment null (tracked as missing, not zero — a track
 * we never analyzed says nothing about phrase math).
 */
export function scoreGoldTrack(
  gold: GoldAnnotation,
  pred: {
    firstDownbeatS: number | null;
    bpm: number | null;
    phraseBars: number[];
    cueTimesMs: number[];
  },
): GoldTrackScore {
  const anchorDeltaMs =
    pred.firstDownbeatS === null
      ? null
      : Math.round((pred.firstDownbeatS * 1000 - gold.firstDownbeatMs) * 10) /
        10;
  const bpmDelta =
    pred.bpm === null ? null : Math.round((pred.bpm - gold.bpm) * 100) / 100;
  const bpmRatio =
    pred.bpm === null || !(gold.bpm > 0)
      ? null
      : Math.round((pred.bpm / gold.bpm) * 1000) / 1000;

  // Phrase alignment: nearest-predicted-within-window per truth bar.
  let phraseAligned: number | null = null;
  if (gold.phraseBars.length > 0 && pred.phraseBars.length > 0) {
    let hit = 0;
    for (const bar of gold.phraseBars) {
      const win = PHRASE_WINDOW_BARS;
      if (pred.phraseBars.some((p) => Math.abs(p - bar) <= win)) hit++;
    }
    phraseAligned = Math.round((hit / gold.phraseBars.length) * 1000) / 1000;
  }

  // Cue acceptance: nearest-predicted-within-window per user cue.
  let cueAccepted: number | null = null;
  if (gold.hotCuesMs.length > 0) {
    let hit = 0;
    for (const t of gold.hotCuesMs) {
      if (pred.cueTimesMs.some((p) => Math.abs(p - t) <= CUE_ACCEPT_MS)) hit++;
    }
    cueAccepted = Math.round((hit / gold.hotCuesMs.length) * 1000) / 1000;
  }

  return {
    hash: gold.hash,
    branch: gold.branch,
    anchorDeltaMs,
    bpmDelta,
    bpmRatio,
    phraseAligned,
    cueAccepted,
  };
}

/** The report table (plan §0.2): each metric over one split, plus the
 * counts needed to interpret them (n, scored, octave-locked). */
export interface GoldMetrics {
  tracks: number;
  /** % with |anchor| ≤ 10 ms (scored tracks only; misses shown by n). */
  anchorPct: number | null;
  anchorScored: number;
  /** % with |ΔBPM| ≤ 0.05. */
  bpmPct: number | null;
  bpmScored: number;
  /** % with ratio 1.98–2.02 or 0.495–0.505 — the octave-lock census. */
  octaveOff: number;
  /** % phrase boundaries within 1 bar (mean of per-track fractions). */
  phrasePct: number | null;
  phraseScored: number;
  /** % user hot cues matched within 50 ms. */
  cuePct: number | null;
  cueScored: number;
}

const ANCHOR_TOLERANCE_MS = 10;
const BPM_TOLERANCE = 0.05;

/** Percentage with 1 decimal (null when the denominator is 0). Pure —
 *  module-level, not re-created per `aggregateScores` call. */
const pct = (hit: number, n: number): number | null =>
  n === 0 ? null : Math.round((hit / n) * 1000) / 10;

/** Aggregate per-track scores into the §0.2 metrics row. Pure. */
export function aggregateScores(scores: GoldTrackScore[]): GoldMetrics {
  const anchor = scores.filter((s) => s.anchorDeltaMs !== null);
  const bpm = scores.filter((s) => s.bpmDelta !== null);
  const phrase = scores.filter((s) => s.phraseAligned !== null);
  const cue = scores.filter((s) => s.cueAccepted !== null);
  return {
    tracks: scores.length,
    anchorPct: pct(
      anchor.filter(
        (s) => Math.abs(s.anchorDeltaMs ?? 1e9) <= ANCHOR_TOLERANCE_MS,
      ).length,
      anchor.length,
    ),
    anchorScored: anchor.length,
    bpmPct: pct(
      bpm.filter((s) => Math.abs(s.bpmDelta ?? 1e9) <= BPM_TOLERANCE).length,
      bpm.length,
    ),
    bpmScored: bpm.length,
    octaveOff: bpm.filter(
      (s) =>
        s.bpmRatio !== null &&
        (Math.abs(s.bpmRatio - 2) < 0.06 || Math.abs(s.bpmRatio - 0.5) < 0.03),
    ).length,
    phrasePct: pct(
      phrase.filter((s) => (s.phraseAligned ?? 0) >= 0.85).length,
      phrase.length,
    ),
    phraseScored: phrase.length,
    cuePct: pct(
      cue.filter((s) => (s.cueAccepted ?? 0) >= 0.8).length,
      cue.length,
    ),
    cueScored: cue.length,
  };
}
