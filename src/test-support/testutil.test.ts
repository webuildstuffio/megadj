/**
 * testutil.test.ts — pins the #248 fixture seam: tempDir's lifecycle
 * contract (fresh dir per call, ripple disposal, idempotent rippleAll)
 * and tempState's DB wiring, using prefixes that tmp-purge already owns.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tempDir, tempState } from "./testutil";

describe("tempDir (#248 fixture seam)", () => {
  test("each dir() call makes a fresh, existing, prefix-matching dir", () => {
    const t = tempDir("megadj-testutil-a-");
    const a = t.dir();
    const b = t.dir();
    expect(a).not.toBe(b);
    expect(existsSync(a)).toBe(true);
    expect(a.startsWith(join(tmpdir(), "megadj-testutil-a-"))).toBe(true);
    t.rippleAll();
    expect(existsSync(a)).toBe(false);
    expect(existsSync(b)).toBe(false);
  });

  test("rippleAll is idempotent and dispose removes one dir", () => {
    const t = tempDir("megadj-testutil-b-");
    const a = t.dir();
    t.rippable().rippleAll();
    expect(existsSync(a)).toBe(false);
    expect(() => t.rippleAll()).not.toThrow(); // second sweep: no-op
    const b = t.dir();
    t.dispose(b);
    expect(existsSync(b)).toBe(false);
  });

  test("rippleAll removes nested content (force:true), not just the dir", () => {
    const { writeFileSync, mkdirSync } = require("node:fs") as {
      writeFileSync: (p: string, d: string) => void;
      mkdirSync: (p: string) => void;
    };
    const t = tempDir("megadj-testutil-c-");
    const dir = t.dir();
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "nested", "f.txt"), "x");
    t.rippleAll();
    expect(existsSync(dir)).toBe(false);
  });

  test("tempState wires an archive.db next to dir and done() closes+removes", () => {
    const ts = tempState("megadj-testutil-state-");
    const s = ts.next();
    expect(existsSync(join(s.dir, "archive.db"))).toBe(true);
    // a write proves the DB is live, not just a path
    s.state.setMoodRecord({
      videoId: "testutil-pin",
      dance: 0.5,
      aggressive: 0.1,
      happy: 0.6,
      electronic: 0.9,
      party: 0.7,
      valence: 0.5,
      arousal: 0.6,
      sourcePath: join(s.dir, "a.mp3"),
    });
    expect(s.state.moodRecord("testutil-pin")).not.toBeNull();
    ts.done(s);
    expect(existsSync(s.dir)).toBe(false);
  });
});
