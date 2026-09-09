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

  it("allow() supports a single-* segment (per-volume stick dir)", () => {
    const g = new Guard(testConfig);
    g.allow("/vol/*/Contents/CrateDeck");
    expect(() =>
      g.assertAllowed("/vol/DJMASTER/Contents/CrateDeck/photo.png"),
    ).not.toThrow();
    expect(() =>
      g.assertAllowed("/vol/DJMIRROR/Contents/CrateDeck/photo.png"),
    ).not.toThrow();
    // `*` matches exactly ONE segment — no deep escape, no sibling leak
    expect(() =>
      g.assertAllowed("/vol/DJMASTER/Contents/CrateDeck/extra/deep.png"),
    ).not.toThrow(); // under the allowed dir is fine
    expect(() => g.assertAllowed("/vol/Evil/Contents/Other/x")).toThrow(
      /GUARD VIOLATION/,
    );
    expect(() => g.assertAllowed("/vol/x/Contents/CrateDeckEvil/y")).toThrow(
      /GUARD VIOLATION/,
    );
  });
});
