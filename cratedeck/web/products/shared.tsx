// shared.tsx — the product SSOT for the megadj web dashboard.
//
// megadj is the suite; the three PRODUCTS are its pipeline phases:
//   1. CrateDeck — keep the DJ USB drives honest (health, playlists,
//      verify, parity, fleet)
//   2. GetDat    — fill the archive (download + ingest pipeline)
//   3. FullTags  — enrich the archive (tags, art, keys, beatgrids, mood)
// Each row carries its educational lede (the `ledes` array, DJ-voiced) and
// its accent (`--prod` per canvas + phase chip). PRODUCT_TABS is the one
// table both the header nav strip and the page canvases switch on — a tab
// can't exist on one surface only. Also home to the shared render
// primitives (Verdict banner, ShareBar, Meter, SectionHead).
import type { ComponentChildren } from "preact";
import type { Product } from "../app/router";
import { Icon } from "../ui/icons";

export interface ProductMeta {
  id: Product;
  label: string;
  icon: string;
  /** one-liner (nav strip + page voice) */
  sub: string;
  /** longer tooltip line */
  title: string;
  /** CSS accent for the phase chip / canvas tint (kept in sync with the
   *  canvas --prod map in styles/products.css) */
  color: string;
  /** the pipeline step this product owns, one line */
  phase: string;
}

export interface ProductTab {
  id: string;
  label: string;
  icon: string;
  title: string;
}

/** The suite, in reading order = pipeline order. App's header nav renders
 *  from this; the route parser (router.ts) owns the Product union. */
export const PRODUCTS: ProductMeta[] = [
  {
    id: "drives",
    label: "CrateDeck",
    icon: "usb",
    sub: "the DJ USB sticks + their fleet — health, playlists, verify, parity",
    title:
      "CrateDeck — the DJ USB sticks and their fleet: health, playlists, verify, parity",
    color: "var(--accent)",
    phase: "the drives stay honest",
  },
  {
    id: "getdat",
    label: "GetDat",
    icon: "download",
    sub: "the download pipeline — archive what's playable, work the backlog",
    title:
      "GetDat — the download pipeline: archive status, backlog, sources, library",
    color: "var(--info)",
    phase: "the archive gets filled",
  },
  {
    id: "fulltags",
    label: "FullTags",
    icon: "sliders",
    sub: "the enrichment engine — beatgrids, mood, cues, tags",
    title: "FullTags — the enrichment engine: beatgrids, mood, cues, tags",
    color: "var(--pulse)",
    phase: "the archive gets enriched",
  },
];

/** Educational one-liners, in pipeline order — the sentence that teaches a
 *  first-time reader what megadj IS. Rendered by the nav strip's phase
 *  chips and the Welcome launcher. DJ-voiced, not doc-voiced. (Fleet
 *  shares CrateDeck's lede — it's a scope, not a phase.) */
export const LEDE: Record<Product, string> = {
  drives:
    "Your gig lives on two sticks. CrateDeck scans every drive's rekordbox library, audits it for the exact failure modes that ruin a set, and tells you what to fix — in plain language.",
  fleet:
    "One drive is a gamble; a fleet is a plan. Coverage, redundancy, diffs, preflight — every cross-drive question answered before the booth asks it.",
  getdat:
    "Tracks start here. GetDat pulls music into the local archive, records every download decision, and keeps the backlog honest so nothing silently disappears.",
  fulltags:
    "Then the archive gets smart. FullTags enriches every track — art, keys, beatgrids, mood, phrase cues — into DB ledgers, and only writes tags when a measured gate passes.",
};

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

/** Raw pipeline statuses → plain language (one table, two readers: the
 *  GetDat library rows and any archive card; keys not listed render
 *  through the fallback). Lives here so page components don't import each
 *  other (a cycle once formed GetDatPage ↔ LibraryTab). */
export const STATUS_LANG: Record<string, string> = {
  downloaded: "in the archive",
  failed: "failed — retryable",
  gone: "gone from source",
  pending: "waiting to download",
  deleted: "removed locally",
  skipped_not_music: "skipped (not music)",
};

/** A drive page's tab strip — lives in the product SSOT next to the other
 *  tab tables (PRODUCT_TABS), so every tab strip in the app has one shape. */
export const DRIVE_TABS = [
  {
    id: "overview",
    label: "Overview",
    icon: "grid",
    title: "Health checks, space usage, DJ metadata at a glance",
  },
  {
    id: "playlists",
    label: "Playlists",
    icon: "disc",
    title: "Browse and search the playlists stored on this drive",
  },
  {
    id: "health",
    label: "Health",
    icon: "pulse",
    title: "Hardware health: speed benchmarks, disk age, capacity history",
  },
  {
    id: "verify",
    label: "Verify",
    icon: "check",
    title: "Deep integrity audit results — databases, files, grids, parity",
  },
  {
    id: "timeline",
    label: "Timeline",
    icon: "history",
    title: "Everything that happened to this drive, newest first",
  },
  {
    id: "photos",
    label: "Photo",
    icon: "photo",
    title: "Pick the cover photo shown on this drive's card",
  },
] as const;

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
  children?: ComponentChildren;
}) {
  return (
    <h3 class="sect">
      <Icon name={props.icon} /> {props.title}
      {props.children}
    </h3>
  );
}

/** ProductIntro — the educational lede band at the top of each product
 *  canvas: phase chip + product voice + scope line. One component, three
 *  products; all copy comes from PRODUCTS/LEDE so the voice can't drift
 *  between pages. */
export function ProductIntro(props: { product: Product; sub: string }) {
  const meta = PRODUCTS.find((p) => p.id === props.product);
  if (!meta) return null;
  const step = PRODUCTS.indexOf(meta) + 1;
  return (
    <div class="pintro" data-prod={props.product}>
      <span class="pintro-chip" title={meta.title}>
        <span class="pintro-step">{step}</span>
        {meta.phase}
      </span>
      <div class="pintro-body">
        <h2>
          <Icon name={meta.icon} size={16} /> {meta.label}
        </h2>
        <p>{props.sub}</p>
      </div>
    </div>
  );
}
