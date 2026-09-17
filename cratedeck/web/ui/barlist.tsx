// barlist.tsx — the horizontal bar list (#204 split from data.tsx):
// BarListRow + BarList (replaces the 7 hand-rolled bar-row variants).
import type { ComponentChildren } from "preact";

export interface BarListRow {
  key: string;
  name: string;
  /** the measured value the bar scales against (raw, for the title) */
  value: number;
  /** what prints in the right column (defaults to value.toLocaleString()) */
  display?: string;
  /** hover gloss for the row */
  title?: string;
  /** the max all bars scale against (defaults to max of rows) */
  max?: number;
  /** total for share-% copy in the row title (defaults to sum of rows) */
  total?: number;
}

/** The one horizontal bar list. Replaces .barrow (DrivePanels.Bars,
 *  HealthTab.FolderBars), .extrow (ExtBars) and .chip-list (GenreBars,
 *  ChipListLite, skip census) — 7 hand-rolled variants, one component. */
export function BarList(props: {
  rows: BarListRow[];
  /** cap rendered rows (renders the "…and N more" footer) */
  cap?: number;
  /** gradient flavor: accent (genres/keys) | info (ext/tech) | warn */
  tone?: "accent" | "info" | "warn";
  empty?: ComponentChildren;
  class?: string;
}) {
  if (props.rows.length === 0) return props.empty ? <>{props.empty}</> : null;
  const max =
    props.rows.length > 0 ? Math.max(...props.rows.map((r) => r.value), 1) : 1;
  const total = props.rows.reduce((s, r) => s + r.value, 0) || 1;
  const shown =
    props.cap !== undefined ? props.rows.slice(0, props.cap) : props.rows;
  return (
    <div class={`barlist ${props.class ?? ""}`} role="list">
      {shown.map((r) => (
        <div
          class="bl-row"
          role="listitem"
          key={r.key}
          title={
            r.title ??
            `${r.name}: ${r.display ?? r.value.toLocaleString()} · ${Math.round(
              (r.value / total) * 100,
            )}% of total`
          }
        >
          <span class="bl-name">{r.name}</span>
          <span class={`bl-track tone-${props.tone ?? "accent"}`}>
            <i
              style={{
                width: `${Math.max(2, (r.value / (r.max ?? max)) * 100)}%`,
              }}
            />
          </span>
          <span class="bl-n">{r.display ?? r.value.toLocaleString()}</span>
        </div>
      ))}
      {props.cap !== undefined && props.rows.length > props.cap && (
        <div class="fleet-note">
          …and {props.rows.length - props.cap} more — Copy has all
        </div>
      )}
    </div>
  );
}
