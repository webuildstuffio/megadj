import { describe, it, expect } from "bun:test";
import { loadConfig } from "../src/config";

describe("config", () => {
  it("loads defaults with no config file", () => {
    const cfg = loadConfig("/tmp/cratedeck-test-nonexistent");
    expect(cfg.serverPort).toBe(7742);
    expect(cfg.masterDrive).toBe("DJMASTER");
    expect(cfg.mirrorDrive).toBe("DJMIRROR");
    expect(cfg.imageProvider).toBe(null);
  });

  it("reads config.toml when present", () => {
    const { writeFileSync, mkdirSync } = require("node:fs");
    mkdirSync("/tmp/cratedeck-test-cfg", { recursive: true });
    writeFileSync(
      "/tmp/cratedeck-test-cfg/config.toml",
      `[server]\nport = 9999\n\n[images]\nprovider = "brave"\nkey = "k-test"\n`,
    );
    const cfg = loadConfig("/tmp/cratedeck-test-cfg");
    expect(cfg.serverPort).toBe(9999);
    expect(cfg.imageProvider).toBe("brave");
    expect(cfg.imageKey).toBe("k-test");
  });

  it("rejects unknown image providers", () => {
    const { writeFileSync, mkdirSync } = require("node:fs");
    mkdirSync("/tmp/cratedeck-test-bad", { recursive: true });
    writeFileSync(
      "/tmp/cratedeck-test-bad/config.toml",
      `[images]\nprovider = " AltaVista"\n`.replace(" ", ""),
    );
    expect(() => loadConfig("/tmp/cratedeck-test-bad")).toThrow();
  });
});
