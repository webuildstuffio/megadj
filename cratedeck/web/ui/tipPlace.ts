// tipPlace.ts — viewport-aware placement math for hover cards. The old
// CSS-only cards (`position: absolute` inside `position: relative`) were
// clipped by every `overflow` ancestor (rail, canvas, datatables, cards)
// and overflowed the viewport near edges and the top row. Cards now render
// in a portal to `document.body` with `position: fixed` and coordinates
// computed HERE, so no ancestor can clip them and they always fit on
// screen: flip below/side when the preferred spot doesn't fit, clamp the
// fallback inside the viewport. Pure and DOM-free so tests can exercise it.

export type TipRequest = "top" | "bottom" | "side";
export type TipPlace = "top" | "bottom" | "right" | "left";

export interface TipRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TipViewport {
  width: number;
  height: number;
}

export interface TipPlacement {
  left: number;
  top: number;
  place: TipPlace;
}

/** Min distance the card keeps from the viewport edge. */
export const TIP_EDGE = 8;
/** Gap between the anchor and the card. */
export const TIP_GAP = 8;

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Horizontal offset for top/bottom placements: centered by default, or
 *  right-edge-aligned to the anchor (`align: "right"` — the near-right-edge
 *  sites; the old CSS `.right` variant's intent). */
function alignLeft(
  anchor: TipRect,
  card: { width: number },
  place: TipPlace,
  align?: "left" | "right",
): number {
  const centered = anchor.left + anchor.width / 2 - card.width / 2;
  if (place !== "top" && place !== "bottom") return centered;
  if (align === "right") return anchor.left + anchor.width - card.width;
  return centered;
}

/** Candidate placement WITHOUT clamping — fit-testing uses the raw
 *  position so "clamped until it happens to fit" can't fake a pass. */
function rawPlacement(
  anchor: TipRect,
  card: { width: number; height: number },
  place: TipPlace,
  align?: "left" | "right",
): TipPlacement {
  if (place === "top" || place === "bottom") {
    return {
      left: alignLeft(anchor, card, place, align),
      top:
        place === "top"
          ? anchor.top - TIP_GAP - card.height
          : anchor.top + anchor.height + TIP_GAP,
      place,
    };
  }
  return {
    left:
      place === "right"
        ? anchor.left + anchor.width + TIP_GAP
        : anchor.left - TIP_GAP - card.width,
    top: anchor.top + anchor.height / 2 - card.height / 2,
    place,
  };
}

/** Clamp any raw placement fully inside the viewport. */
function clamped(
  p: TipPlacement,
  card: { width: number; height: number },
  vp: TipViewport,
): TipPlacement {
  return {
    left: clamp(p.left, TIP_EDGE, vp.width - TIP_EDGE - card.width),
    top: clamp(p.top, TIP_EDGE, vp.height - TIP_EDGE - card.height),
    place: p.place,
  };
}

function fits(
  p: TipPlacement,
  card: { width: number; height: number },
  vp: TipViewport,
): boolean {
  return (
    p.left >= TIP_EDGE &&
    p.top >= TIP_EDGE &&
    p.left + card.width <= vp.width - TIP_EDGE &&
    p.top + card.height <= vp.height - TIP_EDGE
  );
}

/** Where to put the card for this anchor, in fixed-position coordinates.
 *  Tries the requested side first (aligned variant before centered), then
 *  the other candidates in preference order; the first placement that fully
 *  fits on screen wins, and the requested one (clamped) is the guaranteed-
 *  on-screen fallback. */
export function placeCard(
  anchor: TipRect,
  card: { width: number; height: number },
  vp: TipViewport,
  request: TipRequest = "top",
  align?: "left" | "right",
): TipPlacement {
  const order: Record<TipRequest, TipPlace[]> = {
    top: ["top", "bottom", "right", "left"],
    bottom: ["bottom", "top", "right", "left"],
    side: ["right", "left", "bottom", "top"],
  };
  const candidates: TipPlacement[] = [];
  for (const place of order[request]) {
    // aligned variant first (the caller's stated intent), then centered
    if (align && (place === "top" || place === "bottom")) {
      candidates.push(rawPlacement(anchor, card, place, align));
    }
    candidates.push(rawPlacement(anchor, card, place));
  }
  const fitting = candidates.find((p) => fits(p, card, vp));
  return fitting ? fitting : clamped(candidates[0]!, card, vp);
}
