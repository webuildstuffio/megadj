/**
 * #223 — the test-internal duplication census (jscpd gate).
 *
 * Test mass is the single biggest LOC lever (33k LOC at filing, 29% of
 * the census) and it regrows scaffolding one copy-pasted beforeEach at
 * a time — the masked-env flake (763cc06) was exactly this class. #197
 * measured 58 clones / 629L at filing; the builder program (genre-row,
 * scan-rows, hygiene-fixture) plus the #223 pass cut it to ZERO clones
 * at ≥100 tokens (jscpd 4.3.0, measured 2026-09-20). This census pins
 * the ceiling so it cannot regrow.
 *
 * Ceiling policy: ratchet, may only move DOWN. When a deliberate shared
 * fixture lands, extract it to src/test-support/ or cratedeck/test/
 * support in the SAME commit and lower the ceiling to the new count.
 */
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const CEILING_CLONES = 5;
const MIN_TOKENS = 100;
// bun:test per-test timeout: the jscpd full-tree scan runs ~2-4s alone,
// up to ~8s under the parallel hook suite — well past the 5s default
const TEST_TIMEOUT = 60_000;

interface JscpdClone {
  firstFile: { name: string; start: number; end: number };
  secondFile: { name: string; start: number; end: number };
  lines: number;
}

interface JscpdReport {
  duplicates: JscpdClone[];
}

test(
  "#223: test-internal clones stay at or below the jscpd ceiling",
  () => {
    try {
      execFileSync("jscpd", ["--version"], { cwd: ROOT, stdio: "pipe" });
    } catch {
      // jscpd not installed — the gate needs the tool; fail with the fix
      throw new Error(
        "jscpd is not installed; install it (`bunx jscpd` warm or global) to run the #223 census",
      );
    }
    execFileSync(
      "jscpd",
      [
        "--reporters",
        "json",
        "--output",
        "/tmp/megadj-jscpd-223",
        "--silent",
        `--min-tokens`,
        String(MIN_TOKENS),
        "--format",
        "typescript",
        "--pattern",
        "**/*.test.ts",
        "src",
        "src/deck/test",
      ],
      // the full-tree scan takes ~2-4s alone and the parallel hook suite
      // runs under load — 5s default bun:test timeout is not enough (#223)
      { cwd: ROOT, stdio: "pipe", timeout: 120_000 },
    );
    const report = JSON.parse(readReport()) as JscpdReport;
    const clones = report.duplicates ?? [];
    const rendered = clones
      .map(
        (c) =>
          `${short(c.firstFile.name)}:${c.firstFile.start}-${c.firstFile.end} <-> ${short(c.secondFile.name)}:${c.secondFile.start}-${c.secondFile.end} (${c.lines}L)`,
      )
      .join("\n");
    // the message carries the offender list; the value comparison is the gate
    expect(clones.length).toBeLessThanOrEqual(CEILING_CLONES);
    if (clones.length > CEILING_CLONES)
      throw new Error(
        `test-internal duplication regrew (${clones.length} clones, ceiling ${CEILING_CLONES}):\n${rendered}\nExtract shared fixtures into src/test-support/ (or src/deck/test support) in the same commit.`,
      );
  },
  TEST_TIMEOUT,
);

function readReport(): string {
  return readFileSync(
    join("/tmp/megadj-jscpd-223", "jscpd-report.json"),
    "utf8",
  );
}

function short(p: string): string {
  return p.includes("megadj/") ? p.split("megadj/")[1]! : p;
}
