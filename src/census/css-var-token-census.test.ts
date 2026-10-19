import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/* #522 — a var() referencing a custom property that is defined nowhere and
 * carries no fallback is invalid at computed-value time: the whole
 * declaration silently drops (the #521 --line/--text2 trap, CSS-only, no
 * error anywhere). This census scans every stylesheet in
 * src/deck/web/styles/ and reds any var() whose primary name is undefined
 * unless its fallback chain fully resolves (literal, or vars that resolve).
 * Renamed-away typo names (--dim, --text-2, --text-dim, --hover) are banned
 * outright so the class cannot quietly regrow. */

const stylesDir = join(import.meta.dir, "..", "deck", "web", "styles");
const dataTableTsx = join(
  import.meta.dir,
  "..",
  "deck",
  "web",
  "ui",
  "data-table.tsx",
);

interface VarUse {
  name: string;
  fallback: string | undefined;
  file: string;
  line: number;
}

/* Comments/strings are scan noise: a commented-out `--x: …;` must not count
 * --x as defined (that masks a genuinely unresolved var(--x) elsewhere) and
 * prose like megaset.css's header ("all read var(--set)") must not red a
 * token removal. One pass strips both so comment/string state is tracked
 * together — two passes misfire in EITHER order: comments-first lets a `/*`
 * inside a string open a fake comment that eats real code up to the next
 * real terminator; strings-first lets a quote inside a comment swallow that
 * terminator and eat the span after it. Newlines are preserved so reported
 * line numbers stay true. */
function stripCssNoise(css: string): string {
  return css.replace(
    /\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g,
    (m) => m.replace(/[^\n]/g, " "),
  );
}

function declaredTokens(css: string): Set<string> {
  const tokens = new Set<string>();
  for (const m of css.matchAll(/--[a-zA-Z0-9-]+(?=\s*:)/g)) {
    tokens.add(m[0].slice(2));
  }
  return tokens;
}

function varUses(css: string, file: string): VarUse[] {
  const uses: VarUse[] = [];
  let start = 0;
  for (;;) {
    const i = css.indexOf("var(", start);
    if (i === -1) break;
    let depth = 1;
    let j = i + 4;
    while (j < css.length && depth > 0) {
      const c = css[j];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      j++;
    }
    if (depth > 0) break; // unterminated var( — malformed CSS, stop scanning
    const inner = css.slice(i + 4, j - 1).trim();
    const name = /^--[a-zA-Z0-9-]+/.exec(inner)?.[0].slice(2);
    if (name !== undefined) {
      const rest = inner.slice(name.length + 2).trim();
      const fallback = rest.startsWith(",") ? rest.slice(1).trim() : undefined;
      uses.push({
        name,
        fallback,
        file,
        line: css.slice(0, i).split("\n").length,
      });
    }
    start = j;
  }
  return uses;
}

function resolves(use: VarUse, tokens: Set<string>): boolean {
  if (tokens.has(use.name)) return true;
  if (use.fallback === undefined) return false;
  return varUses(use.fallback, use.file).every((nested) =>
    resolves(nested, tokens),
  );
}

const files = readdirSync(stylesDir)
  .filter((f) => f.endsWith(".css"))
  .toSorted();
const sources = new Map<string, string>();
const tokens = new Set<string>();
for (const f of files) {
  const css = stripCssNoise(readFileSync(join(stylesDir, f), "utf8"));
  sources.set(f, css);
  for (const t of declaredTokens(css)) tokens.add(t);
}
const allUses: VarUse[] = [];
for (const [f, css] of sources) allUses.push(...varUses(css, f));
const unresolved = allUses.filter((u) => !resolves(u, tokens));

test("css token census: styles dir scan is non-empty (empty scan must never pass)", () => {
  expect(files.length).toBeGreaterThanOrEqual(13);
  expect(allUses.length).toBeGreaterThan(50);
});

test("every var() in src/deck/web/styles resolves against the defined token set (#522)", () => {
  const report = unresolved
    .map(
      (u) =>
        `${u.file}:${u.line} — var(--${u.name}${u.fallback !== undefined ? ", …" : ""}) is undefined with no resolving fallback`,
    )
    .join("\n  ");
  expect(unresolved, `unresolvable var() uses:\n  ${report}`).toHaveLength(0);
});

test("#522: --ok/--line are defined aliases and the typo names never return", () => {
  expect(tokens.has("ok"), "--ok alias missing from tokens.css").toBe(true);
  expect(tokens.has("line"), "--line alias missing from tokens.css").toBe(true);
  for (const banned of ["dim", "text-2", "text-dim", "hover"]) {
    const hits = allUses.filter((u) => u.name === banned);
    expect(
      hits.map((u) => `${u.file}:${u.line}`),
      `banned undefined token --${banned} reintroduced`,
    ).toEqual([]);
  }
});

test("census scanner ignores tokens inside comments and strings", () => {
  const css = stripCssNoise(
    [
      "/* prose reads var(--ghost) and a dead decl --ghost: #fff; */",
      '.a { content: "var(--quoted)"; color: var(--real); }',
      ":root { --real: #fff; }",
    ].join("\n"),
  );
  expect([...declaredTokens(css)]).toEqual(["real"]);
  expect(varUses(css, "x.css").map((u) => u.name)).toEqual(["real"]);
});

test("census scanner tracks comment and string state in one pass (no fake spans)", () => {
  // Comments-first regression: the `/*` inside the string must not open a
  // fake comment that eats `--real` up to the tail comment's terminator.
  const strCss = stripCssNoise(
    '.a { content: "/* fake" } .b { --real: 1; color: var(--real); } /* tail */',
  );
  expect(strCss).toContain("--real");
  expect(varUses(strCss, "x.css").map((u) => u.name)).toEqual(["real"]);
  // Strings-first regression: the quote inside the comment must not open a
  // fake string that swallows the terminator and eats `--real2` after it.
  const quoteCss = stripCssNoise(
    '/* say " */ .c { --real2: 1; color: var(--real2); } /* " tail */',
  );
  expect(quoteCss).toContain("--real2");
  expect(varUses(quoteCss, "x.css").map((u) => u.name)).toEqual(["real2"]);
});

test("--dt-cols stays component-provided by ui/data-table.tsx", () => {
  // The stylesheet only carries a misuse fallback; the real per-table grid
  // template is set inline on the .datatable root (inherited by head/rows).
  expect(readFileSync(dataTableTsx, "utf8")).toContain('"--dt-cols"');
});
