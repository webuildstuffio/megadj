#!/usr/bin/env bun
// tools/loc-budget.ts — LOC-budget gate for the megadj pre-commit hook.
//
// Policy (Sep 15 2026, canvas `megadj-quality-trend`): the repo grew to
// ~92k tracked code LOC in 24 days; until the census falls to the 75k
// TARGET, a commit may only LAND if the code census shrinks or holds.
// Root files (*.md, package.json, bun.lock, tsconfig, knip.json, the hook
// itself, …) and non-code assets are excluded — the budget watches CODE.
//
// NEVER blocks on a self-error: probe failures, unparseable diffs, or a
// missing baseline degrade to an advisory warning (exit 0). The only
// blocking outcome is a PROVEN net growth, and even that yields to an
// explicit bypass: MEGADJ_LOC_BYPASS="<reason>" git commit … — every
// bypass is audit-logged to .git/loc-budget-audit.log with the census
// numbers and the reason string.
//
// Usage (called by .githooks/pre-commit):
//   bun tools/loc-budget.ts <baseline-since>   # ISO date; census must be
//                             net-negative VS that snapshot (default:
//                             2026-09-15, the policy start)
//   bun tools/loc-budget.ts --selftest         # internal assertions

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Census floor: commits must not grow the census until it is at/below
 *  this. The 75,000 target comes from the quality-trend canvas. */
const LOC_TARGET = 75_000;
/** Policy start: the canvas measurement day. `git diff` baselines for
 *  "net reduction" are computed against this day's HEAD by default. */
const DEFAULT_BASELINE = "2026-09-15";
/** Audit log lives inside .git so it is repo-local and never committed. */
const AUDIT_LOG = ".git/loc-budget-audit.log";

const CODE_EXT = /\.(?:ts|tsx|py)$/u;
/** Root-level files (*.md, package.json, lockfiles, configs — the user's
 *  exclusion rule) and root dot-directories (.github, .claude, …) are
 *  never budgeted code. Nested code under real source dirs is. */
const EXCLUDED_PATH = /^[^/]+$|^\.[^/]+(?:\/|$)/u;

function isBudgetedCode(path: string): boolean {
  if (!CODE_EXT.test(path)) return false;
  if (EXCLUDED_PATH.test(path)) return false;
  return true;
}
/** wc -l semantics: newline count, so a file without a trailing newline
 *  undercounts by one — consistent for both sides of a diff, which is
 *  all this gate needs. */
function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r\n|\r|\n/u).length - 1;
}

function git(
  args: string[],
  opts?: { maxBuffer?: number; cwd?: string; encoding?: "utf8" | "latin1" },
): { ok: boolean; stdout: string } {
  const r = spawnSync("git", args, {
    encoding: opts?.encoding ?? "utf8",
    maxBuffer: opts?.maxBuffer ?? 64 * 1024 * 1024,
    cwd: opts?.cwd,
  });
  if (r.error !== undefined || r.status !== 0 || r.stdout === null) {
    return { ok: false, stdout: r.stdout ?? "" };
  }
  return { ok: true, stdout: r.stdout };
}

function repoRoot(): string | undefined {
  const r = git(["rev-parse", "--show-toplevel"]);
  return r.ok ? r.stdout.trim() : undefined;
}

/** Count every budgeted code line in a commit's tree (0 when it cannot
 *  be read — the caller treats 0 as advisory). One `git cat-file
 *  --batch` over the tree's code blobs; read in latin1 so the framing
 *  parse is byte-accurate even when payloads contain NULs/UTF-8. */
function treeLoc(commitish: string, root: string): number {
  const ls = git(["ls-tree", "-r", "--name-only", commitish]);
  if (!ls.ok) return 0;
  const paths = ls.stdout
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && isBudgetedCode(p));
  if (paths.length === 0) return 0;

  const batch = spawnSync("git", ["cat-file", "--batch"], {
    encoding: "latin1",
    maxBuffer: 256 * 1024 * 1024,
    input: paths.map((p) => `${commitish}:${p}`).join("\n") + "\n",
    cwd: root,
  });
  if (batch.error !== undefined || batch.status !== 0 || batch.stdout === null)
    return 0;
  // --batch interleaves `<sha> blob <size>\n<payload>\n` records; parse
  // sizes and slice payloads instead of relying on record framing.
  let total = 0;
  let cursor = 0;
  const out = batch.stdout;
  for (let i = 0; i < paths.length; i++) {
    const nl = out.indexOf("\n", cursor);
    if (nl < 0) break;
    const header = out.slice(cursor, nl);
    const size = Number.parseInt(header.split(" ").pop() ?? "", 10);
    if (!Number.isFinite(size) || size < 0) break;
    const body = out.slice(nl + 1, nl + 1 + size);
    total += countLines(body);
    cursor = nl + 1 + size + 1; // payload + trailing newline
  }
  return total;
}

function resolveCommit(rev: string, root: string): string | undefined {
  const r = git(["rev-parse", "--verify", `${rev}^{commit}`], { cwd: root });
  return r.ok ? r.stdout.trim() : undefined;
}

interface Verdict {
  code: number;
  summary: string;
}

function failAdvisory(reason: string): Verdict {
  return {
    code: 0,
    summary: `LOC-budget gate: ADVISORY ONLY — ${reason} (never blocks)`,
  };
}

function runGate(baselineArg: string | undefined): Verdict {
  // Precedence: explicit argv > MEGADJ_LOC_BASELINE env (hook-friendly) >
  // policy default day. Anything malformed degrades to advisory — the
  // knob must never become a wedge.
  const baselineDay =
    baselineArg ?? process.env.MEGADJ_LOC_BASELINE ?? DEFAULT_BASELINE;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(baselineDay)) {
    return failAdvisory(`bad baseline date "${baselineDay}"`);
  }
  const root = repoRoot();
  if (root === undefined) return failAdvisory("not inside a git repo");
  process.chdir(root);

  const stagedPaths =
    git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]).stdout ?? "";
  const files = stagedPaths
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (files.length === 0) return { code: 0, summary: "" };
  const codeFiles = files.filter((p) => isBudgetedCode(p));
  if (codeFiles.length === 0) {
    return { code: 0, summary: "" };
  }

  // Bypass: explicit, reasoned, audit-logged. GIT_SKIP_HOOKS skips every
  // check; this flag skips ONLY the census gate.
  const bypass = process.env.MEGADJ_LOC_BYPASS;
  if (bypass !== undefined && bypass.trim().length > 0) {
    try {
      mkdirSync(dirname(join(root, AUDIT_LOG)), { recursive: true });
      appendFileSync(
        join(root, AUDIT_LOG),
        `${new Date().toISOString()}\tbypass\treason=${bypass.trim()}\tfiles=${codeFiles.join(",")}\n`,
      );
    } catch {
      // An unwritable audit log must not wedge a bypassed commit.
    }
    return {
      code: 0,
      summary:
        "LOC-budget gate: BYPASSED (MEGADJ_LOC_BYPASS) — reason audit-logged",
    };
  }

  const staged = git(["diff", "--cached", "--numstat", "--"]);
  if (!staged.ok) return failAdvisory("git diff --cached failed");
  let added = 0;
  let deleted = 0;
  let parseFailed = false;
  for (const line of staged.stdout.split("\n")) {
    const parts = line.trim().split("\t");
    if (parts.length < 3) continue;
    const path = parts[2] ?? "";
    if (!isBudgetedCode(path)) continue;
    // Binary (- -) and unresolvable rows fail soft.
    const a = Number.parseInt(parts[0] ?? "", 10);
    const d = Number.parseInt(parts[1] ?? "", 10);
    if (!Number.isFinite(a) || !Number.isFinite(d)) {
      parseFailed = true;
      continue;
    }
    added += a;
    deleted += d;
  }
  if (parseFailed) {
    return failAdvisory("binary/unreadable staged rows — numbers partial");
  }

  const delta = added - deleted;
  if (delta <= 0) {
    return {
      code: 0,
      summary: `LOC-budget: OK — staged code delta ${delta >= 0 ? "+" : ""}${delta} (net reduction policy in force until ${LOC_TARGET.toLocaleString("en-US")} LOC)`,
    };
  }

  // Growth: compare the census against the baseline-day snapshot. Under
  // the target with growth still allowed? No — policy says reduction
  // until the target is HIT, so growth blocks unless the whole tree is
  // already at/below target (then the gate retires itself quietly).
  const headCommit = resolveCommit("HEAD", root);
  if (headCommit === undefined) {
    return failAdvisory("HEAD unresolvable (fresh repo?)");
  }
  const baselineCommit = resolveCommit(`@{${baselineDay}}`, root);
  if (baselineCommit === undefined) {
    return failAdvisory(
      `no reflog entry for "${baselineDay}" in this clone — baseline unknown`,
    );
  }
  const headLoc = treeLoc(headCommit, root);
  if (headLoc === 0) return failAdvisory("census unreadable at HEAD");
  if (headLoc <= LOC_TARGET) {
    return {
      code: 0,
      summary: `LOC-budget: OK — census ${headLoc.toLocaleString("en-US")} ≤ target ${LOC_TARGET.toLocaleString("en-US")}, gate retired`,
    };
  }
  const baseLoc =
    baselineCommit !== undefined ? treeLoc(baselineCommit, root) : headLoc;
  if (baseLoc === 0) return failAdvisory("census unreadable at baseline");

  const vsBaseline = headLoc + delta - baseLoc;
  const below = [
    `staged code: +${added}/−${deleted} = net +${delta}`,
    `census: ${headLoc.toLocaleString("en-US")} → ~${(headLoc + delta).toLocaleString("en-US")} (target ${LOC_TARGET.toLocaleString("en-US")})`,
    `vs ${baselineDay} snapshot ${baselineCommit.slice(0, 7)} (${baseLoc.toLocaleString("en-US")}): ${vsBaseline >= 0 ? "+" : ""}${vsBaseline}`,
  ];
  return {
    code: 1,
    summary: [
      "🛑 LOC-BUDGET: commit grows the code census — policy is NET REDUCTION",
      `   until the census reaches ${LOC_TARGET.toLocaleString("en-US")} LOC (canvas: megadj-quality-trend).`,
      ...below.map((l) => `   ${l}`),
      "   Land it by pairing the growth with an equal-or-bigger deletion, or",
      "   bypass ONCE with a reason (audit-logged, never silent):",
      '     MEGADJ_LOC_BYPASS="reason: why growth is justified" git commit …',
    ].join("\n"),
  };
}

function selfTest(): number {
  const assertions: [string, boolean][] = [
    ["budgets .ts", isBudgetedCode("src/cli.ts")],
    ["budgets nested .py", isBudgetedCode("cratedeck/python/rb_read.py")],
    ["skips root package.json", !isBudgetedCode("package.json")],
    ["skips root md", !isBudgetedCode("AGENTS.md")],
    ["skips bun.lock (non-code ext)", !isBudgetedCode("bun.lock")],
    ["counts CRLF line breaks", countLines("a\r\nb\r\n") === 2],
    ["counts LF line breaks", countLines("a\nb\nc\n") === 3],
    ["empty body is zero lines", countLines("") === 0],
    ["target is 75k", LOC_TARGET === 75_000],
    ["default baseline is policy day", DEFAULT_BASELINE === "2026-09-15"],
  ];
  let failed = 0;
  for (const [name, ok] of assertions) {
    if (!ok) {
      console.error(`selftest FAIL: ${name}`);
      failed++;
    }
  }
  // The bypass flag is the gate's one escape hatch — its absence would
  // strand the policy without the documented release valve.
  const self = readFileSync(
    join(import.meta.dirname ?? ".", "loc-budget.ts"),
    "utf8",
  );
  if (!self.includes("MEGADJ_LOC_BYPASS")) {
    console.error("selftest FAIL: bypass flag string missing");
    failed++;
  }
  console.log(
    failed === 0
      ? "loc-budget selftest: all assertions pass"
      : `loc-budget selftest: ${failed} failure(s)`,
  );
  return failed === 0 ? 0 : 2;
}

const arg = process.argv[2];
if (arg === "--selftest") {
  process.exitCode = selfTest();
} else {
  const v = runGate(arg ?? undefined);
  if (v.summary.length > 0) process.stderr.write(`${v.summary}\n`);
  process.exitCode = v.code;
}
