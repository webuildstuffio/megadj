import { describe, it, expect, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import {
  parseBoothFleetRequest,
  writeConfigBoothFleet,
} from "../src/booth_routes";

// Leak guard (#236): every fixture dir this suite creates is removed
// when the test ends — the old runs left 1,076 cratedeck-config-* dirs
// in tmpdir (measured Sep 18).
const createdDirs: string[] = [];

function leakTrackedTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("config", () => {
  it("loads defaults with no config file", () => {
    const cfg = loadConfig("/tmp/cratedeck-test-nonexistent");
    expect(cfg.serverPort).toBe(7742);
    expect(cfg.masterDrive).toBe("DJMASTER");
    expect(cfg.mirrorDrive).toBe("DJMIRROR");
    expect(cfg.shelfDrive).toBe("SHELF1");
    expect(cfg.imageProvider).toBe(null);
  });

  it("reads config.toml when present", () => {
    mkdirSync("/tmp/cratedeck-test-cfg", { recursive: true });
    writeFileSync(
      "/tmp/cratedeck-test-cfg/config.toml",
      `[server]\nport = 9999\n\n[images]\nprovider = "brave"\nkey = "k-test"\n\n[library]\nshelf_drive = "BIGBOX"\n`,
    );
    const cfg = loadConfig("/tmp/cratedeck-test-cfg");
    expect(cfg.serverPort).toBe(9999);
    expect(cfg.imageProvider).toBe("brave");
    expect(cfg.imageKey).toBe("k-test");
    expect(cfg.shelfDrive).toBe("BIGBOX");
  });

  it("rejects unknown image providers", () => {
    mkdirSync("/tmp/cratedeck-test-bad", { recursive: true });
    writeFileSync(
      "/tmp/cratedeck-test-bad/config.toml",
      `[images]\nprovider = " AltaVista"\n`.replace(" ", ""),
    );
    expect(() => loadConfig("/tmp/cratedeck-test-bad")).toThrow();
  });

  it("keeps a # inside quoted values (API keys contain hashes)", () => {
    // regression: the old parser stripped the inline comment BEFORE
    // de-quoting, truncating key = "abc#def" to "abc
    mkdirSync("/tmp/cratedeck-test-hash", { recursive: true });
    writeFileSync(
      "/tmp/cratedeck-test-hash/config.toml",
      `[images]\nprovider = "exa"\nkey = "abc#def"\n\n[library]\nmaster_drive = "DJ #1"\n`,
    );
    const cfg = loadConfig("/tmp/cratedeck-test-hash");
    expect(cfg.imageKey).toBe("abc#def");
    expect(cfg.masterDrive).toBe("DJ #1");
  });

  it("still strips comments on unquoted values", () => {
    mkdirSync("/tmp/cratedeck-test-cmt", { recursive: true });
    writeFileSync(
      "/tmp/cratedeck-test-cmt/config.toml",
      `[library]\nmaster_drive = DJMASTER # mine\n[server]\nport = 8000 # debug\n`,
    );
    const cfg = loadConfig("/tmp/cratedeck-test-cmt");
    expect(cfg.masterDrive).toBe("DJMASTER");
    expect(cfg.serverPort).toBe(8000);
  });

  it("round-trips a saved non-default booth fleet", () => {
    const root = leakTrackedTmp("cratedeck-config-");
    writeFileSync(join(root, "config.toml"), "[server]\nport = 7742\n");

    writeConfigBoothFleet(root, ["cdj-2000"]);

    expect(loadConfig(root).boothFleet).toEqual(["cdj-2000"]);
  });

  it("rejects malformed and unknown booth fleet requests", () => {
    for (const value of [null, {}, { selected: "xdj-xz" }, { selected: [7] }])
      expect(() => parseBoothFleetRequest(value)).toThrow("selected");
    expect(() =>
      parseBoothFleetRequest({ selected: ["not-a-player"] }),
    ).toThrow("unknown player id");
    expect(parseBoothFleetRequest({ selected: [] })).not.toEqual([]);
  });
});
