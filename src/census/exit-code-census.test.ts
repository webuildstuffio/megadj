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
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src"] as const; // fulltags merged into src (#193)
const ALLOWED_FILES = new Set([
  "src/shared/cli-output.ts", // the seam itself
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
      out.push(p);
  }
  return out;
}

describe("exit-code census: one mutation point (#160 ring 3)", () => {
  test("no production file writes process.exitCode outside the seam", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
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
      for (const file of walk(root)) {
        if (file.replaceAll("\\", "/") === "src/cli.ts") continue;
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
