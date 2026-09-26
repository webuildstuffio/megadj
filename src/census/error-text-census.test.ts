import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TS_EXTS, walkFiles } from "../test-support/census-walk";

// errorText census (#82, 2nd pass Sep 18). #82 closed with 1 residual;
// 31 inline `instanceof Error ?` sites + 1 private re-roll had regrown.
// SSOT: src/shared/leaf/fmt.ts errMessage() (src re-exports as
// errorText). Sites outside SANCTIONED fail here — no silent regrowth.
const ROOT = join(import.meta.dir, "..", "..");
const SELF = "src/census/error-text-census.test.ts";

const SANCTIONED: Record<string, string> = {
  "src/shared/leaf/fmt.ts": "the SSOT itself",
  "src/getdat/commands/ingest-probe.ts": "EXDEV guard needs error.code",
  "src/getdat/commands/upgrade.ts": "detail-prefix ': msg' + '' degrade",
  "src/core/similar-storage.ts": "detail-prefix ': msg' + '' degrade",
  "src/core/ledgers.ts": "detail-prefix ': msg' + '' degrade",
  "src/deck/deckctl.ts": "crash print keeps the stack",
  "src/ops/deck-install.ts": "installer top-level catch prints the stack",
  "src/deck/web/products/getdat/surfaced-card.tsx":
    "web toast catch narrows to .message",
  "src/deck/web/products/getdat/getdat-tabs.tsx":
    "web toast catch narrows to .message",
};

test("census: every `instanceof Error` site is the SSOT or sanctioned", () => {
  const fmt = readFileSync(join(ROOT, "src/shared/leaf/fmt.ts"), "utf8");
  expect(fmt).toContain("export function errMessage");
  const offenders: string[] = [];
  for (const dir of ["src"]) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const p of walkFiles(abs, TS_EXTS)) {
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
  for (const dir of ["src"]) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const p of walkFiles(abs, TS_EXTS)) {
      const rel = p.slice(ROOT.length + 1);
      if (rel === SELF) continue;
      if (rel === "src/shared/leaf/fmt.ts") continue; // the SSOT itself
      if (/\bfunction (errorText|errMessage)\b/.test(readFileSync(p, "utf8")))
        offenders.push(rel);
    }
  }
  expect(offenders).toEqual([]);
});
