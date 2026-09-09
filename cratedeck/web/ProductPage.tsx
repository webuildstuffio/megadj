// ProductPage.tsx — the product SSOT: PRODUCTS (the suite the megadj
// dashboard covers) + PRODUCT_TABS (each product's tab strip — one table,
// two surfaces: the header nav strip and the page canvases read the same
// rows, so a tab can't exist on one surface only). Also home to the two
// render primitives every product tab shares: the verdict banner and the
// pipeline pie/legend.
//
// The three named sub-products (docs/PRINCIPLES.md / FEATURES.md):
//   CrateDeck — the DJ USB drives + their fleet (this dashboard's origin)
//   GetDat    — the download + ingest pipeline into the archive
//   FullTags  — the enrichment engine (analysis ledgers + tag mirror)
// Fleet is NOT a product — it's CrateDeck's cross-drive scope, so it lives
// as a sibling scope tab of the individual drives inside CrateDeck's group.
import type { Product } from "./router";

export interface ProductMeta {
  id: Product;
  label: string;
  icon: string;
  /** one-liner (nav strip + page voice) */
  sub: string;
  /** longer tooltip line */
  title: string;
}

export interface ProductTab {
  id: string;
  label: string;
  icon: string;
  title: string;
}

/** The suite, in reading order. App's header nav renders from this; the
 *  route parser (router.ts) owns the matching Product union. */
export const PRODUCTS: ProductMeta[] = [
  {
    id: "drives",
    label: "CrateDeck",
    icon: "usb",
    sub: "the DJ USB sticks + their fleet — health, playlists, verify, parity",
    title:
      "CrateDeck — the DJ USB sticks and their fleet: health, playlists, verify, parity",
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
];

/** Tab strip per product — the same rows the pages AND the header nav
 *  strip switch on, so a tab can't exist on one surface only.
 *  - "drives": CrateDeck's scope tabs — the crate shelf (id "" = no drive
 *    selected) and Fleet, its cross-drive scope.
 *  - "fleet": Fleet's own content tabs (FleetPage switches on these; the
 *    header shows them while the Fleet route is active).
 *  - getdat / fulltags: their content tabs. */
export const PRODUCT_TABS: Record<Product, ProductTab[]> = {
  drives: [
    {
      id: "",
      label: "Drives",
      icon: "usb",
      title:
        "The crate shelf — every drive with its health ring, plug in and go",
    },
    {
      id: "fleet",
      label: "Fleet",
      icon: "grid",
      title:
        "Fleet view: cross-drive coverage, playlist redundancy, diffs, the gig-night preflight gate, and the weekly prep digest",
    },
  ],
  fleet: [
    {
      id: "coverage",
      label: "Coverage",
      icon: "grid",
      title: "Which stick has this track — and the at-risk single-copy list",
    },
    {
      id: "redundancy",
      label: "Redundancy",
      icon: "shield",
      title:
        "Per-playlist audit: is every track on enough drives to survive one dying?",
    },
    {
      id: "diff",
      label: "Diff",
      icon: "sort",
      title: "Two drives side by side: added, removed, changed",
    },
    {
      id: "preflight",
      label: "Preflight",
      icon: "bolt",
      title: "Gig-night gate: is every drive ready to play right now?",
    },
    {
      id: "archive",
      label: "Archive",
      icon: "doc",
      title: "The local archive: ingest queue, analysis state, integrity",
    },
    {
      id: "prep",
      label: "Prep",
      icon: "doc",
      title: "Weekly prep digest — everything worth knowing, one page",
    },
  ],
  getdat: [
    {
      id: "pipeline",
      label: "Pipeline",
      icon: "refresh",
      title: "The download machine: buckets, recent runs, throughput",
    },
    {
      id: "backlog",
      label: "Backlog",
      icon: "warn",
      title: "What needs work: retries and quality upgrades",
    },
    {
      id: "sources",
      label: "Sources",
      icon: "compass",
      title: "Where the archive's music comes from",
    },
    {
      id: "library",
      label: "Library",
      icon: "disc",
      title: "What's in the archive — searchable, newest first",
    },
  ],
  fulltags: [
    {
      id: "beatgrids",
      label: "Beatgrids",
      icon: "pulse",
      title: "The beats ledger + the independent grid cross-check vs rekordbox",
    },
    {
      id: "mood",
      label: "Mood",
      icon: "bolt",
      title: "The mood ledger: dance/valence/arousal averages and extremes",
    },
    {
      id: "cues",
      label: "Cues",
      icon: "play",
      title: "The phrase-cue ledger: 8-bar markers derived from downbeats",
    },
    {
      id: "tags",
      label: "Tags",
      icon: "tag",
      title:
        "The tag mirror: genres, years, artwork, energy — file ground truth",
    },
  ],
};

import { Icon } from "./icons";

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
        <b>{pct}%</b> {props.label && `${props.label} · `}
        {props.done.toLocaleString()}/{props.total.toLocaleString()}
      </span>
    </div>
  );
}

export function SectionHead(props: {
  icon: string;
  title: string;
  children?: import("preact").ComponentChildren;
}) {
  return (
    <h3 class="sect">
      <Icon name={props.icon} /> {props.title}
      {props.children}
    </h3>
  );
}
