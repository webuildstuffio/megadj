import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync, type Stats } from "node:fs";
import { join } from "node:path";

/**
 * One entry point per standalone harness (#185): every runnable harness
 * is reachable through a CLI verb (megadj verb, fulltags verb, or deckctl
 * behind the server) — never a bare `bun <path>` script outside the
 * command surfaces. The Sep 11 CLI-consolidation audit found two such
 * hidden entry points (fulltags/verify-key.ts → `fulltags verify-key`;
 * src/deck/bench.ts → knip-only library entry). This census keeps
 * the class from returning: a NEW standalone harness must arrive with
 * its verb in the same commit, or an explicit exemption row below (with
 * the reason and the owning verb plan).
 */
const repo = join(import.meta.dir, "..", "..");

const read = (p: string): string => readFileSync(join(repo, p), "utf8");

test("no bun-shebang scripts outside the three CLI entry files", () => {
  // The ONLY sanctioned `#!/usr/bin/env bun` executables: the two CLI
  // front doors plus the pre-commit LOC-budget hook script (run by the
  // git hook, not by operators — it IS its surface).
  const allowed = new Set([
    "src/cli.ts",
    "src/fulltags/cli/cli.ts",
    "src/ops/deck-install.ts", // `bun run deck:install` (#247) — operator surface
    "tools/loc-budget.ts",
  ]);
  const offenders: string[] = [];
  for (const f of ["src", "tools"])
    // fulltags -> src/fulltags (#193); cratedeck -> src/deck (Sep 2026)
    for (const line of walkShebangs(join(repo, f)))
      if (!allowed.has(line.path))
        offenders.push(`${line.path}: ${line.firstLine.trim()}`);
  expect(offenders).toEqual([]);
});

test("no import.meta.main entry blocks outside sanctioned entry points", () => {
  // import.meta.main is the standalone-harness marker (the fix-years shim
  // was deleted Sep 16 2026, #93 CUT — the live surface is `megadj years`;
  // a NEW block outside these files means a new bun-only entry point).
  const allowed = new Set([
    "tools/repo-hygiene.ts", // hygiene gate script (git hook surface)
    "tools/loc-budget.ts",
  ]);
  const offenders: string[] = [];
  for (const f of ["src", "tools"]) {
    // #193
    for (const p of walkTs(join(repo, f))) {
      if (allowed.has(p) || p.endsWith(".test.ts")) continue;
      if (read(p).includes("import.meta.main")) offenders.push(p);
    }
  }
  expect(offenders).toEqual([]);
});

test("knip lists no library module as a workspace entry point", () => {
  // bench.ts was knip-listed only so knip could SEE it — a library file
  // dressed as an entry point. Entries are executables or public API
  // leaves; a module imported by another module belongs to neither list.
  const knip: {
    workspaces: Record<string, { entry?: string[] }>;
  } = JSON.parse(read("knip.json"));
  // bench.ts is the regression: cratedeck library code that once rode
  // the entry list.
  for (const [ws, cfg] of Object.entries(knip.workspaces)) {
    for (const e of cfg.entry ?? []) {
      expect(
        e.endsWith("bench.ts"),
        `${ws} entry "${e}" is library code — import it, don't list it`,
      ).toBeFalse();
    }
  }
});

test("fulltags verify-key verb exists and is documented", () => {
  const cli = read("src/fulltags/cli/cli.ts");
  expect(cli).toContain('"verify-key"');
  const help = cli;
  expect(help).toContain("verify-key <folder>");
  // the gate contract is in the help text (agent-facing surface)
  expect(help).toContain("80% exact agreement");
  // the old bare path is gone everywhere operators look
  expect(read("src/fulltags/README.md")).not.toContain(
    "fulltags/utils/verify-key.ts",
  );
});

// --- tiny walkers (test-local; the prod walker is sync/fs-rooted too) ---

function* walkTs(dir: string): Generator<string> {
  for (const e of walkEntries(dir)) yield e;
}

function* walkShebangs(
  dir: string,
): Generator<{ path: string; firstLine: string }> {
  for (const p of walkEntries(dir)) {
    const first = read(p).split("\n")[0] ?? "";
    if (first.startsWith("#!")) yield { path: p, firstLine: first };
  }
}

function walkEntries(dir: string): Generator<string> {
  return walk(dir);
}

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === "dist" || e === "web") continue;
    const full = join(dir, e);
    let st: Stats;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(full);
    else if (e.endsWith(".ts") && !e.endsWith(".d.ts"))
      yield full.replace(`${repo}/`, "");
  }
}
