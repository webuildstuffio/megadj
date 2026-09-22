import { afterAll, describe, expect, it } from "bun:test";
import { tempDir } from "./testutil";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config";
import { parseBoothFleetRequest, writeConfigBoothFleet } from "../booth-routes";

// #248 fixture seam: tempDir owns the mkdtemp lifecycle (ripple teardown).
const t = tempDir("cratedeck-config-").rippable();
afterAll(() => t.rippleAll());

// Leak guard (#236): every fixture dir this suite creates is removed
// when the test ends — the old runs left 1,076 cratedeck-config-* dirs
// in tmpdir (measured Sep 18).
describe("config", () => {
  it("loads defaults with no config file", () => {
    const cfg = loadConfig(join(t.dir(), "absent"));
    expect(cfg.serverPort).toBe(7742);
    expect(cfg.masterDrive).toBe("DJMASTER");
    expect(cfg.mirrorDrive).toBe("DJMIRROR");
    expect(cfg.shelfDrive).toBe("SHELF1");
    expect(cfg.imageProvider).toBe(null);
    // uvPath resolves to SOMETHING on every machine — the launchd server
    // has no ~/.local/bin on PATH, so a bare "uv" spawn 404'd unattended
    // (live: verify job 6b37500c, Sep 20). Either the standard install
    // path exists, or the env override / PATH fallback answered.
    expect(cfg.uvPath.length).toBeGreaterThan(0);
  });

  it("prefers MEGADJ_UV_BIN over the PATH fallback when the file exists", () => {
    const fake = join(t.dir(), "fake-uv");
    writeFileSync(fake, "#!/bin/sh\n");
    process.env.MEGADJ_UV_BIN = fake;
    try {
      const cfg = loadConfig(join(t.dir(), "absent2"));
      expect(cfg.uvPath).toBe(fake);
    } finally {
      delete process.env.MEGADJ_UV_BIN;
    }
  });

  it("falls through to the standard install path / bare name when the env candidate is missing", () => {
    process.env.MEGADJ_UV_BIN = join(t.dir(), "does-not-exist");
    try {
      const cfg = loadConfig(join(t.dir(), "absent3"));
      // On a machine with ~/.local/bin/uv the standard path wins; on a
      // bare box the bare "uv" PATH fallback answers. Both are correct.
      const std = `${process.env.HOME}/.local/bin/uv`;
      expect([std, "uv"]).toContain(cfg.uvPath);
    } finally {
      delete process.env.MEGADJ_UV_BIN;
    }
  });

  it("reads config.toml when present", () => {
    const d_cfg = t.dir();
    mkdirSync(d_cfg, { recursive: true });
    writeFileSync(
      join(d_cfg, "config.toml"),
      `[server]\nport = 9999\n\n[images]\nprovider = "brave"\nkey = "k-test"\n\n[library]\nshelf_drive = "BIGBOX"\n`,
    );
    const cfg = loadConfig(d_cfg);
    expect(cfg.serverPort).toBe(9999);
    expect(cfg.imageProvider).toBe("brave");
    expect(cfg.imageKey).toBe("k-test");
    expect(cfg.shelfDrive).toBe("BIGBOX");
  });

  it("rejects unknown image providers", () => {
    const d_bad = t.dir();
    mkdirSync(d_bad, { recursive: true });
    writeFileSync(
      join(d_bad, "config.toml"),
      `[images]\nprovider = " AltaVista"\n`.replace(" ", ""),
    );
    expect(() => loadConfig(d_bad)).toThrow();
  });

  it("keeps a # inside quoted values (API keys contain hashes)", () => {
    // regression: the old parser stripped the inline comment BEFORE
    // de-quoting, truncating key = "abc#def" to "abc
    const d_hash = t.dir();
    mkdirSync(d_hash, { recursive: true });
    writeFileSync(
      join(d_hash, "config.toml"),
      `[images]\nprovider = "exa"\nkey = "abc#def"\n\n[library]\nmaster_drive = "DJ #1"\n`,
    );
    const cfg = loadConfig(d_hash);
    expect(cfg.imageKey).toBe("abc#def");
    expect(cfg.masterDrive).toBe("DJ #1");
  });

  it("still strips comments on unquoted values", () => {
    const d_cmt = t.dir();
    mkdirSync(d_cmt, { recursive: true });
    writeFileSync(
      join(d_cmt, "config.toml"),
      `[library]\nmaster_drive = DJMASTER # mine\n[server]\nport = 8000 # debug\n`,
    );
    const cfg = loadConfig(d_cmt);
    expect(cfg.masterDrive).toBe("DJMASTER");
    expect(cfg.serverPort).toBe(8000);
  });

  it("round-trips a saved non-default booth fleet", () => {
    const root = t.dir(); /* was cratedeck-config- */
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
