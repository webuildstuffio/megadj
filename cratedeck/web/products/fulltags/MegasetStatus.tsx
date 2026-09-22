// MegasetStatus.tsx — the set builder's non-form status widgets, split
// out of MegasetPanel.tsx (file-length guard): the staged loading
// explainer (elapsed timer + phase list), the freshness line, and the
// excluded-reasons breakdown.
//
// The loading explainer exists because a whole-shelf build has a real
// wall-clock cost (thousands of existence checks + fallback reads). A
// bare spinner reads as "hung"; a staged list with an elapsed timer
// reads as "working, and here is the work".
import type { MegasetPayload } from "../../../shared/types";
import { camelotOf } from "../../../shared/camelot";
import { KVRows, KVRow, KVKey, KVVal } from "../../ui/data";

// freshness compute/format from the SSOT (#161) — the private
// daysAgo/ageWord pair and its 2d/14d tribal thresholds are gone; the
// AGENTS bands (green <24h, amber <7d, red ≥7d) are named in code now.
import { FreshnessLine as SharedFreshnessLine } from "../../ui/freshness";

/** Pool freshness: ledger ages under the proposal, so a stale pool is
 * VISIBLE instead of silently proposing from yesterday's analysis. Tone:
 * ok ≤2 days, warn ≤14 days, stale beyond. Thin delegation to the shared
 * renderer (#174) — one FreshnessLine implementation repo-wide; this
 * wrapper keeps the megaset class + exact line text (zero visual
 * change). */
export function FreshnessLine(props: {
  freshness: { beatsAt: string | null; moodAt: string | null };
  pool: number;
}) {
  if (props.pool === 0) return null;
  return (
    <SharedFreshnessLine
      cls="megaset-fresh"
      ages={[
        { name: "beats", at: props.freshness.beatsAt },
        { name: "mood", at: props.freshness.moodAt },
      ]}
      note={
        <>
          newer imports? run <code>megadj beats</code> +{" "}
          <code>megadj mood</code>
        </>
      }
    />
  );
}

/** The build's visible phases — shown as a checklist while loading so the
 *  wait is legible ("what is it doing NOW?" has an answer). The active
 *  phase advances on a fixed schedule; it is honest framing, not fake
 *  progress: each stage names real work the server does, in order. */
const LOAD_PHASES = [
  "reading the archive database",
  "checking files on the shelf",
  "reading FullTags analysis + filling gaps",
  "sequencing the chain",
] as const;

export function MegasetLoading(props: { startedAt: number }) {
  const elapsed = Math.max(
    0,
    Math.round((Date.now() - props.startedAt) / 1000),
  );
  // phase schedule: 25% DB read, 45% shelf walk, 20% ledger joins,
  // remainder sequencing — matches where whole-shelf builds spend time
  const phase =
    elapsed < 5
      ? 0
      : elapsed < 18
        ? 1
        : elapsed < 30
          ? 2
          : LOAD_PHASES.length - 1;
  return (
    <div
      class="megaset-loading"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span class="spin" aria-hidden="true" />
      <span class="megaset-loading-body">
        <strong>
          Building your set… <span class="megaset-elapsed">{elapsed}s</span>
        </strong>
        <ol class="megaset-phases">
          {LOAD_PHASES.map((label, i) => (
            <li
              key={label}
              class={i < phase ? "done" : i === phase ? "now" : ""}
            >
              {i < phase ? "✓ " : i === phase ? "→ " : ""}
              {label}
            </li>
          ))}
        </ol>
        <small>
          Read-only: nothing is written to the archive or Rekordbox. A
          whole-shelf build usually takes 15–30 seconds.
        </small>
      </span>
    </div>
  );
}

/** One excluded bucket: grouped reason → count + example tracks.
 *  B13 (#104): the buckets come from the WIRE (`excluded_groups`,
 *  derived engine-side from the FULL excluded list by the shared
 *  `groupMegasetExcluded`) — this component renders them and never
 *  re-buckets locally (the old local twin could drift from the engine's
 *  full-census grouping by only seeing the 40-row preview). */
/** The excluded view: reason-shape summary on top (grouped, with example
 * tracks), the raw per-track list in a nested details for auditing. */
export function ExcludedBreakdown(props: { data: MegasetPayload }) {
  const { data } = props;
  if (data.excluded_total <= 0) return null;
  // #291: budget-fill arrives as a STATUS count (budget_filled), not a
  // bucket — the groups carry only genuine quality reasons. Pre-#291
  // payloads without the field degrade by reading it as 0 (?? 0 is
  // wrong for a 0-count field; the field is typed required, so a plain
  // read is correct).
  const budgetFilled = data.budget_filled ?? 0;
  const buckets = data.excluded_groups;
  const shown = data.excluded.length;
  return (
    <details class="megaset-excluded">
      <summary>
        {data.excluded_total} of {data.pool.toLocaleString()} candidates not in
        the chain — why?
      </summary>
      {budgetFilled > 0 && (
        <div class="fleet-note">
          {budgetFilled.toLocaleString()} skipped only because the set's time
          budget filled — a status, not a quality problem. The quality shape
          below covers the remaining{" "}
          {(data.excluded_total - budgetFilled).toLocaleString()}.
        </div>
      )}
      <KVRows>
        {buckets.map((b) => (
          <KVRow key={b.reason}>
            <KVKey>{b.reason}</KVKey>
            <KVVal>
              {b.count.toLocaleString()} track{b.count === 1 ? "" : "s"}
              {b.examples.length > 0 && (
                <span class="megaset-excluded-examples">
                  {" "}
                  e.g. {b.examples.join(", ")}
                </span>
              )}
            </KVVal>
          </KVRow>
        ))}
      </KVRows>
      {shown < data.excluded_total && (
        <div class="fleet-note">
          showing the first {shown} rows — the group counts above cover all{" "}
          {data.excluded_total.toLocaleString()}
        </div>
      )}
      <details class="megaset-excluded-raw">
        <summary>every excluded track, one per line</summary>
        <KVRows>
          {data.excluded.map((e) => (
            <KVRow key={e.videoId}>
              <KVKey>{e.title ?? e.videoId}</KVKey>
              <KVVal>{e.reason}</KVVal>
            </KVRow>
          ))}
        </KVRows>
      </details>
    </details>
  );
}

/** "Reproduce this build" — the exact CLI line for the chain on screen, so
 * the terminal is always one paste away from the same deterministic draft.
 * Sep 21: a genre-filtered build MUST carry `--genre` — the repro used to
 * drop it, so pasting the line silently rebuilt the unfiltered pool. */
export function ReproLine(props: {
  data: MegasetPayload;
  searchChoice: "auto" | "greedy" | "beam";
  poolLimit: number | null;
  openerId: string | null;
  genre: string | null;
  landmarkIds: readonly string[];
}) {
  const parts = [
    "megadj megaset",
    `--preset ${props.data.preset}`,
    `--minutes ${props.data.minutes}`,
  ];
  if (props.searchChoice !== "auto")
    parts.push(`--search ${props.searchChoice}`);
  if (props.poolLimit !== null) parts.push(`--limit ${props.poolLimit}`);
  if (props.openerId) parts.push(`--opener ${props.openerId}`);
  if (props.genre !== null && props.genre.trim() !== "")
    parts.push(`--genre ${props.genre.trim()}`);
  // S13 (#107): pinned must-plays ride the repro — a paste rebuilds the
  // SAME chain, pins included
  for (const id of props.landmarkIds) parts.push(`--landmark ${id}`);
  const cmd = parts.join(" ");
  return (
    <div class="megaset-repro">
      <span>same build from the terminal:</span>
      <code>{cmd}</code>
    </div>
  );
}

/** Camelot first→last glide, "8A → 5A" (null-safe at both ends). Lives
 * here so the panel and the chart caption never re-derive it apart. */
export function keyGlideOf(steps: MegasetPayload["steps"]): string | null {
  const parsed = steps.map((s) => camelotOf(s.key));
  const first = parsed.find((k) => k !== null);
  const last = parsed.findLast((k) => k !== null);
  if (!first || !last) return null;
  return `${first.n}${first.letter} → ${last.n}${last.letter}`;
}
