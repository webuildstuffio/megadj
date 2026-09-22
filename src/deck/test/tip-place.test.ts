// tip-place.test.ts — the placement engine is the SSOT for "a tooltip can
// always be read": every historical failure mode (clipped by overflow
// ancestors → fixed-position portals; off-screen at the right/top edge →
// flip; taller than the fallback allows → clamp) is asserted here. Derived
// expectations: the card must fit FULLY inside the viewport in every
// scenario, and the preferred placement must win whenever it fits.
// Mutation check: break `fits` or the candidate order and these fail.
import { describe, expect, test } from "bun:test";
import { placeCard, TIP_EDGE, TIP_GAP } from "../web/ui/tipPlace";

const VP = { width: 1440, height: 900 };
const CARD = { width: 290, height: 120 };

/** The one invariant every scenario must satisfy: the returned rect is
 *  fully inside the viewport with the edge margin respected. */
function assertOnScreen(p: { left: number; top: number }, card = CARD) {
  expect(p.left).toBeGreaterThanOrEqual(TIP_EDGE);
  expect(p.top).toBeGreaterThanOrEqual(TIP_EDGE);
  expect(p.left + card.width).toBeLessThanOrEqual(VP.width - TIP_EDGE);
  expect(p.top + card.height).toBeLessThanOrEqual(VP.height - TIP_EDGE);
}

describe("tipPlace.placeCard", () => {
  test("mid-screen anchor gets its requested top placement", () => {
    const anchor = { left: 600, top: 400, width: 15, height: 15 };
    const p = placeCard(anchor, CARD, VP, "top");
    expect(p.place).toBe("top");
    expect(p.top).toBe(anchor.top - TIP_GAP - CARD.height);
    assertOnScreen(p);
  });

  test("top-row anchor flips below (old bug: card poked off-screen upward)", () => {
    const anchor = { left: 600, top: 30, width: 15, height: 15 };
    const p = placeCard(anchor, CARD, VP, "top");
    expect(p.place).toBe("bottom");
    assertOnScreen(p);
  });

  test("bottom-edge anchor keeps top placement (requested side fits)", () => {
    const anchor = { left: 600, top: 800, width: 15, height: 15 };
    const p = placeCard(anchor, CARD, VP, "top");
    expect(p.place).toBe("top");
    assertOnScreen(p);
  });

  test("right-edge anchor flips left when right doesn't fit", () => {
    const anchor = { left: VP.width - 30, top: 400, width: 15, height: 15 };
    const p = placeCard(anchor, CARD, VP, "side");
    expect(p.place).toBe("left");
    assertOnScreen(p);
  });

  test("rail anchor (left edge) prefers side-right and it fits", () => {
    const anchor = { left: 12, top: 300, width: 19, height: 19 };
    const p = placeCard(anchor, CARD, VP, "side");
    expect(p.place).toBe("right");
    expect(p.left).toBe(anchor.left + anchor.width + TIP_GAP);
    assertOnScreen(p);
  });

  test("tiny viewport (clamped fallback) still lands fully on screen", () => {
    const vp = { width: 320, height: 240 };
    const small = { width: 260, height: 160 };
    const anchor = { left: 4, top: 4, width: 15, height: 15 };
    const p = placeCard(anchor, small, vp, "top");
    expect(p.left).toBeGreaterThanOrEqual(TIP_EDGE);
    expect(p.top).toBeGreaterThanOrEqual(TIP_EDGE);
    expect(p.left + small.width).toBeLessThanOrEqual(vp.width - TIP_EDGE);
    expect(p.top + small.height).toBeLessThanOrEqual(vp.height - TIP_EDGE);
  });

  test("card larger than viewport clamps to edge, never negative", () => {
    const vp = { width: 200, height: 100 };
    const huge = { width: 400, height: 300 };
    const anchor = { left: 50, top: 50, width: 15, height: 15 };
    const p = placeCard(anchor, huge, vp, "top");
    expect(p.left).toBe(TIP_EDGE);
    expect(p.top).toBe(TIP_EDGE);
  });

  test("align:right right-edge-aligns top/bottom cards to the anchor", () => {
    const anchor = { left: 1000, top: 400, width: 15, height: 15 };
    const p = placeCard(anchor, CARD, VP, "top", "right");
    expect(p.place).toBe("top");
    expect(p.left).toBe(anchor.left + anchor.width - CARD.width);
    assertOnScreen(p);
  });

  test("align:right near the left edge flips right rather than clamp", () => {
    // anchor so close to the left edge that a right-aligned (or centered)
    // top card would overflow — the side candidate that fits should win
    const anchor = { left: 30, top: 400, width: 15, height: 15 };
    const p = placeCard(anchor, CARD, VP, "top", "right");
    expect(p.place).toBe("right");
    assertOnScreen(p);
  });

  test("fits exactly at the boundary counts as fitting (edge == margin)", () => {
    // anchor top such that the top-placed card's top lands exactly on TIP_EDGE
    const anchor = {
      left: 600,
      top: TIP_EDGE + TIP_GAP + CARD.height,
      width: 15,
      height: 15,
    };
    const p = placeCard(anchor, CARD, VP, "top");
    expect(p.place).toBe("top");
    expect(p.top).toBe(TIP_EDGE);
  });
});
