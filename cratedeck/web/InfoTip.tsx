// InfoTip.tsx — the in-app explainer primitives: `InfoTip` (a (?) dot with
// a rich hover/focus card) and `TabIntro` (the one-card "what am I looking
// at" header for a tab). Tooltips are CSS-rendered on hover AND on focus
// (keyboard + touch reachable), positioned above by default.
import { Icon } from "./icons";
import type { JSX } from "preact";

/** A small (?) affordance whose hover card carries a title + body. Render
 *  inline after a heading, stat label, or inside the `help-anchor` row. */
export function InfoTip(props: {
  /** The card headline ("What is a beatgrid?"). */
  title: string;
  /** Card body — plain sentences; line breaks via <br /> if needed. */
  body: string;
  /** Optional "why it matters" footer line, visually emphasized. */
  why?: string;
  align?: "left" | "right";
  below?: boolean;
}) {
  return (
    <span
      class="infotip"
      tabIndex={0}
      role="note"
      aria-label={`${props.title} — ${props.body}`}
    >
      <span class="infotip-dot" aria-hidden>
        <Icon name="dot" size={9} />
      </span>
      <span
        class={`infotip-card ${props.below ? "below" : ""} ${props.align === "right" ? "right" : ""}`}
      >
        <b>{props.title}</b>
        <span>{props.body}</span>
        {props.why && (
          <span class="infotip-why">
            <Icon name="bolt" size={10} /> {props.why}
          </span>
        )}
      </span>
    </span>
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
