import { afterAll, describe, expect, it } from "bun:test";
import { tempDir } from "./testutil";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Guard } from "../guard";
import type { CrateConfig } from "../config";

// #248 fixture seam: tempDir owns the mkdtemp lifecycle (ripple teardown).
const t = tempDir("megadj-guard-root-").rippable();
afterAll(() => t.rippleAll());

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

  it("rejects write, copy, and rm when the wildcard segment is an escaping symlink", async () => {
    const root = t.dir();
    const volumes = join(root, "volumes");
    const externalVolume = join(root, "outside", "external-volume");
    const externalAllowed = join(externalVolume, "PIONEER", "CrateDeck");
    mkdirSync(volumes, { recursive: true });
    mkdirSync(externalAllowed, { recursive: true });
    symlinkSync(externalVolume, join(volumes, "LINK"), "dir");
    const source = join(root, "source.txt");
    const victim = join(externalAllowed, "victim.txt");
    writeFileSync(source, "source");
    writeFileSync(victim, "keep");
    const g = new Guard({ dataDir: join(root, "data") } as CrateConfig);
    g.allow(join(volumes, "*", "PIONEER", "CrateDeck"));
    await expectEscapeBlocked(
      g,
      source,
      join(volumes, "LINK", "PIONEER", "CrateDeck"),
      victim,
    );
  });

  it("rejects write, copy, and rm through a symlink below a wildcard root", async () => {
    const root = t.dir();
    const allowed = join(root, "volumes", "REAL", "PIONEER", "CrateDeck");
    const outside = join(root, "outside");
    mkdirSync(allowed, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(allowed, "escape"), "dir");
    const source = join(root, "source.txt");
    const victim = join(outside, "victim.txt");
    writeFileSync(source, "source");
    writeFileSync(victim, "keep");
    const g = new Guard({ dataDir: join(root, "data") } as CrateConfig);
    g.allow(join(root, "volumes", "*", "PIONEER", "CrateDeck"));
    await expectEscapeBlocked(g, source, join(allowed, "escape"), victim);
  });

  it("rejects .. escapes before write, copy, or rm can mutate outside", async () => {
    const root = t.dir();
    const allowed = join(root, "allowed");
    mkdirSync(allowed);
    const g = new Guard({ dataDir: allowed } as CrateConfig);
    const source = join(root, "source.txt");
    const victim = join(root, "victim.txt");
    writeFileSync(source, "source");
    writeFileSync(victim, "keep");
    const escapedWrite = `${allowed}/../written.txt`;
    const escapedCopy = `${allowed}/../copied.txt`;
    expect(() => g.assertAllowed(escapedWrite)).toThrow(/GUARD VIOLATION/);
    await expect(g.write(escapedWrite, "bad")).rejects.toThrow(
      /GUARD VIOLATION/,
    );
    await expect(g.copy(source, escapedCopy)).rejects.toThrow(
      /GUARD VIOLATION/,
    );
    expect(() => g.rm(`${allowed}/../victim.txt`)).toThrow(/GUARD VIOLATION/);
    expect(existsSync(escapedWrite)).toBe(false);
    expect(existsSync(escapedCopy)).toBe(false);
    expect(readFileSync(victim, "utf8")).toBe("keep");
  });

  it("rejects a sibling prefix before creating a file", async () => {
    const root = t.dir();
    const allowed = join(root, "data");
    const sibling = join(root, "data-evil", "file.txt");
    mkdirSync(allowed);
    const g = new Guard({ dataDir: allowed } as CrateConfig);
    await expect(g.write(sibling, "bad")).rejects.toThrow(/GUARD VIOLATION/);
    expect(existsSync(sibling)).toBe(false);
  });

  it("rejects an existing symlink escape before write, copy, or rm", async () => {
    const root = t.dir();
    const allowed = join(root, "allowed");
    const outside = join(root, "outside");
    mkdirSync(allowed);
    mkdirSync(outside);
    symlinkSync(outside, join(allowed, "escape"), "dir");
    const source = join(root, "source.txt");
    const victim = join(outside, "victim.txt");
    writeFileSync(source, "source");
    writeFileSync(victim, "keep");
    const escapedWrite = join(allowed, "escape", "written.txt");
    const escapedCopy = join(allowed, "escape", "copied.txt");
    await expect(gWrite(allowed, escapedWrite, "bad")).rejects.toThrow(
      /GUARD VIOLATION/,
    );
    const g = new Guard({ dataDir: allowed } as CrateConfig);
    await expect(g.copy(source, escapedCopy)).rejects.toThrow(
      /GUARD VIOLATION/,
    );
    expect(() => g.rm(join(allowed, "escape", "victim.txt"))).toThrow(
      /GUARD VIOLATION/,
    );
    expect(existsSync(escapedWrite)).toBe(false);
    expect(existsSync(escapedCopy)).toBe(false);
    expect(readFileSync(victim, "utf8")).toBe("keep");
  });

  it("rejects a symlink escape inside a matched wildcard suffix", () => {
    const root = t.dir();
    const volumes = join(root, "Volumes");
    const stick = join(volumes, "USB");
    const outside = join(root, "outside");
    mkdirSync(stick, { recursive: true });
    mkdirSync(outside);
    symlinkSync(outside, join(stick, "Contents"), "dir");
    const g = new Guard({ dataDir: join(root, "data") } as CrateConfig);
    g.allow(join(volumes, "*", "Contents", "CrateDeck"));
    expect(() =>
      g.assertAllowed(join(stick, "Contents", "CrateDeck", "photo.jpg")),
    ).toThrow(/GUARD VIOLATION/);
  });

  it("allows normalized in-root writes and copies", async () => {
    const root = t.dir();
    const allowed = join(root, "data", "..", "data");
    const source = join(root, "source.txt");
    writeFileSync(source, "source");
    const g = new Guard({ dataDir: allowed } as CrateConfig);
    const written = join(root, "data", "nested", "written.txt");
    const copied = join(root, "data", "nested", "copied.txt");
    await g.write(written, "written");
    await g.copy(source, copied);
    expect(readFileSync(written, "utf8")).toBe("written");
    expect(readFileSync(copied, "utf8")).toBe("source");
  });

  it("requires absolute candidate and allow-list paths", () => {
    expect(
      () => new Guard({ dataDir: "relative/data" } as CrateConfig),
    ).toThrow(/absolute/);
    const g = new Guard(testConfig);
    expect(() => g.allow("relative/extra")).toThrow(/absolute/);
    expect(() => g.assertAllowed("relative/file.txt")).toThrow(
      /GUARD VIOLATION/,
    );
  });
});

async function gWrite(
  allowed: string,
  destination: string,
  data: string,
): Promise<void> {
  const g = new Guard({ dataDir: allowed } as CrateConfig);
  await g.write(destination, data);
}

async function expectEscapeBlocked(
  guard: Guard,
  source: string,
  escapedDirectory: string,
  victim: string,
): Promise<void> {
  const written = join(escapedDirectory, "written.txt");
  const copied = join(escapedDirectory, "copied.txt");
  const [writeResult, copyResult] = await Promise.allSettled([
    guard.write(written, "bad"),
    guard.copy(source, copied),
  ]);
  let removeError: unknown;
  try {
    guard.rm(victim);
  } catch (error) {
    removeError = error;
  }
  expect(writeResult.status).toBe("rejected");
  expect(copyResult.status).toBe("rejected");
  expect(removeError).toBeInstanceOf(Error);
  expect(existsSync(written)).toBe(false);
  expect(existsSync(copied)).toBe(false);
  expect(readFileSync(victim, "utf8")).toBe("keep");
}
