import { finishCommandErrorSync } from "./shared/cli-output";

// cli-flags.ts — Bun's util.parseArgs is broken (strict:true rejects known
// options, strict:false coerces string values to true), so the CLI parses
// manually. Split from cli.ts at the complexity guard; the semantics are
// load-bearing (numeric-options.test.ts pins nonNegOpt's contract).
/** Bun's util.parseArgs is broken (strict:true rejects known options,
 *  strict:false coerces string values to true), so parse manually. */
export interface ParsedFlags {
  strings: Map<string, string>;
  bools: Set<string>;
}

export function parseFlags(
  args: string[],
  stringOpts: string[],
  boolOpts: string[],
): ParsedFlags {
  const strings = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === "--") break;
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq > 0) {
      const key = arg.slice(2, eq);
      const val = arg.slice(eq + 1);
      if (boolOpts.includes(key)) {
        if (val !== "true" && val !== "false") continue;
        if (val === "true") bools.add(key);
        else bools.delete(key);
      } else {
        strings.set(key, val);
      }
      continue;
    }
    const key = arg.slice(2);
    if (boolOpts.includes(key)) {
      bools.add(key);
    } else if (stringOpts.includes(key)) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        strings.set(key, next);
        i++;
      }
    }
  }
  return { strings, bools };
}

/** Numeric string option: `numOpt(flags, "jobs")` → number | undefined. */
export function numOpt(flags: ParsedFlags, key: string): number | undefined {
  const raw = flags.strings.get(key);
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n !== 0 ? n : undefined;
}

/** Non-negative numeric option with a hard error (`--limit 5`). Returns
 * undefined when absent — AND undefined when present but invalid (after
 * emitting the error via the json-safe epilogue + exitCode 2), so callers
 * can break out instead of letting NaN flow through as "unlimited" (NaN
 * is falsy: it would skip every slice/stop guard downstream). The
 * beats/mood/cues case blocks each hand-rolled this check 3× inline.
 * `json` routes the error: json mode → {command,error} on stdout; human
 * → stderr (#160 ring 3 — the emit was stdout-blind before). */
export function nonNegOpt(
  flags: ParsedFlags,
  key: string,
  cmd: string,
  json = false,
): number | undefined {
  const raw = flags.strings.get(key);
  if (raw === undefined) return undefined;
  // Strict raw check BEFORE Number(): Number("") is 0 and Number(" 5 ") is
  // 5, but an empty/whitespace-only value is a typo, not a number — and
  // NaN/Infinity must never slip through as a limit either.
  const trimmed = raw.trim();
  if (trimmed === "" || !/^\d+$/.test(trimmed)) {
    finishCommandErrorSync({
      command: cmd,
      json,
      error: `--${key} must be a non-negative number (got "${raw}")`,
      exitCode: 2,
    });
    return undefined;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    finishCommandErrorSync({
      command: cmd,
      json,
      error: `--${key} must be a non-negative number (got "${raw}")`,
      exitCode: 2,
    });
    return undefined;
  }
  return n;
}

/** The invalid-raw signal, shared with callers that must distinguish
 *  "flag absent" (keep going with defaults) from "flag present but bad"
 *  (loud exit 2, zero work). One seam so the guard pair
 *  `if (v === undefined && flags.strings.get(k) !== undefined) return;`
 *  — repeated at every numeric-flag call site — has one home. `json`
 *  forwards into the epilogue so --json runs keep a clean stdout. */
export function nonNegOptInvalid(
  flags: ParsedFlags,
  key: string,
  cmd = "",
  json = false,
): boolean {
  return (
    flags.strings.has(key) && nonNegOpt(flags, key, cmd, json) === undefined
  );
}
/** First positional argument (skips flags and the command word itself). */
export function firstPositional(
  args: string[],
  cmd: string,
): string | undefined {
  return args.find((a) => !a.startsWith("--") && a !== cmd);
}
