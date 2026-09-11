/**
 * rb-anlz-spike tests — GA-07 harness. Snapshot → mutate fake sidecars →
 * compare: changed/added/removed/identical must come out exact, and a
 * PQTZ-only byte change must be attributable to the grid section.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { anlzSpike } from "./anlz-spike";
import { buildAnlz } from "../../fulltags/src/anlz";

function fakeMount(): string {
  const mount = mkdtempSync("/tmp/megadj-spike-");
  mkdirSync(join(mount, "PIONEER", "Master", "share", "ANLZ"), {
    recursive: true,
  });
  return mount;
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
    const s = anlzSpike({
      mount,
      tag: "A",
      mode: "snapshot",
      log: () => {},
    });
    expect(s.ok).toBe(true);
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
    anlzSpike({ mount, tag: "A", mode: "snapshot", log: () => {} });

    // simulate the rekordbox grid nudge: same file, shifted grid (+1 beat)
    writeSidecar(
      mount,
      "ANLZ0000.DAT",
      buildAnlz({ path: "/x", beats: beats(64, Math.round(60000 / 128)) }),
    );
    const c = anlzSpike({ mount, tag: "A", mode: "compare", log: () => {} });
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
    anlzSpike({ mount, tag: "B", mode: "snapshot", log: () => {} });
    // remove one, add another (a fresh analysis pass)
    const dir = join(mount, "PIONEER", "Master", "share", "ANLZ");
    const { rmSync } = require("node:fs") as typeof import("node:fs");
    rmSync(join(dir, "ANLZ0000.DAT"));
    writeSidecar(
      mount,
      "ANLZ0001.DAT",
      buildAnlz({ path: "/y", beats: beats(8) }),
    );
    const c = anlzSpike({ mount, tag: "B", mode: "compare", log: () => {} });
    expect(c.added).toEqual(["collection/ANLZ0001.DAT"]);
    expect(c.removed).toEqual(["collection/ANLZ0000.DAT"]);
  });

  test("compare without a baseline is a visible failure; unmounted too", () => {
    const mount = fakeMount();
    const c = anlzSpike({ mount, tag: "nope", mode: "compare", log: () => {} });
    expect(c.ok).toBe(false);
    expect(c.error).toMatch(/no baseline/u);
    const s = anlzSpike({
      mount: "/tmp/never-mounted",
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
    const s = anlzSpike({
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
    const s = anlzSpike({
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
    const c = anlzSpike({ mount, tag: "nest", mode: "compare", log: () => {} });
    expect(c.ok).toBe(true);
    expect(c.changed).toHaveLength(1);
    expect(c.changed![0]!.file).toBe("usb/P001/0000000A/ANLZ0000.DAT");
    expect(c.identical).toBe(2);
  });
});
