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
  const graph = new Map<string, string[]>();

  while (pending.length) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    if (!isWithin(webRoot, current) && !isWithin(sharedRoot, current)) {
      throw new Error(
        `web dependency escaped browser-safe roots: ${relative(root, current)}`,
      );
    }
    const dependencies = localImports(current);
    graph.set(current, dependencies);
    pending.push(...dependencies);
  }

  expect(visited.size).toBeGreaterThan(0);

  interface DepthResult {
    depth: number;
    chain: string[];
  }
  const depths = new Map<string, DepthResult>();
  const depthOf = (path: string, stack = new Set<string>()): DepthResult => {
    const cached = depths.get(path);
    if (cached !== undefined) return cached;
    if (stack.has(path)) {
      throw new Error(`web dependency cycle at ${relative(root, path)}`);
    }
    const nextStack = new Set(stack).add(path);
    const dependencies = graph.get(path) ?? [];
    const child = dependencies
      .map((dependency) => depthOf(dependency, nextStack))
      .reduce<DepthResult>(
        (maximum, candidate) =>
          candidate.depth > maximum.depth ? candidate : maximum,
        { depth: 0, chain: [] },
      );
    const result = { depth: child.depth + 1, chain: [path, ...child.chain] };
    depths.set(path, result);
    return result;
  };
  const maximum = [...graph.keys()]
    .map((path) => depthOf(path))
    .reduce((deepest, candidate) =>
      candidate.depth > deepest.depth ? candidate : deepest,
    );
  expect(
    maximum.depth,
    maximum.chain.map((path) => relative(root, path)).join(" → "),
  ).toBeLessThanOrEqual(13);
  // 13 (was 11): the #204/#209 module splits (data.tsx → data-table +
  // kv/barlist/stats, MegasetPanel → MegasetOpenerPicker) added two
  // purposeful hops on the same browser-safe tail. The invariant this
  // test exists for — no web import escapes web/shared (the CLI-tree
  // check above) and no cycles — is unchanged; the number tracks the
  // real graph, it does not police decomposition.
});
