// ProductPage.tsx — the shared chrome for the top-level product canvases
// (GetDat / FullTags / Fleet): the identity header row (glyph chip, name,
// one-liner, tab strip) and the two primitives every tab of every product
// uses — the verdict banner (`.arch-verdict`) and the pipeline pie/legend.
//
// Extracted so the three products can't drift: same classes, same
// TabIntro/InfoTip usage, same copyable-list CTA everywhere. PRODUCTS is
// also the SSOT App's topbar tabs render from — one table, two surfaces,
// zero drift.
import type { ComponentChildren } from "preact";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { navigateProduct, type Product } from "./router";

export const PRODUCTS: {
  id: Product;
  label: string;
  icon: IconName;
  sub: string;
  /** topbar + header tooltip (the one-liner, product voice) */
  title: string;
}[] = [
  {
    id: "drives",
    label: "Drives",
    icon: "usb",
    sub: "the DJ USB sticks — health, playlists, verify, parity",
    title: "The DJ USB sticks — health, playlists, verify, parity",
  },
  {
    id: "getdat",
    label: "GetDat",
    icon: "download",
    sub: "the download pipeline — archive what's playable, work the backlog",
    title:
      "GetDat — the download pipeline: archive status, backlog, sources, library",
  },
  {
    id: "fulltags",
    label: "FullTags",
    icon: "sliders",
    sub: "the enrichment engine — beatgrids, mood, cues, tags",
    title: "FullTags — the enrichment engine: beatgrids, mood, cues, tags",
  },
  {
    id: "fleet",
    label: "Fleet",
    icon: "grid",
    sub: "every drive, cross-checked — coverage, redundancy, diffs, preflight",
    title:
      "Fleet view: cross-drive coverage, playlist redundancy, diffs, the gig-night preflight gate, and the weekly prep digest",
  },
];

export function ProductHead(props: {
  product: Product;
  tab: string;
  tabs: { id: string; label: string; icon: string; title: string }[];
}) {
  const meta = PRODUCTS.find((p) => p.id === props.product)!;
  return (
    <div class="fleet-head">
      <span class="prod-glyph" title={meta.title}>
        <Icon name={meta.icon} size={17} />
      </span>
      <h2>
        <span class="prod-name">{meta.label}</span>
      </h2>
      <span class="fleet-sub">{meta.sub}</span>
      <div class="spacer" />
      <div class="tabs inline">
        {props.tabs.map((t) => (
          <button
            type="button"
            key={t.id}
            class={props.tab === t.id ? "on" : ""}
            onClick={() => navigateProduct(props.product, t.id)}
            title={t.title}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The one-line verdict a human reads before anything else. */
export function Verdict(props: {
  cls: "ok" | "warn" | "bad";
  text: string;
  meta?: string;
}) {
  return (
    <div class={`arch-verdict ${props.cls}`}>
      <Icon name={props.cls === "ok" ? "check" : "warn"} size={15} />
      <span>{props.text}</span>
      {props.meta && <span class="arch-verdict-meta">{props.meta}</span>}
    </div>
  );
}

/** Horizontal segmented share bar + legend (the archive pipeline pie). */
export function ShareBar(props: {
  segs: { n: number; cls: string; label: string; title: string }[];
  total: number;
}) {
  const total = props.total || 1;
  return (
    <>
      <div
        class="arch-pie"
        role="img"
        aria-label={props.segs.map((s) => `${s.label}: ${s.n}`).join(", ")}
      >
        {props.segs
          .filter((s) => s.n > 0)
          .map((s) => (
            <div
              key={s.cls}
              class={`arch-seg ${s.cls}`}
              style={{ width: `${(s.n / total) * 100}%` }}
              title={`${s.title}: ${s.n.toLocaleString()}`}
            />
          ))}
      </div>
      <div class="arch-legend">
        {props.segs
          .filter((s) => s.n > 0)
          .map((s) => (
            <span key={s.cls}>
              <i class={s.cls} /> {s.label} <em>{s.n.toLocaleString()}</em>
            </span>
          ))}
      </div>
    </>
  );
}

/** Simple horizontal meter for 0..cover fractions (analysis coverage). */
export function Meter(props: {
  done: number;
  total: number;
  label: string;
  cls?: string;
}) {
  const pct =
    props.total > 0 ? Math.round((props.done / props.total) * 100) : 0;
  return (
    <div
      class="ft-meter"
      title={`${props.label}: ${props.done}/${props.total} (${pct}%)`}
    >
      <div
        class={`ft-meter-fill ${props.cls ?? ""}`}
        style={{ width: `${pct}%` }}
      />
      <span class="ft-meter-label">
        <b>{pct}%</b> {props.label} · {props.done.toLocaleString()}/
        {props.total.toLocaleString()}
      </span>
    </div>
  );
}

export function SectionHead(props: {
  icon: string;
  title: string;
  children?: ComponentChildren;
}) {
  return (
    <h3 class="sect">
      <Icon name={props.icon} /> {props.title}
      {props.children}
    </h3>
  );
}
