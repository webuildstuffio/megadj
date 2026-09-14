// Issue #46: ui primitives must not transitively pull the standalone CLI
// tree into the browser bundle. This walks relative imports from every ui
// module, so a new indirect edge fails at the exact importing file.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..");
const webRoot = join(root, "cratedeck/web");
const sharedRoot = join(root, "cratedeck/shared");

function isWithin(parent: string, path: string): boolean {
  const rel = relative(parent, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") return [];
      return filesUnder(path);
    }
    return [path];
  });
}

function resolveImport(from: string, specifier: string): string {
  const base = resolve(from, "..", specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(
    `unresolved relative runtime import ${specifier} from ${relative(root, from)}`,
  );
}

function localImports(path: string): string[] {
  const source = readFileSync(path, "utf8");
  const specs = [
    ...source.matchAll(
      /(?:^|[;\n])\s*import\s+(?!type\b)(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gm,
    ),
    ...source.matchAll(/export\s+[^"']*?\s+from\s+["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ];
  return specs
    .map((match) => match[1]!)
    .filter((specifier) => specifier.startsWith("."))
    .map((specifier) => resolveImport(path, specifier));
}

test("#46: the complete web dependency closure stays in web/shared leaves", () => {
  const pending = filesUnder(webRoot).filter((path) => {
    const extension = extname(path);
    return extension === ".ts" || extension === ".tsx";
  });
  const visited = new Set<string>();

  while (pending.length) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    if (!isWithin(webRoot, current) && !isWithin(sharedRoot, current)) {
      throw new Error(
        `web dependency escaped browser-safe roots: ${relative(root, current)}`,
      );
    }
    pending.push(...localImports(current));
  }

  expect(visited.size).toBeGreaterThan(0);
});
