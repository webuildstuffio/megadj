// SetBuildStatus.tsx — the set builder's non-form status widgets, split
// out of SetBuildPanel.tsx (file-length guard): the staged loading
// explainer (elapsed timer + phase list), the freshness line, and the
// excluded-reasons breakdown.
//
// The loading explainer exists because a whole-shelf build has a real
// wall-clock cost (thousands of existence checks + fallback reads). A
// bare spinner reads as "hung"; a staged list with an elapsed timer
// reads as "working, and here is the work".
import type { SetBuildPayload } from "../../../shared/types";
import { camelotOf } from "../../../shared/camelot";
import { KVRows, KVRow, KVKey, KVVal } from "../../ui/data";

/** ISO timestamp → age in whole days (null input → null). */
const daysAgo = (iso: string | null): number | null =>
  iso === null ? null : Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);

/** Days-since → display word ("never" / "today" / "3d ago"). */
const ageWord = (d: number | null): string =>
  d === null ? "never" : d <= 0 ? "today" : `${d}d ago`;

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

export function SetBuildLoading(props: { startedAt: number }) {
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
      class="setbuild-loading"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span class="spin" aria-hidden="true" />
      <span class="setbuild-loading-body">
        <strong>
          Building your set… <span class="setbuild-elapsed">{elapsed}s</span>
        </strong>
        <ol class="setbuild-phases">
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

/** Pool freshness: ledger ages under the proposal, so a stale pool is
 * VISIBLE instead of silently proposing from yesterday's analysis. Tone:
 * ok ≤2 days, warn ≤14 days, stale beyond. */
export function FreshnessLine(props: {
  freshness: { beatsAt: string | null; moodAt: string | null };
  pool: number;
}) {
  if (props.pool === 0) return null;
  const beats = daysAgo(props.freshness.beatsAt);
  const mood = daysAgo(props.freshness.moodAt);
  const worst = Math.max(
    beats ?? Number.POSITIVE_INFINITY,
    mood ?? Number.POSITIVE_INFINITY,
  );
  const cls = worst <= 2 ? "ok" : worst <= 14 ? "warn" : "stale";
  return (
    <div class={`setbuild-fresh ${cls}`}>
      analysis freshness — beats {ageWord(beats)}, mood {ageWord(mood)}
      {worst > 2 && (
        <span class="fresh-note">
          {" "}
          — newer imports? run <code>megadj beats</code> +{" "}
          <code>megadj mood</code>
        </span>
      )}
    </div>
  );
}

/** One excluded bucket: grouped reason → count + example tracks. */
interface ExcludedBucket {
  reason: string;
  count: number;
  examples: string[];
}

/** Group the wire's excluded[] into reason buckets. The raw list is
 * per-track (honest, sortable) but 40 rows of "budget filled" is noise;
 * the DJ wants the SHAPE of what was left out. Order: biggest first. */
export function bucketExcluded(
  excluded: SetBuildPayload["excluded"],
): ExcludedBucket[] {
  const byReason = new Map<string, ExcludedBucket>();
  for (const e of excluded) {
    let bucket = byReason.get(e.reason);
    if (!bucket) {
      bucket = { reason: e.reason, count: 0, examples: [] };
      byReason.set(e.reason, bucket);
    }
    bucket.count += 1;
    if (bucket.examples.length < 4) bucket.examples.push(e.title ?? e.videoId);
  }
  return [...byReason.values()].toSorted((a, b) => b.count - a.count);
}

/** The excluded view: reason-shape summary on top (grouped, with example
 * tracks), the raw per-track list in a nested details for auditing. */
export function ExcludedBreakdown(props: { data: SetBuildPayload }) {
  const { data } = props;
  if (data.excluded_total <= 0) return null;
  const buckets = bucketExcluded(data.excluded);
  const shown = data.excluded.length;
  return (
    <details class="setbuild-excluded">
      <summary>
        {data.excluded_total} of {data.pool.toLocaleString()} candidates not in
        the chain — why?
      </summary>
      <KVRows>
        {buckets.map((b) => (
          <KVRow key={b.reason}>
            <KVKey>{b.reason}</KVKey>
            <KVVal>
              {b.count.toLocaleString()} track{b.count === 1 ? "" : "s"}
              {b.examples.length > 0 && (
                <span class="setbuild-excluded-examples">
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
          showing the first {shown} — save the JSON draft for the full list
        </div>
      )}
      <details class="setbuild-excluded-raw">
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
 * the terminal is always one paste away from the same deterministic draft. */
export function ReproLine(props: {
  data: SetBuildPayload;
  searchChoice: "auto" | "greedy" | "beam";
  poolLimit: number | null;
  openerId: string | null;
}) {
  const parts = [
    "megadj setbuild",
    `--preset ${props.data.preset}`,
    `--minutes ${props.data.minutes}`,
  ];
  if (props.searchChoice !== "auto")
    parts.push(`--search ${props.searchChoice}`);
  if (props.poolLimit !== null) parts.push(`--limit ${props.poolLimit}`);
  if (props.openerId) parts.push(`--opener ${props.openerId}`);
  const cmd = parts.join(" ");
  return (
    <div class="setbuild-repro">
      <span>same build from the terminal:</span>
      <code>{cmd}</code>
    </div>
  );
}

/** Camelot first→last glide, "8A → 5A" (null-safe at both ends). Lives
 * here so the panel and the chart caption never re-derive it apart. */
export function keyGlideOf(steps: SetBuildPayload["steps"]): string | null {
  const parsed = steps.map((s) => camelotOf(s.key));
  const first = parsed.find((k) => k !== null);
  const last = parsed.findLast((k) => k !== null);
  if (!first || !last) return null;
  return `${first.n}${first.letter} → ${last.n}${last.letter}`;
}
