import { expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tempDir } from "./testutil";

const srcDir = join(import.meta.dir, "..", "src");

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

function importsCore(file: string, coreFile: string): boolean {
  const source = readFileSync(file, "utf8");
  const specifiers = source.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g,
  );
  return [...specifiers].some((match) => {
    const specifier = match[1];
    if (!specifier?.startsWith(".")) return false;
    const target = resolve(dirname(file), specifier);
    return target === coreFile || `${target}.ts` === coreFile;
  });
}

function coreBackImports(helperDir: string, coreFile: string): string[] {
  return tsFiles(helperDir)
    .filter((file) => importsCore(file, coreFile))
    .map((file) => relative(helperDir, file))
    .toSorted();
}

test("#41: deckctl core stays below the 300-line hotspot ceiling", () => {
  const source = readFileSync(join(srcDir, "deckctl.ts"), "utf8");
  expect(source.split("\n").length).toBeLessThanOrEqual(300);
});

test("#41: deckctl helper modules never import the core dispatcher", () => {
  const helperDir = join(srcDir, "deckctl");
  expect(coreBackImports(helperDir, join(srcDir, "deckctl.ts"))).toEqual([]);
});

test("#41: nested deckctl helpers cannot bypass the back-import census", () => {
  const fixture = tempDir("megadj-deckctl-core-census-");
  const root = fixture.dir();
  try {
    const fixtureSrc = join(root, "src");
    const helperDir = join(fixtureSrc, "deckctl");
    const nestedDir = join(helperDir, "nested");
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(fixtureSrc, "deckctl.ts"), "export {};\n");
    writeFileSync(
      join(nestedDir, "back-edge.ts"),
      'import { main } from "../../deckctl";\nvoid main;\n',
    );

    expect(coreBackImports(helperDir, join(fixtureSrc, "deckctl.ts"))).toEqual([
      join("nested", "back-edge.ts"),
    ]);
  } finally {
    fixture.dispose(root);
  }
});
