import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const srcDir = join(import.meta.dir, "..", "src");

test("#41: deckctl core stays below the 300-line hotspot ceiling", () => {
  const source = readFileSync(join(srcDir, "deckctl.ts"), "utf8");
  expect(source.split("\n").length).toBeLessThanOrEqual(300);
});

test("#41: deckctl helper modules never import the core dispatcher", () => {
  const backImports = readdirSync(srcDir)
    .filter((name) => /^deckctl_.+\.ts$/.test(name))
    .filter((name) => {
      const source = readFileSync(join(srcDir, name), "utf8");
      return /from\s+["']\.\/deckctl["']/.test(source);
    });

  expect(backImports).toEqual([]);
});
