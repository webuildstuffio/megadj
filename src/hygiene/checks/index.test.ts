import { describe, expect, test } from "bun:test";
import type { CheckCtx, Finding, ShelfFile } from "../types";
import { runChecks } from "./index";

function ctx(over: Partial<CheckCtx> = {}): CheckCtx {
  const md5s = new Map<string, string | null>();
  const fps = new Map<string, string | null>();
  return {
    volume: "/V",
    walkToken: "tok",
    md5: (p) => md5s.get(p) ?? null,
    fp: (p) => fps.get(p) ?? null,
    now: () => "2026-09-10T00:00:00.000Z",
    ...over,
    // keep map-backed lookups injectable: tests seed via the closures below
  };
}

function withMaps(
  md5s: Record<string, string | null>,
  fps: Record<string, string | null>,
  over: Partial<CheckCtx> = {},
): CheckCtx {
  const m = new Map(Object.entries(md5s));
  const f = new Map(Object.entries(fps));
  return {
    volume: "/V",
    walkToken: "tok",
    md5: (p) => m.get(p) ?? null,
    fp: (p) => f.get(p) ?? null,
    now: () => "2026-09-10T00:00:00.000Z",
    ...over,
  };
}

function file(path: string, bytes: number): ShelfFile {
  return { path, bytes, mtimeMs: 0 };
}

describe("byte-twin", () => {
  test("same size + same md5 = safe finding, keeper=shortest path", () => {
    const res = runChecks(
      [
        file("/V/Contents/A/zz.mp3", 100),
        file("/V/Contents/A/a.mp3", 100),
        file("/V/Contents/B/other.mp3", 100), // same size, different md5
        file("/V/Contents/C/unique.mp3", 50),
      ],
      withMaps(
        {
          "/V/Contents/A/zz.mp3": "h1",
          "/V/Contents/A/a.mp3": "h1",
          "/V/Contents/B/other.mp3": "h2",
        },
        {},
      ),
    );
    const twins = res.find((r) => r.kind === "byte-twin")!.findings;
    expect(twins.length).toBe(1);
    const t = twins[0]!;
    expect(t.severity).toBe("safe");
    expect(t.autoSafe).toBe(true);
    expect(t.paths[0]).toBe("/V/Contents/A/a.mp3"); // shortest = keeper
    expect(t.paths[1]).toBe("/V/Contents/A/zz.mp3");
    expect(t.proposedAction).toEqual({ type: "quarantine-loser" });
  });

  test("same size + different md5 is never a byte-twin", () => {
    const res = runChecks(
      [file("/V/a.mp3", 100), file("/V/b.mp3", 100)],
      withMaps({ "/V/a.mp3": "h1", "/V/b.mp3": "h2" }, {}),
    );
    expect(res.find((r) => r.kind === "byte-twin")!.findings).toHaveLength(0);
  });
});

describe("acoustic-twin", () => {
  test("same fp different bytes = likely, human-gated (never autoSafe)", () => {
    // size delta 600/1000 = 40%? no — 1000 vs 850 keeps it under the 15%
    // collision guard so the plain "likely" path is what's tested
    const res = runChecks(
      [file("/V/big.aiff", 1000), file("/V/small.mp3", 900)],
      withMaps({}, { "/V/big.aiff": "fp1", "/V/small.mp3": "fp1" }),
    );
    const twins = res.find((r) => r.kind === "acoustic-twin")!.findings;
    expect(twins.length).toBe(1);
    const t = twins[0]!;
    expect(t.severity).toBe("likely");
    expect(t.autoSafe).toBe(false);
    expect(t.paths[0]).toBe("/V/big.aiff"); // biggest = keeper
    expect(t.fps).toEqual(["fp1", "fp1"]);
  });

  test(">15% size delta flags a review note (fp-collision guard)", () => {
    const res = runChecks(
      [file("/V/x.mp3", 1000), file("/V/y.mp3", 600)],
      withMaps({}, { "/V/x.mp3": "fp9", "/V/y.mp3": "fp9" }),
    );
    const t = res.find((r) => r.kind === "acoustic-twin")!.findings[0]!;
    expect(t.severity).toBe("review");
    expect(JSON.stringify(t.evidence)).toContain("collision");
  });
});

describe("folder-variant", () => {
  test("token-equal artist folders merge-flag, human-gated", () => {
    const res = runChecks(
      [
        file("/V/Contents/Robin S/a.mp3", 10),
        file("/V/Contents/Robin S_/b.mp3", 10),
        file("/V/Contents/ANOTR, 54 Ultra/c.mp3", 10),
        file("/V/Contents/ANOTR x 54 Ultra/d.mp3", 10),
      ],
      ctx(),
    );
    const vars = res.find((r) => r.kind === "folder-variant")!.findings;
    expect(vars.length).toBe(2);
    for (const v of vars) {
      expect(v.autoSafe).toBe(false);
      expect(v.proposedAction.type).toBe("merge-folders");
    }
    const names = vars.map((v) => JSON.stringify(v.proposedAction));
    expect(names.some((n) => n.includes("Robin S"))).toBe(true);
    expect(names.some((n) => n.includes("54 Ultra"))).toBe(true);
  });

  test("different artists with similar names do NOT merge (the Akn/Ama trap)", () => {
    const res = runChecks(
      [
        file("/V/Contents/Cassian/a.mp3", 10),
        file("/V/Contents/Kassian/b.mp3", 10),
      ],
      ctx(),
    );
    expect(res.find((r) => r.kind === "folder-variant")!.findings).toHaveLength(
      0,
    );
  });
});

describe("claimed-set short-circuit", () => {
  test("a byte-twin loser is not re-reported by acoustic-twin", () => {
    const res = runChecks(
      [file("/V/a.mp3", 100), file("/V/b.mp3", 100)],
      withMaps(
        { "/V/a.mp3": "h1", "/V/b.mp3": "h1" },
        { "/V/a.mp3": "fp1", "/V/b.mp3": "fp1" },
      ),
    );
    expect(res.find((r) => r.kind === "byte-twin")!.findings.length).toBe(1);
    expect(res.find((r) => r.kind === "acoustic-twin")!.findings).toHaveLength(
      0,
    );
  });
});

describe("zero-byte + junk", () => {
  test("zero-byte flags human-gated delete-corrupt; junk flags auto-clean", () => {
    const res = runChecks(
      [file("/V/empty.mp3", 0), file("/V/._t.mp3", 12)],
      ctx(),
    );
    const z = res.find((r) => r.kind === "zero-byte")!.findings;
    expect(z.length).toBe(1);
    expect(z[0]!.autoSafe).toBe(false);
    const j = res.find((r) => r.kind === "appledouble-junk")!.findings;
    expect(j.length).toBe(1);
    expect(j[0]!.autoSafe).toBe(true);
  });
});

describe("walkToken stamping", () => {
  test("every finding carries the ctx token (stale-apply abort key)", () => {
    const res = runChecks(
      [file("/V/a.mp3", 100), file("/V/b.mp3", 100)],
      withMaps({ "/V/a.mp3": "h", "/V/b.mp3": "h" }, {}, { walkToken: "tok7" }),
    );
    const all: Finding[] = res.flatMap((r) => r.findings);
    expect(all.length).toBeGreaterThan(0);
    for (const f of all) expect(f.walkToken).toBe("tok7");
  });
});
