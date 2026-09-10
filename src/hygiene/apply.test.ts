import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyFinding, quarantineDest, validateFinding } from "./apply";
import type { CheckCtx, Finding } from "./types";

function vol(): string {
  const v = mkdtempSync("/tmp/megadj-hygiene-apply-");
  return v;
}

function seed(v: string, rel: string, content: string): string {
  const abs = join(v, "Contents", rel);
  mkdirSync(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

function ctx(): CheckCtx {
  return {
    volume: "",
    walkToken: "tok",
    md5: (p) =>
      new Bun.CryptoHasher("md5").update(readFileSync(p)).digest("hex"),
    fp: () => null,
    now: () => "now",
  };
}

function confirmedFinding(keeper: string, loser: string): Finding {
  return {
    id: "f1",
    kind: "byte-twin",
    severity: "safe",
    status: "confirmed",
    paths: [keeper, loser],
    bytes: [3, 3],
    md5s: ["x", "x"],
    fps: [],
    evidence: {},
    proposedAction: { type: "quarantine-loser" },
    keeperPath: keeper,
    walkToken: "tok",
    autoSafe: true,
    createdAt: "t",
    decidedAt: "t",
    appliedAt: null,
    validation: null,
  };
}

describe("applyFinding", () => {
  test("moves a confirmed byte-twin loser into the quarantine, keeper stays", () => {
    const v = vol();
    const keeper = seed(v, "Artist A/keep.mp3", "abc");
    const loser = seed(v, "Artist B/lose.mp3", "abc");
    const r = applyFinding(confirmedFinding(keeper, loser), v, ctx());
    expect(r.moved).toBe(true);
    expect(loser.startsWith(v)).toBe(true);
    const qDir = join(v, "Contents", ".hygiene-quarantine");
    expect(r.dest?.startsWith(qDir)).toBe(true);
    // flattening preserves provenance
    expect(r.dest).toContain("Artist B · lose.mp3");
  });

  test("refuses unconfirmed findings and missing files", () => {
    const v = vol();
    const keeper = seed(v, "A/k.mp3", "abc");
    const loser = seed(v, "B/l.mp3", "abc");
    const open = confirmedFinding(keeper, loser);
    open.status = "open";
    expect(applyFinding(open, v, ctx()).moved).toBe(false);
    const gone = confirmedFinding(keeper, join(v, "Contents/nope.mp3"));
    expect(applyFinding(gone, v, ctx()).error).toContain("loser gone");
  });

  test("quarantine collision suffixes instead of overwriting", () => {
    const v = vol();
    const qDir = join(v, "Contents", ".hygiene-quarantine");
    mkdirSync(qDir, { recursive: true });
    writeFileSync(join(qDir, "Artist B · lose.mp3"), "prev");
    const dest = quarantineDest(qDir, join(v, "Contents/Artist B/lose.mp3"));
    expect(dest).toContain("lose (2).mp3");
  });
});

describe("validateFinding", () => {
  test("green receipt when the keeper holds and the count delta is 1", () => {
    const v = vol();
    const keeper = seed(v, "A/k.mp3", "abc");
    const loser = seed(v, "B/l.mp3", "abc");
    const f = confirmedFinding(keeper, loser);
    const c = ctx();
    // after the move the loser lives in the quarantine; validate THERE
    const q = seed(v, ".hygiene-quarantine/B · l.mp3", "abc");
    const receipt = validateFinding(f, 10, 9, c, q);
    expect(receipt.ok).toBe(true);
    expect(receipt.shelfDelta).toEqual({
      before: 10,
      after: 9,
      quarantined: 1,
    });
  });

  test("amber receipt when the shelf delta is wrong", () => {
    const v = vol();
    const keeper = seed(v, "A/k.mp3", "abc");
    const loser = seed(v, "B/l.mp3", "abc");
    const f = confirmedFinding(keeper, loser);
    const q = seed(v, ".hygiene-quarantine/B · l.mp3", "abc");
    const receipt = validateFinding(f, 10, 10, ctx(), q);
    expect(receipt.ok).toBe(false);
  });
});
