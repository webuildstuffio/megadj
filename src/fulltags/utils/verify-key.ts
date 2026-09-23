/**
 * verify-key — the roadmap #3 key gauntlet gate, now a fulltags CLI verb
 * (`fulltags verify-key`, #185; formerly the standalone harness
 * fulltags/verify-key.ts that only source-readers could discover).
 *
 * Analyzes up to N tracks with OpenKeyScan and compares against existing
 * key tags in the files (MIK/rekordbox values as reference). Run BEFORE
 * any batch key write; the roadmap requires ≥80% agreement on 20+ tracks.
 *
 * Comparison is Camelot-aware: "9A" vs "A minor" style values normalize
 * through the same class map the analyzer uses; ±1 Camelot neighbor or
 * relative major/minor counts as "near" (listed separately from matches).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { walkAudioDir } from "../../shared/audio-walk";
import { errMessage } from "../../shared/leaf/fmt";
import { analyzeKeys, type KeyResult } from "../analysis/key-analysis";
import { groundTruth } from "../write/readers";

// Note→Camelot maps, extracted from the analyzer's own camelot_output()
// (authoritative — a generic circle-of-fifths table disagrees with it).
// Verified against openkeyscan_analyzer_server.py, 2026-09-05:
//   minor: Ab=1A D#=2A A#=3A F=4A C=5A G=6A D=7A A=8A E=9A B=10A F#=11A C#=12A
//   major: B=1B F#=2B C#=3B Ab=4B D#=5B A#=6B F=7B C=8B G=9B D=10B A=11B E=12B
const NOTE_MINOR: Record<string, string> = {
  "G#": "1A",
  Ab: "1A",
  "D#": "2A",
  Eb: "2A",
  "A#": "3A",
  Bb: "3A",
  F: "4A",
  C: "5A",
  G: "6A",
  D: "7A",
  A: "8A",
  E: "9A",
  B: "10A",
  "F#": "11A",
  Gb: "11A",
  "C#": "12A",
  Db: "12A",
};
const NOTE_MAJOR: Record<string, string> = {
  B: "1B",
  "F#": "2B",
  Gb: "2B",
  "C#": "3B",
  Db: "3B",
  "G#": "4B",
  Ab: "4B",
  "D#": "5B",
  Eb: "5B",
  "A#": "6B",
  Bb: "6B",
  F: "7B",
  C: "8B",
  G: "9B",
  D: "10B",
  A: "11B",
  E: "12B",
};

/** Parse any key-ish string to Camelot ("9A") when possible. */
export function toCamelot(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const m = s.match(/^(\d{1,2})([ABab])$/);
  if (m?.[1] && m[2]) return `${m[1]}${m[2].toUpperCase()}`;
  // Traditional: "E min", "C major", "F#m", "dbmaj" → note name lookup
  const note = s.match(/^([A-G])([#b♯♭]?)/i);
  if (!note?.[1]) return null;
  const acc = (note[2] ?? "").toLowerCase();
  const keyName =
    note[1].toUpperCase() +
    (acc === "#" || acc === "♯" ? "#" : acc === "b" || acc === "♭" ? "b" : "");
  const isMinor = /min|m\b|[^a-z]m$/i.test(s) && !/maj/i.test(s);
  return (isMinor ? NOTE_MINOR : NOTE_MAJOR)[keyName] ?? null;
}

/** Distance on the camelot wheel: 0 same, 1 neighbor/relative, 99 far. */
export function camelotDist(a: string, b: string): number {
  if (a === b) return 0;
  const na = parseInt(a.slice(0, -1), 10);
  const nb = parseInt(b.slice(0, -1), 10);
  const numDist = Math.min(Math.abs(na - nb), 12 - Math.abs(na - nb));
  if (numDist === 0) return 1; // same number different letter = relative
  if (numDist === 1) return 1; // energy-adjacent
  return numDist;
}

/** The gauntlet threshold (roadmap #3): below this, key writes are refused. */
export const VERIFY_KEY_GATE = 0.8;

export interface VerifyKeyArgs {
  targets: string[];
  limit: number;
  refsPath: string | null;
  json: boolean;
  /** Set when argv was malformed — the CLI prints it and exits 2. */
  error: string | null;
}

/** Digits-only boundary check for --limit, then parseInt (never a bare
 *  Number() conversion on unvalidated argv — the boundary-census rule).
 *  Returns the parsed limit, or an error string on bad input. */
function parseLimit(raw: string | undefined): number | string {
  if (raw === undefined || !/^\d+$/u.test(raw) || raw === "0") {
    return `verify-key: --limit must be a positive integer (got "${raw ?? ""}")`;
  }
  return parseInt(raw, 10);
}

/** Parse the verify-key verb's argv (targets + --limit/--refs/--json). */
export function parseVerifyKeyArgs(argv: readonly string[]): VerifyKeyArgs {
  const targets: string[] = [];
  let limit = 20;
  let refsPath: string | null = null;
  let json = false;
  let error: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--json") json = true;
    else if (a === "--limit" || a.startsWith("--limit=")) {
      const raw = a === "--limit" ? argv[++i] : a.slice("--limit=".length);
      const parsed = parseLimit(raw);
      if (typeof parsed === "string") {
        error = parsed;
        break;
      }
      limit = parsed;
    } else if (a === "--refs" || a.startsWith("--refs=")) {
      refsPath =
        a === "--refs" ? (argv[++i] ?? null) : a.slice("--refs=".length);
    } else if (a.startsWith("--")) {
      error = `verify-key: unknown flag "${a}"`;
      break;
    } else targets.push(a);
  }
  return { targets, limit, refsPath, json, error };
}

export interface VerifyKeyRow {
  file: string;
  ref: string | null;
  refCamelot: string | null;
  got: string | null;
  verdict: "match" | "near" | "mismatch";
}

export interface VerifyKeySummary {
  analyzed: number;
  skippedNoRef: number;
  match: number;
  near: number;
  mismatch: number;
  /** Exact-agreement ratio, 3dp — the gate reads this. */
  agreement: number;
  /** True when agreement ≥ VERIFY_KEY_GATE — the roadmap #3 write gate. */
  gatePass: boolean;
  elapsedMs: number;
  rows: VerifyKeyRow[];
}

/** Optional seam over the analyzer (tests inject; production uses the
 *  real OpenKeyScan protocol). Null results mean "no key produced". */
export type KeyAnalyzer = (paths: string[]) => Promise<Map<string, KeyResult>>;

/** Collect candidate files from the target list: named FILEs pass as-is
 *  (the operator pointed at it — the gate verifies what was named), a
 *  DIRECTORY recurses through the audio walker (the #69 SSOT: same ext
 *  set, same dot/junk skipping). Missing paths are skipped. */
function collectTargets(targets: readonly string[]): string[] {
  const files: string[] = [];
  for (const t of targets) {
    if (!existsSync(t)) continue;
    if (statSync(t).isFile()) {
      files.push(t);
      continue;
    }
    files.push(...walkAudioDir(t));
  }
  return files;
}

/** Load the --refs JSON map ({basename: "Ebm"}) — e.g. rekordbox
 *  master.db ScaleName values extracted via pyrekordbox. This is the
 *  real-world path: archive files often carry NO key tags yet (that's
 *  why they're being verified before write), while rekordbox has already
 *  analyzed them. Throws (flag named) on unreadable/malformed input —
 *  a usage error, exit 2. */
function loadExternalRefs(refsPath: string): Record<string, string> {
  if (!existsSync(refsPath))
    throw new Error(`verify-key: --refs file not found: ${refsPath}`);
  try {
    const parsed: unknown = JSON.parse(readFileSync(refsPath, "utf8"));
    const record =
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.values(parsed as Record<string, unknown>).every(
        (v) => typeof v === "string",
      )
        ? (parsed as Record<string, string>)
        : null;
    if (record === null)
      throw new Error("expected a JSON object of {basename: key}");
    return record;
  } catch (error) {
    throw new Error(`verify-key: --refs invalid JSON: ${errMessage(error)}`, {
      cause: error,
    });
  }
}

/** Per-file verdict rows: reference (tag or external map) vs analyzer
 *  output, judged on the camelot wheel (0 = match, 1 = near, else far). */
function compareRows(
  sample: string[],
  refs: Map<string, string | null>,
  keys: Map<string, KeyResult>,
): VerifyKeyRow[] {
  return sample
    .filter((f) => refs.get(f))
    .map((f) => {
      const ref = toCamelot(refs.get(f) ?? null);
      const got = keys.get(f)?.camelot ?? null;
      const dist = ref && got ? camelotDist(ref, got) : 99;
      return {
        file: basename(f),
        ref: refs.get(f) ?? null,
        refCamelot: ref,
        got,
        verdict: dist === 0 ? "match" : dist === 1 ? "near" : "mismatch",
      };
    });
}

/** Run the gauntlet gate over the sampled files. Throws (with the flag
 *  name) on an unreadable/malformed --refs file — a usage error, exit 2. */
export async function runVerifyKey(opts: {
  targets: readonly string[];
  limit: number;
  refsPath: string | null;
  /** Progress/report channel (human mode only; --json prints the summary). */
  log?: (s: string) => void;
  analyze?: KeyAnalyzer;
}): Promise<VerifyKeySummary> {
  const files = collectTargets(opts.targets);
  // Usage errors surface BEFORE the no-files error: a bad --refs path is
  // the operator's explicit input, so it wins over an implicit empty walk.
  // Reference = existing key tags on disk (MIK/rekordbox output), or the
  // external --refs map.
  const externalRefs =
    opts.refsPath === null ? null : loadExternalRefs(opts.refsPath);

  const sample = files.slice(0, opts.limit);
  if (!sample.length) {
    throw new Error(
      "verify-key: no files to verify — pass a folder or audio files",
    );
  }

  const refs = new Map<string, string | null>();
  for (const f of sample) {
    refs.set(f, groundTruth(f).key ?? externalRefs?.[basename(f)] ?? null);
  }

  const t0 = Date.now();
  const analyze = opts.analyze ?? analyzeKeys;
  const keys: Map<string, KeyResult> = refs.size
    ? await analyze(sample.filter((f) => refs.get(f)))
    : new Map<string, KeyResult>();
  const rows = compareRows(sample, refs, keys);
  const match = rows.filter((r) => r.verdict === "match").length;
  const near = rows.filter((r) => r.verdict === "near").length;
  const mismatch = rows.filter((r) => r.verdict === "mismatch").length;
  const analyzed = rows.length;
  const agreement = analyzed ? match / analyzed : 0;
  return {
    analyzed,
    skippedNoRef: sample.length - analyzed,
    match,
    near,
    mismatch,
    agreement: Math.round(agreement * 1000) / 1000,
    gatePass: agreement >= VERIFY_KEY_GATE,
    elapsedMs: Date.now() - t0,
    rows,
  };
}

/** Human-mode report (the --json printer lives in the CLI). */
export function printVerifyKeyReport(
  log: (s: string) => void,
  s: VerifyKeySummary,
): void {
  log(
    `analyzed ${s.analyzed} (skipped ${s.skippedNoRef} without existing key tags)`,
  );
  for (const r of s.rows) {
    const mark = r.verdict === "match" ? "✓" : r.verdict === "near" ? "~" : "✗";
    log(
      ` ${mark} ${r.file.padEnd(40)} ref=${String(r.ref).padEnd(8)} got=${String(r.got).padEnd(4)} (${r.verdict})`,
    );
  }
  const combined = Math.round(
    ((s.match + s.near) / Math.max(s.analyzed, 1)) * 100,
  );
  log(
    `\nagreement: ${s.match}/${s.analyzed} exact + ${s.near} near = ${combined}% combined · gate(≥80% exact): ${s.gatePass ? "PASS" : "FAIL"} · ${s.elapsedMs}ms`,
  );
}
