/**
 * exit-code census (#160 ring 3) — the tripwire for "one mutation point".
 *
 * Ring 3 of #160 made `setExit` (and the finishCommandError* epilogues)
 * the ONLY places that write process.exitCode in production code. Every
 * hand-rolled `process.exitCode = N` beside a log line was the drift that
 * let --json runs pollute stdout with human error text. This census fails
 * if a raw write appears outside the seam — new failure paths must call
 * finishCommandError (json-aware), finishCommandErrorSync, or setExit.
 *
 * Allowed:
 *  - src/shared/cli-output.ts — the seam itself (finishCommandError,
 *    finishCommandErrorSync, setExit).
 *  - reads (`if (process.exitCode === 2) return`) — the rb-playlist
 *    sequential numOpt bail-outs; reads don't mutate.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TS_EXTS, walkFiles } from "../test-support/census-walk";

const ROOTS = ["src"] as const; // fulltags merged into src (#193); deck+ops folded in
const ALLOWED_FILES = new Set([
  "src/shared/cli-output.ts", // the seam itself
  // pre-existing hard exits exposed by the cratedeck→src/deck + ops→src/ops
  // folds (Sep 2026) — both drain stdout before exiting (deckctl awaits
  // flushStdout at every site; deck-install writes to a TTY console, no
  // piped --json payload). Converting them to setExit is the #160 follow-up.
  "src/deck/deckctl.ts",
  "src/deck/deckctl/status.ts",
  "src/deck/deckctl/explain.ts",
  "src/deck/deckctl/fleet.ts",
  "src/deck/deckctl/run.ts",
  "src/deck/index.ts",
  "src/ops/deck-install.ts",
]);

describe("exit-code census: one mutation point (#160 ring 3)", () => {
  test("no production file writes process.exitCode outside the seam", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walkFiles(root, TS_EXTS)) {
        if (file.endsWith(".test.ts")) continue;
        if (ALLOWED_FILES.has(file.replaceAll("\\", "/"))) continue;
        const text = readFileSync(file, "utf8");
        // write shape: assignment (+=, =) to process.exitCode. Reads
        // (=== comparisons) are fine. Strip line comments so the census
        // doesn't match its own documentation.
        const code = text
          .split("\n")
          .filter((l) => !l.trim().startsWith("//"))
          .join("\n");
        if (/process\.exitCode\s*(?:[-+]?=(?![=>])|\.value\s*=)/.test(code))
          offenders.push(file);
      }
    }
    expect(
      offenders,
      `raw process.exitCode writes found outside src/shared/cli-output.ts — ` +
        `route them through finishCommandError/finishCommandErrorSync/setExit ` +
        `(issue #160 ring 3): ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  test("no production file hard-exits via process.exit", () => {
    // process.exit skips the awaited stdout drain (#53) and can truncate
    // piped --json output mid-object. The CLI's only allowed hard exit is
    // assertMac's fail-fast (cli.ts) — before any output channel opens.
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walkFiles(root, TS_EXTS)) {
        if (file.endsWith(".test.ts")) continue;
        const norm = file.replaceAll("\\", "/");
        // src/cli.ts's assertMac fail-fast predates the drain rule and opens
        // no output channel first; the fold-sanctioned deck/ops files drain
        // (or TTY-only) — see ALLOWED_FILES.
        if (norm === "src/cli.ts" || ALLOWED_FILES.has(norm)) continue;
        const text = readFileSync(file, "utf8");
        // strip line comments (the migration notes mention process.exit)
        const code = text
          .split("\n")
          .filter((l) => !l.trim().startsWith("//"))
          .join("\n");
        if (/process\.exit\(/.test(code)) offenders.push(file);
      }
    }
    expect(
      offenders,
      `process.exit() found outside src/cli.ts's assertMac — use the ` +
        `finishCommandError epilogue so stdout drains (#53, #160): ` +
        `${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
