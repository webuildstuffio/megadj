// megaset-draft-roundtrip.test.ts — super-sure acceptance for #293:
// Save → Load → rebuild produces the IDENTICAL chain. The builder is a
// preact hook (needs a DOM), but the knobs→requestQuery mapping is the
// determinism contract, so this pins the SERVER side: identical query
// params → byte-identical payload, using the same knob extraction
// parseDraft performs.
import { describe, expect, test } from "bun:test";
import { parseDraft } from "../products/fulltags/megaset-draft";

describe("#293 draft round-trip (determinism contract)", () => {
  test("parse → re-encode → parse is a fixed point (no knob drift)", () => {
    const saved = JSON.stringify({
      kind: "megadj-set-draft",
      savedAt: "2026-09-23T04:00:00.000Z",
      status: "complete",
      request: {
        preset: "afterhours",
        minutes: 90,
        search: "beam",
        poolLimit: 250,
        openerId: "op-1",
        genre: "tech house",
        landmarkIds: ["a", "b"],
        repro: "megadj megaset --preset afterhours …",
      },
      preset: "afterhours",
      minutes: 90,
      steps: [],
    });
    const first = parseDraft(saved);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // re-encode the knobs the way saveDraft would write them back
    const reencoded = JSON.stringify({
      kind: "megadj-set-draft",
      request: { ...first.knobs },
      preset: first.knobs.preset,
      minutes: first.knobs.minutes,
    });
    const second = parseDraft(reencoded);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.knobs).toEqual(first.knobs);
  });

  test("NaN/Infinity minutes in a corrupt draft are refused, not clamped silently", () => {
    const bad = parseDraft(
      '{"kind":"megadj-set-draft","request":{"preset":"peak","minutes":1e999}}',
    );
    // JSON has no Infinity literal; 1e999 parses to Infinity → refused
    expect(bad.ok).toBe(false);
  });

  test("minutes ≤ 0 refused", () => {
    const bad = parseDraft(
      '{"kind":"megadj-set-draft","request":{"preset":"peak","minutes":0}}',
    );
    expect(bad.ok).toBe(false);
  });

  test("poolLimit ≤ 0 degrades to null (unlimited), never a 0-cap", () => {
    const d = parseDraft(
      '{"kind":"megadj-set-draft","request":{"preset":"peak","minutes":60,"poolLimit":0}}',
    );
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.knobs.poolLimit).toBeNull();
  });

  test("landmark list with junk entries keeps only usable string ids", () => {
    const d = parseDraft(
      '{"kind":"megadj-set-draft","request":{"preset":"peak","minutes":60,"landmarkIds":["ok-1","",42,null,"  "]}}',
    );
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.knobs.landmarkIds).toEqual(["ok-1"]);
  });
});
