// index.tsx — the shared render primitives for the megadj web product
// pages (Verdict banner, ShareBar, Meter, SectionHead, TrackTitle, the
// GetDat/archive language tables, ArchiveAbsentGate). The bigger shared
// families live beside this barrel in the same shared/ dir (#242
// re-home; #89/#90 page-skeleton pass did the original split):
//   product-meta.tsx — PRODUCTS/LEDE/PRODUCT_TABS/DRIVE_TABS SSOT +
//                      ProductIntro (the nav/page switch tables)
//   scan-apply.tsx   — useScanApply + ScanApplyGate/ScanApplyActions
//                      (the Hygiene/Fixes job-remote scaffold)
//   beat-sync.tsx    — the grid-cross-check breaker cluster
//                      (GridBreaker → BeatSyncBreakersCard)
// Everything re-exports through this barrel so page imports stay one
// seam — pages import from "../shared" (or "../products/shared"), NEVER
// from a member module directly; the products-shared-dir census pins
// that (the one violation, ArchiveTabSections's type import, was routed
// through the seam in #242).
import type { ComponentChildren } from "preact";
import { Icon } from "../../ui/icons";

export {
  DRIVE_TABS,
  LEDE,
  PRODUCTS,
  PRODUCT_TABS,
  ProductIntro,
} from "./product-meta";
export type { GridBreaker } from "./beat-sync";
export { ScanApplyActions, ScanApplyGate, useScanApply } from "./scan-apply";
export { collectBreakers, BeatSyncBreakersCard } from "./beat-sync";

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

/** Mood average keys → the gloss that says which end is which (0–1 heads
 *  vs 1–9 VA). One copy — ArchiveTab and FullTagsPage's MoodTab both render
 *  the averages and had drifted-able duplicates. */
export const MOOD_GLOSS: Record<string, string> = {
  dance: "0–1 · how danceable",
  valence: "1–9 · sad → happy",
  arousal: "1–9 · calm → intense",
  party: "0–1 · party vibe",
  electronic: "0–1 · electronic vibe",
  aggressive: "0–1 · aggressive vibe",
};

/** ArchiveAbsentGate — the "archive DB absent" note-card every GetDat
 *  tab (and every future archive-DB page) shows when `available` is
 *  false. One card, one copy string — the 4 hand-rolled clones in
 *  GetDatPage/LibraryTab were byte-identical except for which flags
 *  gated them (issue #90 item 2). */
export function ArchiveAbsentGate() {
  return (
    <div class="note-card">
      <Icon name="folder" size={20} /> archive DB absent — megadj hasn't run on
      this machine yet.
    </div>
  );
}

/** The one-line verdict a human reads before anything else. `text` and
 *  `meta` accept nodes (counts, pills, InfoTip, Copy buttons) — every
 *  product page renders its banner through this component now; the hand-
 *  rolled `arch-verdict` divs were retired in the #89/#90 skeleton pass. */
export function Verdict(props: {
  cls: "ok" | "warn" | "bad";
  /** Node, not just string — counts/pills/InfoTip ride in the meta slot
   *  too (the reason 5+ pages kept hand-rolling the div). */
  text?: ComponentChildren;
  meta?: ComponentChildren;
  /** icon override (default check/warn by cls) */
  icon?: string;
}) {
  return (
    <div class={`arch-verdict ${props.cls}`}>
      <Icon
        name={props.icon ?? (props.cls === "ok" ? "check" : "warn")}
        size={15}
      />
      {props.text !== null && props.text !== undefined && (
        <span>{props.text}</span>
      )}
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

/** TrackTitle — the "title — artist" lead fragment every track row uses.
 *  Falls back to video_id when the title is missing; artist is optional.
 *  One component so the row styling can't drift between product pages. */
export function TrackTitle(props: {
  title: string | null;
  artist?: string | null;
  videoId: string;
}) {
  return (
    <span class="arch-what-title">
      <b>{props.title ?? props.videoId}</b>
      {props.artist && <span class="covartist"> — {props.artist}</span>}
    </span>
  );
}
