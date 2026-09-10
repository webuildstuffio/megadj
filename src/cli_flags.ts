// cli_flags.ts — Bun's util.parseArgs is broken (strict:true rejects known
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
  return raw ? Number(raw) || undefined : undefined;
}

/** Non-negative numeric option with a hard error (`--limit 5`). Returns
 * undefined when absent — AND undefined when present but invalid (after
 * printing the error + exitCode 2), so callers can break out instead of
 * letting NaN flow through as "unlimited" (NaN is falsy: it would skip
 * every slice/stop guard downstream). The beats/mood/cues case blocks
 * each hand-rolled this check 3× inline. */
export function nonNegOpt(
  flags: ParsedFlags,
  key: string,
  cmd: string,
): number | undefined {
  const raw = flags.strings.get(key);
  if (raw === undefined) return undefined;
  // Strict raw check BEFORE Number(): Number("") is 0 and Number(" 5 ") is
  // 5, but an empty/whitespace-only value is a typo, not a number — and
  // NaN/Infinity must never slip through as a limit either.
  const trimmed = raw.trim();
  if (trimmed === "" || !/^\d+$/.test(trimmed)) {
    console.error(
      `${cmd}: --${key} must be a non-negative number (got "${raw}")`,
    );
    process.exitCode = 2;
    return undefined;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    console.error(
      `${cmd}: --${key} must be a non-negative number (got "${raw}")`,
    );
    process.exitCode = 2;
    return undefined;
  }
  return n;
}

/** First positional argument (skips flags and the command word itself). */
export function firstPositional(
  args: string[],
  cmd: string,
): string | undefined {
  return args.find((a) => !a.startsWith("--") && a !== cmd);
}
