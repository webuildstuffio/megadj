import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  atomicReplace,
  tempSiblingPath,
  withTempSiblingSync,
} from "./atomic-file";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "megadj-atomic-"));
}

describe("atomic-file seam (#162)", () => {
  test("atomicReplace swaps content and leaves zero residue", () => {
    const dir = scratch();
    const target = join(dir, "masterPlaylists6.xml");
    writeFileSync(target, "<old/>", { mode: 0o600 });
    atomicReplace(target, "<new/>");
    expect(readFileSync(target, "utf8")).toBe("<new/>");
    // mode preserved from the incumbent
    expect(statSync(target).mode & 0o777).toBe(0o600);
    // no temp siblings left behind
    expect(readdirSync(dir)).toEqual(["masterPlaylists6.xml"]);
  });

  test("atomicReplace on a fresh target uses 0644", () => {
    const dir = scratch();
    const target = join(dir, "fresh.xml");
    atomicReplace(target, "v1");
    expect(statSync(target).mode & 0o777).toBe(0o644);
  });

  test("fn failure unlinks the tmp — crash residue cannot accumulate", () => {
    const dir = scratch();
    const target = join(dir, "x.xml");
    writeFileSync(target, "keep");
    expect(() =>
      withTempSiblingSync(target, (tmp) => {
        writeFileSync(tmp, "partial");
        throw new Error("interrupted mid-write");
      }),
    ).toThrow("interrupted mid-write");
    // incumbent untouched, zero residue
    expect(readFileSync(target, "utf8")).toBe("keep");
    expect(readdirSync(dir)).toEqual(["x.xml"]);
  });

  test("fn may skip the write — missing tmp makes the rename a no-op", () => {
    const dir = scratch();
    const target = join(dir, "x.xml");
    writeFileSync(target, "v1");
    const out = withTempSiblingSync(target, () => "skipped");
    expect(out).toBe("skipped");
    expect(readFileSync(target, "utf8")).toBe("v1");
    expect(existsSync(join(dir, ".x.xml.tmp-anything"))).toBe(false);
  });

  test("tempSiblingPath is hidden, unique per call, beside the target", () => {
    const dir = scratch();
    const target = join(dir, "a.xml");
    const a = tempSiblingPath(target);
    const b = tempSiblingPath(target);
    expect(a.startsWith(dir)).toBe(true);
    expect(a).not.toBe(b);
    expect(basename(a).startsWith(".")).toBe(true);
    expect(a).toContain(`tmp-${process.pid}-`);
    // keepExt preserves the extension (muxer-inference rule)
    expect(tempSiblingPath(target, { keepExt: true }).endsWith(".xml")).toBe(
      true,
    );
  });

  test("mode bit: incumbent rwx group stays through the swap", () => {
    const dir = scratch();
    const target = join(dir, "run.sh");
    writeFileSync(target, "#!/bin/sh\n");
    chmodSync(target, 0o750);
    atomicReplace(target, "#!/bin/sh\nset -e\n");
    expect(statSync(target).mode & 0o777).toBe(0o750);
  });
});
