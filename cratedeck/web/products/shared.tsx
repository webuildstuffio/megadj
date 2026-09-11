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
import { useCallback, useEffect, useState } from "preact/hooks";
import type { Product } from "../app/router";
import { Icon } from "../ui/icons";
import { Card, ListHead, DataTable, type DataTableColumn } from "../ui/data";
import { api, apiPost, toast } from "../ui/toast";
import { errMessage } from "../../shared/fmt";

/** useScanApply — the load/job-event-reload/scan-apply scaffold behind the
 *  Hygiene and Fixes tabs. Both tabs are remote controls over a job API:
 *  tri-state payload fetch (undefined = in flight, null = fetched, never
 *  scanned), reload on every `cratedeck:job` event, and scan/apply
 *  enqueue with busy tracking + toasts. This is the ONE implementation —
 *  the two tabs' handlers were a 58-line jscpd-flagged clone.
 *  `runApply` lets a tab add its own extra action (e.g. hygiene decide)
 *  with the same busy + toast + reload pattern. */
export function useScanApply<T>(props: {
  readPath: string;
  actionPath: string;
  label: { thing: string; scanDone: string; applyDone: string };
  readNullAs?: (raw: null) => null;
}) {
  // tri-state: undefined = fetch in flight, null = fetched, never scanned
  const [payload, setPayload] = useState<T | null | undefined>(undefined);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPayload(await api<T | null>(props.readPath, { quiet: true }));
      setLoadErr(null);
    } catch (e) {
      const m = errMessage(e);
      console.error(`${props.label.thing} load failed`, e);
      setLoadErr(m);
    }
  }, [props.readPath, props.label.thing]);

  useEffect(() => {
    load().catch((e: unknown) =>
      console.error(`${props.label.thing} initial load failed`, e),
    );
    const onJob = () => {
      load().catch((e: unknown) =>
        console.error(`${props.label.thing} job-event reload failed`, e),
      );
    };
    window.addEventListener("cratedeck:job", onJob);
    return () => window.removeEventListener("cratedeck:job", onJob);
  }, [load, props.label.thing]);

  /** POST to `<actionPath>/<kind>` with busy + toast. */
  const enqueue = async (kind: "scan" | "apply", applyToast?: string) => {
    setBusy(kind);
    try {
      await apiPost(`${props.actionPath}/${kind}`, {});
      toast(
        kind === "scan"
          ? props.label.scanDone
          : (applyToast ?? props.label.applyDone),
        "ok",
      );
    } catch {
      /* toast already surfaced the failure */
    } finally {
      setBusy(null);
    }
  };

  /** Tab-specific action (decide, …) sharing the busy/toast/reload pattern. */
  const runAction = async (kind: string, fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } catch {
      /* toast already surfaced the failure */
    } finally {
      setBusy(null);
      load().catch((e: unknown) =>
        console.error(`post-${kind} reload failed`, e),
      );
    }
  };

  return {
    payload,
    setPayload,
    loadErr,
    busy,
    setBusy,
    load,
    enqueue,
    runAction,
  };
}

/** ScanApplyGate — the load-error / loading early-return both job-remote
 *  tabs render before their real body. Pair with useScanApply; the tabs
 *  hand their own unavailable/loading copy so the voice stays theirs. */
export function ScanApplyGate(props: {
  loadErr: string | null;
  payload: unknown;
  unavailable: string;
  loading: string;
  children: ComponentChildren;
}) {
  if (props.loadErr && props.payload === undefined) {
    return (
      <div class="note bad">
        <Icon name="warn" size={14} /> {props.unavailable}
      </div>
    );
  }
  if (props.payload === undefined) {
    return (
      <div class="note">
        <Icon name="clock" size={14} /> {props.loading}
      </div>
    );
  }
  return <>{props.children}</>;
}

/** ScanApplyActions — the Scan / Apply button pair (busy-aware) every
 *  job-remote tab renders in its actions bar. `applyDisabled` hides the
 *  apply button when there is nothing safe to apply; `applyTitle` carries
 *  the tab's own safety contract. */
export function ScanApplyActions(props: {
  busy: string | null;
  applyDisabled: boolean;
  scanTitle: string;
  applyTitle: string;
  applyLabel: (busy: boolean) => string;
  onScan: () => void;
  onApply: () => void;
}) {
  return (
    <>
      <button
        type="button"
        class="btn"
        disabled={props.busy !== null}
        onClick={props.onScan}
        title={props.scanTitle}
      >
        <Icon name="scan" size={14} />
        {props.busy === "scan" ? "Scanning…" : "Scan shelf"}
      </button>
      <button
        type="button"
        class="btn primary"
        disabled={props.busy !== null || props.applyDisabled}
        onClick={props.onApply}
        title={props.applyTitle}
      >
        <Icon name="check" size={14} />
        {props.busy === "apply"
          ? "Applying…"
          : props.applyLabel(props.busy === "apply")}
      </button>
    </>
  );
}

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
      icon: "compass",
      title: "I49 sounds-like: nearest tracks by audio embedding similarity",
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

/** The one-line verdict a human reads before anything else. `meta` accepts
 *  a node (InfoTip, Copy button, multi-part counts) — the old string-only
 *  signature is why 5 pages hand-rolled `arch-verdict` divs. */
export function Verdict(props: {
  cls: "ok" | "warn" | "bad";
  text: string;
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

/** delta % between the beat_this ledger BPM and rekordbox's BPM (1dp). */
export function gridDeltaPct(ledgerBpm: number, rbBpm: number): number {
  return rbBpm > 0
    ? Math.round((Math.abs(ledgerBpm - rbBpm) / rbBpm) * 1000) / 10
    : 0;
}

/** Producer row → the shared GridBreaker render row (flat: delta precomputed,
 *  verdict as a class). Lives here (products/shared) so ArchiveTab and
 *  FullTagsPage can't drift; the wire type is archive-owned.
 *  Drift rows (positional) and octave rows are both severity-"bad". */
export function mkBreaker(
  t: {
    video_id: string;
    title: string | null;
    ledgerBpm: number;
    rbBpm: number;
    driftMs: number;
  },
  cls: GridBreaker["cls"],
): GridBreaker {
  return {
    videoId: t.video_id,
    title: t.title,
    cls,
    ledgerBpm: t.ledgerBpm,
    rbBpm: t.rbBpm,
    deltaPct: gridDeltaPct(t.ledgerBpm, t.rbBpm),
    driftMs: t.driftMs,
  };
}

/** Collect breakers from a grid-cross-check payload in severity order:
 *  octave first (wrong pulse), then drift (positional slide), then
 *  tempo-off — the shared table renders it in the given order. Accepts the
 *  raw wire shape (octave/drift/off arrays) or `unavailable`. */
export function collectBreakers(
  grid:
    | {
        available: boolean;
        octave: Parameters<typeof mkBreaker>[0][];
        drift: Parameters<typeof mkBreaker>[0][];
        off: Parameters<typeof mkBreaker>[0][];
      }
    | null
    | undefined,
): GridBreaker[] {
  if (!grid?.available) return [];
  return [
    ...grid.octave.map((t) => mkBreaker(t, "octave")),
    ...grid.drift.map((t) => mkBreaker(t, "drift")),
    ...grid.off.map((t) => mkBreaker(t, "off")),
  ];
}

/** One beat-grid cross-check track as a DataTable row spec. The ArchiveTab
 *  and FullTagsPage "Beat Sync breakers" cards rendered byte-identical
 *  markup — this is the ONE implementation (columns + rows + copy).
 *  Verdict classes (plan GA-04/GA-05): octave > drift > off, severity
 *  order for pill + row tone; `driftMs` is positional drift across the
 *  track (the v1 card couldn't show it because the old verdict compared
 *  counts, not positions). */
export interface GridBreaker {
  videoId: string;
  title: string | null;
  cls: "octave" | "drift" | "off";
  ledgerBpm: number;
  rbBpm: number;
  deltaPct: number;
  driftMs: number;
}

export function beatSyncColumns(): DataTableColumn<GridBreaker>[] {
  return [
    {
      key: "track",
      head: "track",
      grow: 1.6,
      cell: (t: GridBreaker) => <b>{t.title ?? t.videoId}</b>,
      sortValue: (t: GridBreaker) => (t.title ?? t.videoId).toLowerCase(),
    },
    {
      key: "verdict",
      head: "verdict",
      min: 72,
      grow: 0,
      cell: (t: GridBreaker) => {
        if (t.cls === "octave")
          return <span class="arch-pill bad">octave</span>;
        if (t.cls === "drift") return <span class="arch-pill bad">drift</span>;
        return <span class="arch-pill warn">off</span>;
      },
      sortValue: (t: GridBreaker) => (t.cls === "off" ? 1 : 0),
    },
    {
      key: "grid",
      head: "grid",
      align: "end",
      min: 62,
      grow: 0,
      cell: (t: GridBreaker) => t.ledgerBpm,
      sortValue: (t: GridBreaker) => t.ledgerBpm,
    },
    {
      key: "rb",
      head: "rekordbox",
      align: "end",
      min: 78,
      grow: 0,
      cell: (t: GridBreaker) => Math.round(t.rbBpm * 10) / 10,
      sortValue: (t: GridBreaker) => t.rbBpm,
    },
    {
      key: "delta",
      head: "delta",
      grow: 1,
      cell: (t: GridBreaker) => (
        <span class="covdelta">
          <i
            class={t.cls === "off" ? "warn" : "bad"}
            style={{ width: `${Math.min(t.deltaPct * 8, 100)}%` }}
          />
          <em>
            {t.cls === "octave"
              ? "×2"
              : t.cls === "drift"
                ? `${Math.round(t.driftMs)} ms`
                : `${t.deltaPct}%`}
          </em>
        </span>
      ),
      sortValue: (t: GridBreaker) =>
        t.cls === "drift" ? t.driftMs : t.deltaPct,
    },
  ];
}

/** Build the copy payload for a Beat Sync breakers table. */
export const beatSyncCopy = (rows: GridBreaker[]): string[] =>
  rows.map((t) => {
    const tail =
      t.cls === "octave"
        ? " (OCTAVE)"
        : t.cls === "drift"
          ? ` (drift ${Math.round(t.driftMs)} ms)`
          : "";
    return `${t.title ?? t.videoId} — grid ${t.ledgerBpm} vs RB ${Math.round(t.rbBpm * 10) / 10} BPM${tail}`;
  });

/** BeatSyncBreakersCard — the whole "Beat Sync breakers" card (ListHead +
 *  DataTable + fix footnote) as ONE shared component. The ArchiveTab and
 *  FullTagsPage renders were byte-identical except the hint's tail and the
 *  footnote copy — both now pass through as props so the card can't drift
 *  again (jscpd flagged an 85-line clone here; this is the fix). */
export function BeatSyncBreakersCard(props: {
  breakers: GridBreaker[];
  syncRisk: number;
  hint: string;
  fixNote: ComponentChildren;
}) {
  return (
    <Card>
      <ListHead
        icon="pulse"
        title="Beat Sync breakers"
        n={props.syncRisk}
        hint={props.hint}
        lines={beatSyncCopy(props.breakers)}
      />
      <DataTable
        columns={beatSyncColumns()}
        rows={props.breakers}
        cap={40}
        ariaLabel="Beat Sync breakers"
        rowTone={(t) => (t.cls === "off" ? "" : "bad")}
        copyLines={beatSyncCopy}
        copyName="Beat Sync breakers"
      />
      <div class="arch-fix">fix: {props.fixNote}</div>
    </Card>
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
