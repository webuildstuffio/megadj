import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// errorText census (#82, 2nd pass Sep 18). #82 closed with 1 residual;
// 31 inline `instanceof Error ?` sites + 1 private re-roll had regrown.
// SSOT: cratedeck/shared/fmt.ts errMessage() (src re-exports as
// errorText). Sites outside SANCTIONED fail here — no silent regrowth.
const ROOT = join(import.meta.dir, "..", "..");
const SELF = "src/census/error-text-census.test.ts";

function* repoFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      yield* repoFiles(p);
    } else if (/\.(ts|tsx)$/.test(e.name)) yield p;
  }
}

const SANCTIONED: Record<string, string> = {
  "cratedeck/shared/fmt.ts": "the SSOT itself",
  "src/getdat/commands/ingest-probe.ts": "EXDEV guard needs error.code",
  "src/getdat/commands/upgrade.ts": "detail-prefix ': msg' + '' degrade",
  "src/archive/similar.ts": "detail-prefix ': msg' + '' degrade",
  "src/archive/ledgers.ts": "detail-prefix ': msg' + '' degrade",
  "cratedeck/src/deckctl.ts": "crash print keeps the stack",
};

test("census: every `instanceof Error` site is the SSOT or sanctioned", () => {
  const fmt = readFileSync(join(ROOT, "cratedeck/shared/fmt.ts"), "utf8");
  expect(fmt).toContain("export function errMessage");
  const offenders: string[] = [];
  for (const dir of ["src", "cratedeck/src", "cratedeck/shared"]) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const p of repoFiles(abs)) {
      const rel = p.slice(ROOT.length + 1);
      if (rel === SELF) continue;
      const text = readFileSync(p, "utf8");
      if (text.includes("instanceof Error") && !(rel in SANCTIONED))
        offenders.push(rel);
    }
  }
  expect(offenders).toEqual([]);
});

test("census: no private re-roll of the helper body", () => {
  const offenders: string[] = [];
  for (const dir of ["src", "cratedeck/src", "cratedeck/shared"]) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const p of repoFiles(abs)) {
      const rel = p.slice(ROOT.length + 1);
      if (rel === SELF || rel === "src/shared/error-text.ts") continue;
      if (rel === "cratedeck/shared/fmt.ts") continue; // the SSOT itself
      if (/\bfunction (errorText|errMessage)\b/.test(readFileSync(p, "utf8")))
        offenders.push(rel);
    }
  }
  expect(offenders).toEqual([]);
});
