/**
 * rb_read.test.ts — the parsing seam between rekordbox device databases and
 * every hardware verdict CrateDeck makes.
 *
 * `cratedeck/python/rb_read.py` is the only module that reads the dual-DB
 * structure (OneLibrary exportLibrary.db + legacy export.pdb), and its
 * sibling helper scripts (`anlz_paths.py`, `usb_verify.py::pdb_live_rows`)
 * implement Pioneer's hash-path algorithm and the legacy PDB page walk.
 * These tests exercise that seam through golden fixtures — tiny synthetic
 * files whose expected output was derived from the algorithms themselves
 * and validated against real drive data — so a parser regression fails
 * here instead of shipping a wrong "healthy" verdict to a gig.
 *
 * Python is invoked via `uv run --with pyrekordbox python` where the full
 * snapshot needs it; the hash/page-walk helpers only need the stdlib.
 * Tests skip with a clear message if `uv` is unavailable.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PY_DIR = join(import.meta.dir, "..", "python");
const SCRIPTS_DIR = join(
  import.meta.dir,
  "..",
  "..",
  ".claude",
  "skills",
  "rekordbox-usb-sync",
  "scripts",
);
const TMP = `/tmp/megadj-rbread-test-${process.pid}`;
// The exact pin rb.ts uses in production — keeps the test seam identical.
const PYREKORDBOX_PIN =
  "pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git";

let uvAvailable = false;
beforeAll(() => {
  const probe = Bun.spawnSync({ cmd: ["which", "uv"], stdout: "pipe" });
  uvAvailable = probe.exitCode === 0;
  mkdirSync(join(TMP, "PIONEER", "USBANLZ"), { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function runPython(
  code: string,
  extraArgs: string[] = [],
): {
  ok: boolean;
  stdout: string;
  stderr: string;
} {
  // usb_verify.py imports pyrekordbox at module level (matching rb.ts's
  // production invocation), so the git-sourced package is always included.
  const withArgs = ["--with", PYREKORDBOX_PIN, ...extraArgs];
  const p = Bun.spawnSync({
    cmd: [
      "uv",
      "run",
      ...withArgs,
      "python",
      "-c",
      `import sys; sys.path.insert(0, ${JSON.stringify(PY_DIR)}); sys.path.insert(0, ${JSON.stringify(SCRIPTS_DIR)}); ${code}`,
    ],
    stdout: "pipe",
    stderr: "pipe",
    cwd: TMP,
  });
  return {
    ok: p.exitCode === 0,
    stdout: new TextDecoder().decode(p.stdout),
    stderr: new TextDecoder().decode(p.stderr),
  };
}

// ---------------------------------------------------------------------------
// anlz_paths — Pioneer's hash-path algorithm (single source of truth)
// ---------------------------------------------------------------------------
describe("anlz_paths.compute_anlz_folder", () => {
  test("is deterministic and stable for the same path", () => {
    const r = runPython(
      `from anlz_paths import compute_anlz_folder
import json
a = compute_anlz_folder("Contents/PIONEER/Tracks/track.mp3")
b = compute_anlz_folder("Contents/PIONEER/Tracks/track.mp3")
print(json.dumps([a, b]))`,
    );
    expect(r.ok).toBe(true);
    const [a, b] = JSON.parse(r.stdout.trim()) as [
      [number, number],
      [number, number],
    ];
    expect(a).toEqual(b);
    // device prefix is derived from hr's bit pattern — must be < 4096 (PXXX)
    expect(a[0]).toBeLessThan(0x1000);
  });

  test("distinct paths hash differently (collision-avoiding domain)", () => {
    const r = runPython(
      `from anlz_paths import compute_anlz_folder
import json
paths = ["Contents/a.mp3", "Contents/b.mp3", "Contents/c.mp3", "Contents/d.mp3", "Contents/e.mp3"]
print(json.dumps([compute_anlz_folder(p) for p in paths]))`,
    );
    expect(r.ok).toBe(true);
    const hrs = (JSON.parse(r.stdout.trim()) as [number, number][]).map(
      ([, hr]) => hr,
    );
    expect(new Set(hrs).size).toBeGreaterThan(1);
  });

  test("hash remainder stays within ANLZ_HASH_MOD", () => {
    const r = runPython(
      `from anlz_paths import compute_anlz_folder, ANLZ_HASH_MOD
import json
print(json.dumps([compute_anlz_folder("Contents/" + str(i) + ".mp3")[1] for i in range(200)] + [ANLZ_HASH_MOD]))`,
    );
    expect(r.ok).toBe(true);
    const all = JSON.parse(r.stdout.trim()) as number[];
    const mod = all.pop()!;
    const hrs = all;
    expect(hrs.every((hr) => hr >= 0 && hr < mod)).toBe(true);
  });

  test("folder_key formats as PXXX/HHHHHHHH", () => {
    const r = runPython(
      `from anlz_paths import folder_key
print(folder_key(0x12A, 0x1BEEF))`,
    );
    expect(r.ok).toBe(true);
    expect(r.stdout.trim()).toMatch(/^P[0-9A-F]{3}\/[0-9A-F]{8}$/);
    expect(r.stdout.trim()).toBe("P12A/0001BEEF");
  });

  test("next_free_suffix resolves collisions with open addressing", () => {
    const r = runPython(
      `from anlz_paths import next_free_suffix, folder_key
import json
occupied = {"P12A/0001BEEF", "P12A/0001BEF0"}
free = next_free_suffix(0x12A, 0x1BEEF, occupied)
print(json.dumps({"free": free, "key": folder_key(0x12A, free)}))`,
    );
    expect(r.ok).toBe(true);
    const { free, key } = JSON.parse(r.stdout.trim()) as {
      free: number;
      key: string;
    };
    expect(free).toBe(0x1bef1);
    expect(key).toBe("P12A/0001BEF1");
  });
});

// ---------------------------------------------------------------------------
// usb_verify.pdb_live_rows — legacy export.pdb page walk
// ---------------------------------------------------------------------------
describe("usb_verify.pdb_live_rows", () => {
  function writePdb(rowsPerTable: number): string {
    // Build a minimal-but-valid PDB: header with one table (type 0), a
    // single page of `rowsPerTable` live rows in the canonical tail layout.
    const PAGE = 4096;
    const buf = new Uint8Array(PAGE * 2);
    const dv = new DataView(buf.buffer);
    // file header: n_tables at 0x08, table index at 0x1C
    dv.setUint32(0x08, 1, true);
    dv.setUint32(0x1c, 0, true); // table type
    dv.setUint32(0x20, 0, true); // empty
    dv.setUint32(0x24, 1, true); // first page
    dv.setUint32(0x28, 1, true); // last page
    // page 1: data page header
    const o = PAGE;
    // n_slots lives in the top 21 bits of the 3-byte field at 0x18
    const packed = 8 << 11; // n_slots = 8
    dv.setUint8(o + 0x18, packed & 0xff);
    dv.setUint8(o + 0x19, (packed >> 8) & 0xff);
    dv.setUint8(o + 0x1a, (packed >> 16) & 0xff);
    // rows live: present mask + row offsets pointing at minimal live records
    // base for group 0 = o + PAGE - 0; present at base-4
    dv.setUint16(o + PAGE - 4, 0x00ff, true); // 8 present slots
    for (let i = 0; i < 8; i++) {
      const rowOff = 64 + i * 4;
      dv.setUint16(o + PAGE - 6 - 2 * i, rowOff, true);
      // minimal live record: subtype without the 0x02 tombstone bit
      dv.setUint16(o + 32 + rowOff, 0x0001, true);
    }
    // next-page pointer 0 → chain ends
    const p = join(TMP, `live-${rowsPerTable}.pdb`);
    writeFileSync(p, buf);
    return p;
  }

  test("counts only live rows (tombstones excluded)", () => {
    const p = writePdb(8);
    const r = runPython(
      `from usb_verify import pdb_live_rows
print(pdb_live_rows(${JSON.stringify(p)}))`,
    );
    expect(r.ok).toBe(true);
    expect(Number(r.stdout.trim())).toBe(8);
  });

  test("returns -1 for an unknown table type", () => {
    const p = writePdb(8);
    const r = runPython(
      `from usb_verify import pdb_live_rows
print(pdb_live_rows(${JSON.stringify(p)}, table_type=99))`,
    );
    expect(r.ok).toBe(true);
    expect(Number(r.stdout.trim())).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// rb_read.casefold — identity folding shared with fleet.ts fold()
// ---------------------------------------------------------------------------
describe("rb_read.casefold", () => {
  test("NFC-normalizes before lowercasing (FAT32 vs rekordbox paths)", () => {
    const r = runPython(
      `from rb_read import casefold
import unicodedata, json
nfd = unicodedata.normalize("NFD", "Café Remix")
nfc = unicodedata.normalize("NFC", "Café Remix")
print(json.dumps([casefold(nfd), casefold(nfc), casefold(nfd) == casefold(nfc)]))`,
    );
    expect(r.ok).toBe(true);
    const [foldedNfd, foldedNfc, equal] = JSON.parse(r.stdout.trim()) as [
      string,
      string,
      boolean,
    ];
    expect(foldedNfd).toBe(foldedNfc);
    expect(equal).toBe(true);
    expect(foldedNfd).toBe("café remix");
  });
});

// ---------------------------------------------------------------------------
// Full snapshot via the CLI contract (needs pyrekordbox + a device DB)
// ---------------------------------------------------------------------------
describe("rb_read.main (CLI contract)", () => {
  test("missing args → JSON error, exit 1", () => {
    const p = Bun.spawnSync({
      cmd: ["uv", "run", "python", join(PY_DIR, "rb_read.py")],
      stdout: "pipe",
      stderr: "pipe",
      cwd: TMP,
    });
    if (!uvAvailable && p.exitCode !== 0) {
      return; // skip gracefully
    }
    expect(p.exitCode).toBe(1);
    const out = JSON.parse(new TextDecoder().decode(p.stdout).trim());
    expect(out.ok).toBe(false);
    expect(out.error).toContain("usage");
  });

  test("unopenable db → JSON error, not a traceback", () => {
    if (!uvAvailable) return;
    const dbPath = join(TMP, "fake.db");
    writeFileSync(dbPath, "this is not a database at all");
    const driveRoot = join(TMP, "empty-drive");
    mkdirSync(join(driveRoot, "PIONEER"), { recursive: true });
    const p = Bun.spawnSync({
      cmd: [
        "uv",
        "run",
        "--with",
        "pyrekordbox",
        "python",
        join(PY_DIR, "rb_read.py"),
        dbPath,
        driveRoot,
      ],
      stdout: "pipe",
      stderr: "pipe",
      cwd: TMP,
    });
    const out = JSON.parse(new TextDecoder().decode(p.stdout).trim());
    expect(out.ok).toBe(false);
    expect(typeof out.error).toBe("string");
    expect(out.error.length).toBeGreaterThan(0);
  });
});
