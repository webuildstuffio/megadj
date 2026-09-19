/**
 * rb-anlz-spike tests — GA-07 harness. Snapshot → mutate fake sidecars →
 * compare: changed/added/removed/identical must come out exact, and a
 * PQTZ-only byte change must be attributable to the grid section.
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { anlzSpike } from "./anlz-spike";
import { buildAnlz, parseAnlzGrid, parseAnlzInventory } from "../fulltags/anlz";
import { tempDir } from "../test-support/testutil";

const t = tempDir("megadj-anlz-spike-test-").rippable();
const TEST_ROOT = t.dir();
const TEST_SPIKE_DIR = join(TEST_ROOT, "baselines");
let mountId = 0;

afterAll(() => t.rippleAll());

function fakeMount(): string {
  const mount = join(TEST_ROOT, `mount-${mountId++}`);
  mkdirSync(join(mount, "PIONEER", "Master", "share", "ANLZ"), {
    recursive: true,
  });
  return mount;
}

function runSpike(
  opts: Omit<Parameters<typeof anlzSpike>[0], "spikeDir">,
): ReturnType<typeof anlzSpike> {
  return anlzSpike({ ...opts, spikeDir: TEST_SPIKE_DIR });
}

const beats = (n: number, startMs = 0) => {
  const step = 60000 / 128;
  return Array.from({ length: n }, (_, i) => ({
    num: (i % 4) + 1,
    bpmx100: 12800,
    timeMs: Math.round(startMs + i * step),
  }));
};

function writeSidecar(mount: string, name: string, bytes: Uint8Array): void {
  writeFileSync(join(mount, "PIONEER", "Master", "share", "ANLZ", name), bytes);
}

describe("anlzSpike", () => {
  test("snapshot records per-file hashes + section inventories", () => {
    const mount = fakeMount();
    writeSidecar(
      mount,
      "ANLZ0000.DAT",
      buildAnlz({ path: "/x", beats: beats(64) }),
    );
    const s = runSpike({
      mount,
      tag: "A",
      mode: "snapshot",
      log: () => {},
    });
    expect(s.ok).toBe(true);
    expect(s.baselinePath?.startsWith(`${TEST_SPIKE_DIR}/`)).toBe(true);
    expect(s.tracked).toBe(1);
    expect(s.undecodable).toBe(0);
    const raw = JSON.parse(readFileSync(s.baselinePath!, "utf8")) as {
      recs: { file: string; sections: { tag: string }[] }[];
    };
    expect(raw.recs[0]!.sections.map((x) => x.tag)).toEqual(["PQTZ"]);
  });

  test("compare: untouched sidecar → identical; edited grid → CHANGED with PQTZ delta", () => {
    const mount = fakeMount();
    writeSidecar(
      mount,
      "ANLZ0000.DAT",
      buildAnlz({ path: "/x", beats: beats(64) }),
    );
    runSpike({ mount, tag: "A", mode: "snapshot", log: () => {} });

    // simulate the rekordbox grid nudge: same file, shifted grid (+1 beat)
    writeSidecar(
      mount,
      "ANLZ0000.DAT",
      buildAnlz({ path: "/x", beats: beats(64, Math.round(60000 / 128)) }),
    );
    const c = runSpike({ mount, tag: "A", mode: "compare", log: () => {} });
    expect(c.ok).toBe(true);
    expect(c.identical).toBe(0);
    expect(c.changed).toHaveLength(1);
    expect(c.changed![0]!.sections[0]!.tag).toBe("PQTZ");
    expect(c.changed![0]!.was).not.toBe(c.changed![0]!.now);
  });

  test("compare: added + removed sidecars are listed", () => {
    const mount = fakeMount();
    writeSidecar(
      mount,
      "ANLZ0000.DAT",
      buildAnlz({ path: "/x", beats: beats(8) }),
    );
    runSpike({ mount, tag: "B", mode: "snapshot", log: () => {} });
    // remove one, add another (a fresh analysis pass)
    const dir = join(mount, "PIONEER", "Master", "share", "ANLZ");
    rmSync(join(dir, "ANLZ0000.DAT"));
    writeSidecar(
      mount,
      "ANLZ0001.DAT",
      buildAnlz({ path: "/y", beats: beats(8) }),
    );
    const c = runSpike({ mount, tag: "B", mode: "compare", log: () => {} });
    expect(c.added).toEqual(["collection/ANLZ0001.DAT"]);
    expect(c.removed).toEqual(["collection/ANLZ0000.DAT"]);
  });

  test("compare without a baseline is a visible failure; unmounted too", () => {
    const mount = fakeMount();
    const c = runSpike({ mount, tag: "nope", mode: "compare", log: () => {} });
    expect(c.ok).toBe(false);
    expect(c.error).toMatch(/no baseline/u);
    const s = runSpike({
      mount: join(TEST_ROOT, "never-mounted"),
      tag: "A",
      mode: "snapshot",
      log: () => {},
    });
    expect(s.ok).toBe(false);
    expect(s.error).toMatch(/not mounted/u);
  });

  test("undecodable sidecars are counted, never crashing the scan", () => {
    const mount = fakeMount();
    writeSidecar(mount, "ANLZ0002.DAT", new Uint8Array([1, 2, 3, 4]));
    const s = runSpike({
      mount,
      tag: "C",
      mode: "snapshot",
      log: () => {},
    });
    expect(s.ok).toBe(true);
    expect(s.undecodable).toBe(1);
    expect(s.tracked).toBe(0);
  });

  test("REGRESSION (super-sure Sep 10): nested stick sidecars are walked and keyed by RELATIVE path", () => {
    // Real sticks nest sidecars per track at USBANLZ/<PXXX>/<HHHHHHHH>/ —
    // a flat readdir saw zero files there; and every hash dir names its
    // file ANLZ0000.DAT, so basename keying would false-join tracks.
    const mount = fakeMount();
    const h1 = join(mount, "PIONEER", "USBANLZ", "P001", "0000000A");
    const h2 = join(mount, "PIONEER", "USBANLZ", "P001", "000000FF");
    mkdirSync(h1, { recursive: true });
    mkdirSync(h2, { recursive: true });
    writeFileSync(
      join(h1, "ANLZ0000.DAT"),
      buildAnlz({ path: "/a", beats: beats(8) }),
    );
    writeFileSync(
      join(h2, "ANLZ0000.DAT"),
      buildAnlz({ path: "/b", beats: beats(8) }),
    );
    // one flat shelf sidecar too — both roots in one snapshot
    writeSidecar(
      mount,
      "ANLZ0000.DAT",
      buildAnlz({ path: "/s", beats: beats(8) }),
    );
    const s = runSpike({
      mount,
      tag: "nest",
      mode: "snapshot",
      log: () => {},
    });
    expect(s.ok).toBe(true);
    expect(s.tracked).toBe(3);
    const raw = JSON.parse(readFileSync(s.baselinePath!, "utf8")) as {
      recs: { file: string }[];
    };
    const files = raw.recs.map((r) => r.file).toSorted();
    expect(files).toContain("collection/ANLZ0000.DAT"); // flat, keyed by name
    expect(files).toContain("usb/P001/0000000A/ANLZ0000.DAT"); // relative key
    expect(files).toContain("usb/P001/000000FF/ANLZ0000.DAT");
    // change ONE nested sidecar; the other must NOT join it by basename
    writeFileSync(
      join(h1, "ANLZ0000.DAT"),
      buildAnlz({ path: "/a", beats: beats(8, 1000) }),
    );
    const c = runSpike({
      mount,
      tag: "nest",
      mode: "compare",
      log: () => {},
    });
    expect(c.ok).toBe(true);
    expect(c.changed).toHaveLength(1);
    expect(c.changed![0]!.file).toBe("usb/P001/0000000A/ANLZ0000.DAT");
    expect(c.identical).toBe(2);
  });
});

describe("anlzSpike set-grid (#147 Q4 armament)", () => {
  test.each(["sidecar", "parent", "backup"])(
    "refuses %s symlink before any write",
    (kind) => {
      const mount = fakeMount();
      const outsideDir = t.dir();
      const outside = join(outsideDir, "outside.DAT");
      const original = buildAnlz({ path: "/a", beats: beats(16) });
      const outsideOriginal = buildAnlz({ path: "/outside", beats: beats(12) });
      writeFileSync(outside, outsideOriginal);
      let sidecar = join(mount, "inside.DAT");
      if (kind === "sidecar") symlinkSync(outside, sidecar);
      else if (kind === "parent") {
        symlinkSync(outsideDir, join(mount, "linked"));
        sidecar = join(mount, "linked", "outside.DAT");
      } else {
        writeFileSync(sidecar, original);
        symlinkSync(outside, `${sidecar}.pre-grid-safe`);
      }
      const result = runSpike({
        mount,
        tag: "safe",
        mode: "set-grid",
        file: sidecar,
        beats: beats(8),
        apply: true,
        log: () => {},
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/symlink|escapes the mount/u);
      expect([...readFileSync(outside)]).toEqual([...outsideOriginal]);
      expect([...readFileSync(sidecar)]).toEqual([
        ...(kind === "backup" ? original : outsideOriginal),
      ]);
      if (kind !== "backup")
        expect(existsSync(`${sidecar}.pre-grid-safe`)).toBe(false);
    },
  );

  test("dry run: reports the edit, writes NOTHING, keeps the grid", () => {
    const mount = fakeMount();
    const sidecar = join(
      mount,
      "PIONEER",
      "Master",
      "share",
      "ANLZ",
      "ANLZ0000.DAT",
    );
    writeSidecar(
      mount,
      "ANLZ0000.DAT",
      buildAnlz({ path: "/a", beats: beats(16) }),
    );
    const before = new Uint8Array(readFileSync(sidecar));

    const r = runSpike({
      mount,
      tag: "q4",
      mode: "set-grid",
      file: "collection/ANLZ0000.DAT",
      beats: beats(16, 500), // shifted phase, same count
      log: () => {},
    });
    expect(r.ok).toBe(true);
    expect(r.edited).toBe("collection/ANLZ0000.DAT");
    expect(r.backupPath).toBeUndefined(); // nothing written → no backup
    // byte-for-byte unchanged on disk
    expect([...new Uint8Array(readFileSync(sidecar))]).toEqual([...before]);
  });

  test("apply: writes the new grid, keeps a pre-edit backup, re-verifies", () => {
    const mount = fakeMount();
    const sidecar = join(
      mount,
      "PIONEER",
      "Master",
      "share",
      "ANLZ",
      "ANLZ0000.DAT",
    );
    writeSidecar(
      mount,
      "ANLZ0000.DAT",
      buildAnlz({ path: "/a", beats: beats(16) }),
    );

    const newBeats = beats(16, 500);
    const r = runSpike({
      mount,
      tag: "q4apply",
      mode: "set-grid",
      file: "collection/ANLZ0000.DAT",
      beats: newBeats,
      apply: true,
      log: () => {},
    });
    expect(r.ok).toBe(true);
    expect(r.backupPath).toBeDefined();
    // the backup holds the ORIGINAL bytes
    const backup = new Uint8Array(readFileSync(r.backupPath!));
    expect([...backup]).toEqual([
      ...buildAnlz({ path: "/a", beats: beats(16) }),
    ]);
    // the live file now decodes to EXACTLY the requested grid
    const written = new Uint8Array(readFileSync(sidecar));
    const g = parseAnlzGrid(written);
    expect(g!.beats).toEqual(newBeats);
    // and non-PQTZ section sizes survived
    const inv = parseAnlzInventory(written)!.sections;
    expect(inv.find((s) => s.tag === "PQTZ")!.bytes).toBe(24 + 16 * 8);
    expect(r.wasHash).not.toBeUndefined();
  });

  test("apply on a sidecar whose PQTZ shrinks keeps later sections intact", () => {
    const mount = fakeMount();
    writeSidecar(
      mount,
      "ANLZ0000.DAT",
      buildAnlz({
        path: "/a",
        beats: beats(16),
        extraSections: [{ tag: "PWAV", bytes: 400 }],
      }),
    );
    const r = runSpike({
      mount,
      tag: "q4shrink",
      mode: "set-grid",
      file: "collection/ANLZ0000.DAT",
      beats: beats(8),
      apply: true,
      log: () => {},
    });
    expect(r.ok).toBe(true);
    const sidecar = join(
      mount,
      "PIONEER",
      "Master",
      "share",
      "ANLZ",
      "ANLZ0000.DAT",
    );
    const inv = parseAnlzInventory(
      new Uint8Array(readFileSync(sidecar)),
    )!.sections;
    expect(inv.find((s) => s.tag === "PQTZ")!.bytes).toBe(24 + 8 * 8);
    expect(inv.find((s) => s.tag === "PWAV")!.bytes).toBe(400);
  });

  test("refuses a file that escapes the mount (path traversal)", () => {
    const mount = fakeMount();
    const r = runSpike({
      mount,
      tag: "q4esc",
      mode: "set-grid",
      file: "../../etc/passwd",
      beats: beats(4),
      apply: true,
      log: () => {},
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/escapes the mount/u);
  });

  test("refuses a sidecar with no decodable grid (zero writes)", () => {
    const mount = fakeMount();
    const junk = join(
      mount,
      "PIONEER",
      "Master",
      "share",
      "ANLZ",
      "ANLZ0000.DAT",
    );
    writeFileSync(junk, new TextEncoder().encode("not an anlz"));
    const r = runSpike({
      mount,
      tag: "q4junk",
      mode: "set-grid",
      file: "collection/ANLZ0000.DAT",
      beats: beats(4),
      apply: true,
      log: () => {},
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no decodable PQTZ/u);
  });

  test("missing --file or --beats fails with zero work", () => {
    const mount = fakeMount();
    const noFile = runSpike({
      mount,
      tag: "q4nof",
      mode: "set-grid",
      beats: beats(4),
      log: () => {},
    });
    expect(noFile.ok).toBe(false);
    expect(noFile.error).toMatch(/--file/u);
    const noBeats = runSpike({
      mount,
      tag: "q4nob",
      mode: "set-grid",
      file: "collection/ANLZ0000.DAT",
      log: () => {},
    });
    expect(noBeats.ok).toBe(false);
    expect(noBeats.error).toMatch(/--beats/u);
  });
});
