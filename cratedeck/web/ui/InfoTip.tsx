// InfoTip.tsx — the in-app explainer primitives: `InfoTip` (a (?) dot with
// a rich hover/focus card) and `TabIntro` (the one-card "what am I looking
// at" header for a tab). The card is the shared portal primitive (ui/
// TipCard.tsx): document.body + position:fixed + viewport-aware placement —
// the old CSS-only card was clipped by overflow ancestors and off-screen at
// edges; now no ancestor can clip it and it always fully fits on screen.
import type { JSX } from "preact";
import { Icon } from "./icons";
import { Tip } from "./TipCard";
import type { TipRequest } from "./tipPlace";

/** A small (?) affordance whose hover card carries a title + body. Render
 *  inline after a heading, stat label, or inside the `help-anchor` row.
 *  `side` requests the card open to the RIGHT of the dot — the preference
 *  for the drive rail and other screen-edge contexts; the placement engine
 *  flips/clamps if that doesn't fit. `below` requests below. `children`
 *  replaces the default (?) dot with a custom hover target (a health ring,
 *  a badge) — the card behavior is identical. */
export function InfoTip(props: {
  /** The card headline ("What is a beatgrid?"). */
  title: string;
  /** Card body — plain sentences; line breaks via <br /> if needed. */
  body: string;
  /** Optional "why it matters" footer line, visually emphasized. */
  why?: string | undefined;
  align?: "left" | "right" | undefined;
  below?: boolean | undefined;
  side?: boolean | undefined;
  children?: preact.JSX.Element | undefined;
}) {
  const request: TipRequest = props.side
    ? "side"
    : props.below
      ? "bottom"
      : "top";
  return (
    <Tip
      title={props.title}
      body={props.body}
      why={props.why}
      request={request}
      align={props.align}
      class={`infotip ${props.children ? "has-target" : ""}`}
      ariaLabel={`${props.title} — ${props.body}`}
    >
      {props.children ?? (
        <span class="infotip-dot" aria-hidden>
          <Icon name="dot" size={9} />
        </span>
      )}
    </Tip>
  );
}

/** The one-card explainer at the top of a tab: what this tab is for, how
 *  to read it, and where to go next. A native <details> — click the
 *  summary line to expand; no state, no persistence (tabs remount anyway). */
export function TabIntro(props: {
  what: string;
  how: string;
  next?: JSX.Element | string;
}) {
  return (
    <details class="tabintro">
      <summary>
        <Icon name="info" size={13} />
        <b>{props.what}</b>
        <span class="tabintro-hint">hover or tap for how to read this</span>
      </summary>
      <div class="tabintro-body">
        <p>{props.how}</p>
        {props.next && <p class="tabintro-next">{props.next}</p>}
      </div>
    </details>
  );
}
