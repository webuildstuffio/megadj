// tsconfig-bunfig-census.test.ts — one source of truth per config surface
// (#271/#273, Sep 19): the two tsconfig shims must stay shims (a
// hand-copied compilerOptions twin drifts silently AND shares the root
// tsBuildInfoFile, so a scoped `tsc -p` poisons the warm cache), and the
// nested bunfig.toml copies must stay INERT (bun reads bunfig.toml only
// from the process-start CWD, never from the package dir being tested —
// a trap the #273 audit had to prove by hand; these tests keep it
// proven and force a same-commit doc flip if bun changes the walk).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const repo = join(import.meta.dir, "..", "..");

// ---------- #271: cratedeck/tsconfig.json is an extends shim ----------

test("cratedeck/tsconfig.json is an extends shim, never an options twin", () => {
  const raw = readFileSync(join(repo, "cratedeck/tsconfig.json"), "utf8");
  const json = JSON.parse(raw) as {
    extends?: string;
    compilerOptions?: Record<string, unknown>;
  };
  // The extends target resolves relative to the config's own directory,
  // so "../tsconfig.json" from cratedeck/ is the repo-root config.
  expect(
    json.extends,
    "cratedeck/tsconfig.json must extend the root config — a hand-copied compilerOptions twin drifts and shares the root tsBuildInfoFile (cache-poisoning footgun, #271)",
  ).toBe("../tsconfig.json");
  expect(
    json.compilerOptions,
    "no local compilerOptions overrides: the twin died with #271 (any exception needs a written reason in the file)",
  ).toBeUndefined();
});

test("cratedeck/web/tsconfig.json stays the extends shim it already was", () => {
  const json = JSON.parse(
    readFileSync(join(repo, "cratedeck/web/tsconfig.json"), "utf8"),
  ) as { extends?: string };
  expect(json.extends).toBe("../tsconfig.json");
});

// ---------- #273: nested bunfig.toml copies are inert by construction ----------

test("cratedeck/bunfig.toml stays visibly dead: its timeout differs from root", () => {
  // bun reads bunfig.toml from the process-start CWD only. Every repo
  // script runs `bun test` from the ROOT (where root bunfig pins 15000),
  // so cratedeck/bunfig.toml's 60000 can never apply — retained purely as
  // the documented tripwire. If bun ever walks DOWN into the tested
  // package's bunfig, this copy springs live, the difference below is the
  // visible signal, and both guard tests must flip in the same commit.
  const nested = readFileSync(join(repo, "cratedeck/bunfig.toml"), "utf8");
  const root = readFileSync(join(repo, "bunfig.toml"), "utf8");
  const nestedTimeout = /^timeout\s*=\s*(\d+)/mu.exec(nested)?.[1];
  const rootTimeout = /^timeout\s*=\s*(\d+)/mu.exec(root)?.[1];
  expect(
    nestedTimeout,
    "nested tripwire file must pin a timeout",
  ).toBeDefined();
  expect(rootTimeout, "root bunfig must pin a timeout").toBeDefined();
  expect(
    nestedTimeout,
    "cratedeck/bunfig.toml timeout must DIFFER from root: equality would hide a future reader-walk change (the dead copy must stay visibly dead)",
  ).not.toBe(rootTimeout);
});

test("src/fulltags/bunfig.toml stays deleted — no third mirror regrows", () => {
  // Deleted in #273 (unreferenced fossil; src/fulltags is not a bun
  // workspace and no script ever cd'd there). If a scoped bunfig is ever
  // genuinely needed, restore it WITH a parity test proving bun reads it.
  expect(Bun.file(join(repo, "src/fulltags/bunfig.toml")).size, "regrown").toBe(
    0,
  );
});

test("cratedeck/package.json test script documents the root-run reality", () => {
  // The script's relative paths assume CWD = cratedeck/ (bun workspaces
  // run a package script with cwd = the package dir, where the ROOT
  // bunfig does NOT apply — the one case a nested bunfig COULD matter).
  // No repo gate uses this script (they run `bun test` from the root), so
  // the root bunfig governs everything that matters. Pin the shape so a
  // rewrite that silently changes the run directory cannot slip past.
  const cratePkg = JSON.parse(
    readFileSync(join(repo, "cratedeck/package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const testScript = cratePkg.scripts?.test ?? "";
  expect(testScript).toContain("bun test");
  expect(testScript).toContain("../cratedeck/");
});
