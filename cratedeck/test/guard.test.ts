import { describe, it, expect } from "bun:test";
import { Guard } from "../src/guard";
import type { CrateConfig } from "../src/config";

const testConfig = { dataDir: "/tmp/cratedeck-guard-test" } as CrateConfig;

describe("guard", () => {
  it("allows writes under dataDir", async () => {
    const g = new Guard(testConfig);
    await g.write("/tmp/cratedeck-guard-test/sub/file.txt", "hi");
    expect(
      await Bun.file("/tmp/cratedeck-guard-test/sub/file.txt").text(),
    ).toBe("hi");
  });

  it("throws on writes outside dataDir", () => {
    const g = new Guard(testConfig);
    expect(() =>
      g.assertAllowed("/Volumes/DJMASTER/PIONEER/rekordbox/db"),
    ).toThrow(/GUARD VIOLATION/);
    expect(() => g.assertAllowed("/etc/hosts")).toThrow(/GUARD VIOLATION/);
    // prefix-adjacent path must not pass (not /tmp/cratedeck-guard-testEvil)
    expect(() => g.assertAllowed("/tmp/cratedeck-guard-testEvil/x")).toThrow(
      /GUARD VIOLATION/,
    );
  });

  it("copy destination must be allowed", async () => {
    const g = new Guard(testConfig);
    await expect(g.copy("/etc/hosts", "/Volumes/DJMASTER/x")).rejects.toThrow(
      /GUARD VIOLATION/,
    );
  });
});
