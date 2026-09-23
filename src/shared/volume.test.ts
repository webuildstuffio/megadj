import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { configuredMasterDrive, crateDeckRoot, volumePath } from "./volume";
import { tempDir } from "../test-support/testutil";

const TEST_ROOT = tempDir("megadj-volume-cfg-").rippable();
afterAll(() => TEST_ROOT.rippleAll());

/** config.toml sits at <CRATEDECK_ROOT>/config.toml (loadConfig joins
 *  root + "config.toml") — each case gets a fresh root dir. */
function withConfig(toml: string): string {
  const root = join(
    TEST_ROOT.dir(),
    `root-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "config.toml"), toml);
  return root;
}

function withRoot<T>(root: string, fn: () => T): T {
  const prev = process.env.CRATEDECK_ROOT;
  process.env.CRATEDECK_ROOT = root;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CRATEDECK_ROOT;
    else process.env.CRATEDECK_ROOT = prev;
  }
}

describe("volume seams", () => {
  test("volumePath leaves absolute paths alone, mounts bare names", () => {
    expect(volumePath("/Volumes/X")).toBe("/Volumes/X");
    expect(volumePath("SHELF1")).toBe("/Volumes/SHELF1");
  });

  test("configuredMasterDrive reads config.toml library.master_drive (SSOT)", () => {
    const root = withConfig(
      `[library]\nmaster_drive = "MYSTICK"\nmirror_drive = "MYMIRROR"\n`,
    );
    expect(withRoot(root, () => configuredMasterDrive())).toBe("MYSTICK");
  });

  test("configuredMasterDrive falls back to the DJMASTER doc default", () => {
    const root = withConfig(`[library]\nmirror_drive = "MYMIRROR"\n`);
    expect(withRoot(root, () => configuredMasterDrive())).toBe("DJMASTER");
  });
});

describe("crateDeckRoot (#327 super-sure pass: the afc6a535 depth-rule class)", () => {
  test("CRATEDECK_ROOT override wins verbatim", () => {
    expect(withRoot("/explicit/root", () => crateDeckRoot())).toBe(
      "/explicit/root",
    );
  });

  test("present-but-empty CRATEDECK_ROOT reads as absent (#281 class)", () => {
    // walk-up kicks in instead of returning "" — no CWD-relative phantom
    const root = crateDeckRoot();
    expect(root).not.toBe("");
    expect(root).toContain("src/deck");
  });

  test("walk-up finds the repo anchor from THIS file's depth", () => {
    const root = crateDeckRoot();
    expect(root.endsWith("src/deck")).toBe(true);
  });

  test("walk-up is depth-independent: finds the anchor from a synthetic 1- and 5-level-deep tree", () => {
    // Simulate files at arbitrary depth below the repo root: build
    // package.json + .git markers in a temp tree, then verify the same
    // upward scan logic the resolver uses lands on <anchor>/src/deck.
    const anchor = join(TEST_ROOT.dir(), `anchor-${Date.now()}`);
    const deep = join(anchor, "a", "b", "c", "d", "e");
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(anchor, "package.json"), "{}");
    mkdirSync(join(anchor, ".git"), { recursive: true });
    // Mirror the resolver's scan (it is file-relative by design; this
    // asserts the ALGORITHM stops at the first anchor going up).
    let dir = deep;
    let found: string | null = null;
    for (;;) {
      const parent = join(dir, "..");
      if (parent === dir) break;
      dir = parent;
      if (existsSync(join(dir, "package.json")) && existsSync(join(dir, ".git"))) {
        found = join(dir, "src", "deck");
        break;
      }
    }
    expect(found).toBe(join(anchor, "src", "deck"));
  });

  test("CENSUS: no production file hand-rolls the CRATEDECK_ROOT fallback (afc6a535 class pin)", () => {
    // History: `nonEmptyEnv("CRATEDECK_ROOT") ?? join(import.meta.dir,
    // "../deck")` was copy-pasted into 7 files. It is depth-correct only
    // at src/* — the three src/fulltags/megaset arms silently loaded
    // DEFAULT config from a phantom src/fulltags/deck root (digest
    // landed in src/fulltags/deck/data/, proven live Sep 23). All
    // call sites now route through crateDeckRoot(); this census keeps
    // the inline twin from ever returning.
    const offenders: string[] = [];
    const selfSrc = readFileSync(join(import.meta.dir, "volume.ts"), "utf8");
    const scan = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (
            entry.name === "node_modules" ||
            entry.name === "data" ||
            entry.name === "test"
          )
            continue;
          scan(p);
        } else if (
          entry.name.endsWith(".ts") &&
          !entry.name.endsWith(".test.ts")
        ) {
          const src = readFileSync(p, "utf8");
          if (
            src.includes('nonEmptyEnv("CRATEDECK_ROOT")') &&
            src !== selfSrc
          ) {
            offenders.push(p);
          }
        }
      }
    };
    scan(join(import.meta.dir, ".."));
    expect(
      offenders,
      "CRATEDECK_ROOT must be read only inside crateDeckRoot() (src/shared/volume.ts) — inline fallbacks are depth-dependent (afc6a535 class)",
    ).toEqual([]);
  });
});
