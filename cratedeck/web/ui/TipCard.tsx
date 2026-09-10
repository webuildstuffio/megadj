// TipCard.tsx — the ONE portal-rendered hover card. Every tooltip producer
// (InfoTip dots, GlossTerm chips, the welcome demo) opens this card: it
// portals to document.body with position:fixed coordinates computed per-open
// by ui/tipPlace.ts. The old CSS-only cards (position:absolute inside the
// anchor) were clipped by every overflow:hidden/auto ancestor (rail, canvas,
// datatables, cards) and overflowed the viewport near edges and the top row
// — portals escape all of that, and the placement math flips/clamps so the
// card is always fully on screen. Hover AND focus (keyboard reachable).
import { createPortal } from "preact/compat";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Icon } from "./icons";
import { placeCard, type TipRequest } from "./tipPlace";

/** The hover card wrapped around `children` (the anchor). Portal-rendered
 *  while hovered/focused; placement prefers `request` and never leaves the
 *  viewport (tipPlace.ts: flip → clamp). `align: "right"` right-edge-aligns
 *  the card to the anchor on top/bottom placements — the intent of the old
 *  CSS `.right` variant for near-right-edge sites. */
export function Tip(props: {
  title: string;
  body: string;
  why?: string;
  /** Preferred opening: above (default), below, or beside (side). */
  request?: TipRequest;
  /** Right-edge-align the card to the anchor (near-right-edge sites). */
  align?: "left" | "right";
  /** Classes for the anchor span (`.infotip`, `.gloss`, …). */
  class?: string;
  ariaLabel?: string;
  children: ComponentChildren;
}) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; place: string }>({
    left: 0,
    top: 0,
    place: "top",
  });

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    const card = cardRef.current;
    if (!anchor || !card) return;
    const ar = anchor.getBoundingClientRect();
    // Measure at an offscreen fixed position with the card's own width so
    // the wrap count (and thus height) matches what will actually render.
    card.style.visibility = "hidden";
    card.style.left = "-9999px";
    card.style.top = "0px";
    card.style.position = "fixed";
    const cr = card.getBoundingClientRect();
    const placed = placeCard(
      { left: ar.left, top: ar.top, width: ar.width, height: ar.height },
      { width: cr.width, height: cr.height },
      { width: window.innerWidth, height: window.innerHeight },
      props.request ?? "top",
      props.align,
    );
    setPos({ left: placed.left, top: placed.top, place: placed.place });
  }, [props.request, props.align]);

  useLayoutEffect(() => {
    if (open) measure();
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => measure();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, measure]);

  const close = useCallback(() => setOpen(false), []);

  const card = (
    <div
      class="infotip-card"
      ref={cardRef}
      data-place={pos.place}
      role="tooltip"
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
    >
      <b>{props.title}</b>
      <span>{props.body}</span>
      {props.why && (
        <span class="infotip-why">
          <Icon name="bolt" size={10} /> {props.why}
        </span>
      )}
    </div>
  );

  return (
    <span
      ref={anchorRef}
      class={props.class}
      role="note"
      aria-label={props.ariaLabel ?? `${props.title} — ${props.body}`}
      tabIndex={0}
      onPointerEnter={() => setOpen(true)}
      onFocus={() => setOpen(true)}
      onBlur={close}
      onPointerLeave={close}
    >
      {props.children}
      {open && createPortal(card, document.body)}
    </span>
  );
}
