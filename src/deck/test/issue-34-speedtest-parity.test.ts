import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..");

describe("issue #34: speedtest parity documentation", () => {
  test("documents the shipped UI button and help entry as closed", () => {
    const doc = readFileSync(join(ROOT, "docs/surface-parity.md"), "utf8");

    expect(doc).toMatch(
      /S1 — speedtest UI button: CLOSED[\s\S]*?DrivePage exposes the\s+Speed probe action and `shared\/help\.ts`\/`deckctl_docs\.ts` document it\./,
    );
    expect(doc).not.toContain("OPEN (see §0 #1)");
    expect(doc).not.toContain("Run-speedtest has NO UI button");
    expect(doc).not.toContain("deck_explain has no doc for `speedtest`");
  });
});
