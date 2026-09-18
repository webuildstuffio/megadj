// product-meta.tsx — the megadj product SSOT (#89/#90 page-skeleton
// pass; extracted from products/shared.tsx).
//
// megadj is the suite; the four PRODUCTS are its pipeline phases:
//   1. CrateDeck — keep the DJ USB drives honest (health, playlists,
//      verify, parity, fleet)
//   2. GetDat    — fill the archive (download + ingest pipeline)
//   3. FullTags  — enrich the archive (tags, art, keys, beatgrids, mood)
//   4. MegaSet   — play it: order the shelf into a mixable draft
// Each row carries its educational lede (DJ-voiced) and its accent (the
// [data-prod] CSS rules + per-product tokens in styles/).
// PRODUCT_TABS is the one table both the header nav strip and the page
// canvases switch on — a tab can't exist on one surface only.
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
  /** the pipeline step this product owns, one line */
  phase: string;
  // (accent lives in CSS — the `[data-prod]` rules + the `--set` token;
  // a hex field here went unwritten when MegaSet landed and was retired.)
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
    phase: "the drives stay honest",
  },
  {
    id: "getdat",
    label: "GetDat",
    icon: "download",
    sub: "the download pipeline — archive what's playable, work the backlog",
    title:
      "GetDat — the download pipeline: archive status, backlog, sources, library",
    phase: "the archive gets filled",
  },
  {
    id: "fulltags",
    label: "FullTags",
    icon: "sliders",
    sub: "the enrichment engine — beatgrids, mood, cues, tags",
    title: "FullTags — the enrichment engine: beatgrids, mood, cues, tags",
    phase: "the archive gets enriched",
  },
  {
    id: "megaset",
    label: "MegaSet",
    icon: "compass",
    sub: "the mix builder — order the whole analyzed shelf into a playable set",
    title:
      "MegaSet — build an ordered mix proposal from the whole analyzed shelf: energy arc, length, sequencer",
    phase: "the library gets played",
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
  megaset:
    "The payoff. MegaSet turns every measurement — tempo, key, mood, energy — into an ordered, mixable draft of your whole shelf. You approve it; nothing writes behind your back.",
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
      id: "radar",
      label: "Radar",
      icon: "download",
      title: "The new-music radar: archived tracks not on each drive yet",
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
      id: "booth",
      label: "Booth",
      icon: "sliders",
      title:
        "Which players your checks enforce — pick the fleet, see the proof",
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
      id: "intake",
      label: "Intake",
      icon: "download",
      title: "Process a dump folder: tags, artwork, dedupe, verify — live",
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
      id: "run",
      label: "Run",
      icon: "pulse",
      title:
        "The live enrichment run: the genre vote ladder deciding track by track — votes, elections, rung tally, streaming in as it works",
    },
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
      id: "similar",
      label: "Similar",
      icon: "grid",
      title: "I49 sounds-like: nearest tracks by audio embedding similarity",
    },
    {
      id: "genre-why",
      label: "Genre Why",
      icon: "info",
      title:
        "#215 genre explainability: the vote ladder's per-rung breakdown for one track",
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
  megaset: [
    {
      id: "build",
      label: "Build",
      icon: "compass",
      title:
        "Build an ordered mix proposal from the whole analyzed shelf — energy arc, length, sequencer",
    },
  ],
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
  {
    id: "hygiene",
    label: "Hygiene",
    icon: "warn",
    title: "Duplicate + junk findings on the shelf — review, confirm, apply",
  },
  {
    id: "fixes",
    label: "Fixes",
    icon: "bolt",
    title:
      "Booth compatibility fixes — audit, rename, retag against your fleet",
  },
] as const;

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
