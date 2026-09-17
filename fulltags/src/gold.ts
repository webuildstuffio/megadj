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
import { errMessage as errorText } from "../../cratedeck/shared/fmt";

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
/** All entries are integers ≥ min and strictly increasing. */
function strictlyIncreasingInts(xs: number[]): boolean {
  for (let i = 1; i < xs.length; i++) {
    if (xs[i]! <= xs[i - 1]!) return false;
  }
  return true;
}

/** `[string, number]` field: finite number ≥ min. Null when ok. */
function finiteMinError(
  a: Record<string, unknown>,
  k: string,
  min: number,
): string | null {
  const n = a[k];
  if (typeof n !== "number" || !Number.isFinite(n) || n < min)
    return `${k} must be a finite number ≥ ${min}`;
  return null;
}

/** An array field with a per-entry numeric gate and strict monotonicity:
 *  every entry passes `ok`, strictly increasing. `max` caps the length.
 *  Null when ok, the field's error message otherwise. */
function intArrayError(
  xs: unknown,
  opts: {
    min: number;
    max?: number;
    field: string;
    shape: string;
    /** Per-entry gate — phraseBars wants integers ≥ 1; hotCuesMs only
     *  finite ≥ 0 (original contract: ms times need not be whole). */
    ok: (v: unknown) => v is number;
  },
): string | null {
  if (!Array.isArray(xs)) return opts.shape;
  if (opts.max !== undefined && xs.length > opts.max) return opts.shape;
  const nums = xs.filter(opts.ok);
  if (nums.length !== xs.length) return opts.shape;
  if (!strictlyIncreasingInts(nums))
    return `${opts.field} must be strictly increasing`;
  return null;
}

const isIntegerAtLeast =
  (min: number) =>
  (v: unknown): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= min;
const isFiniteAtLeast =
  (min: number) =>
  (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= min;

/** Object header fields: hash/version/branch. Null when ok. */
function headerError(a: Record<string, unknown>): string | null {
  if (typeof a.hash !== "string" || !/^[0-9a-f]{64}$/u.test(a.hash))
    return "hash must be a 64-char blake2b256 hex string";
  if (a.version !== GOLD_SCHEMA_VERSION)
    return `version must be ${GOLD_SCHEMA_VERSION} (got ${JSON.stringify(a.version)})`;
  if (typeof a.branch !== "string" || !BRANCHES.has(a.branch))
    return `branch must be one of house|trap|unknown (got ${JSON.stringify(a.branch)})`;
  return null;
}

export function goldSchemaError(v: unknown): string | null {
  if (typeof v !== "object" || v === null)
    return "annotation must be a JSON object";
  const a = v as Record<string, unknown>;
  const header = headerError(a);
  if (header) return header;
  const numericErr =
    finiteMinError(a, "firstDownbeatMs", 0) ?? finiteMinError(a, "bpm", 1);
  if (numericErr) return numericErr;
  if (typeof a.bpm !== "number" || a.bpm > 400) return "bpm must be ≤ 400";
  const barsErr = intArrayError(a.phraseBars, {
    min: 1,
    field: "phraseBars",
    shape: "phraseBars must be an array of 1-based bar integers ≥ 1",
    ok: isIntegerAtLeast(1),
  });
  if (barsErr) return barsErr;
  const cuesErr = intArrayError(a.hotCuesMs, {
    min: 0,
    max: 8,
    field: "hotCuesMs",
    shape: "hotCuesMs must be an array of ≤ 8 finite times (ms) ≥ 0",
    ok: isFiniteAtLeast(0),
  });
  if (cuesErr) return cuesErr;
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
    throw new TypeError(`${file}: not valid JSON (${errorText(e)})`, {
      cause: e,
    });
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
        error: errorText(e),
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
