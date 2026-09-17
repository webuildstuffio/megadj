import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configuredMasterDrive, volumePath } from "./volume";

const TEST_ROOT = mkdtempSync(join(tmpdir(), "megadj-volume-cfg-"));
afterAll(() => rmSync(TEST_ROOT, { recursive: true, force: true }));

/** config.toml sits at <CRATEDECK_ROOT>/config.toml (loadConfig joins
 *  root + "config.toml") — each case gets a fresh root dir. */
function withConfig(toml: string): string {
  const root = join(TEST_ROOT, `root-${Math.random().toString(36).slice(2)}`);
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
