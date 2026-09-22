// freshness.tsx — THE freshness-line UI (#174): one component, one CSS
// block, one band vocabulary. The AGENTS rule — "freshness ledgers must
// surface ages in UI (green/amber/red) instead of static counts" — was
// previously satisfied by MegasetStatus's private FreshnessLine while
// the other ledger-driven surfaces (tag-compare census, comment-sync)
// showed ages nowhere. The band math lives in shared/ledger-freshness
// (the #161 SSOT); this file is its renderer.
import type { JSX } from "preact";
import {
  formatAge,
  ledgerFreshness,
  worstBand,
} from "../../shared/ledger-freshness";

/** SSOT band → css class (the megaset palette, now shared). */
const bandClass = {
  none: "ok",
  green: "ok",
  amber: "warn",
  red: "stale",
} as const;

/** One labeled ledger age: name renders, at is the newest ISO stamp
 *  (null = empty ledger → explicit "never", never a fake age). */
export interface LedgerAge {
  name: string;
  at: string | null;
}

/** The freshness line: "analysis freshness — beats 3h ago, mood 12d ago"
 *  with the worst band driving the left-rail color. Empty ledgers render
 *  as "no <name> analysis yet" — the honest gap, not a fake age. */
export function FreshnessLine(props: {
  label?: string;
  ages: LedgerAge[];
  /** Hint shown when any ledger is amber/red. */
  note?: string | JSX.Element;
  /** Root class override (megaset keeps `.megaset-fresh` for zero
   *  visual change; every new surface uses the default). */
  cls?: string;
}): JSX.Element | null {
  const { ages, label = "analysis freshness", cls = "ledger-fresh" } = props;
  if (ages.length === 0) return null;
  const computed = ages.map((a) => ({ ...a, f: ledgerFreshness(a.at) }));
  const worst = worstBand(computed.map((c) => c.f.band));
  return (
    <div class={`${cls} ${bandClass[worst]}`}>
      {label} —{" "}
      {computed.map((c, i) => (
        <span key={c.name}>
          {i > 0 && ", "}
          {c.f.ageHours === null
            ? `no ${c.name} analysis yet`
            : `${c.name} ${formatAge(c.f)}`}
        </span>
      ))}
      {props.note && worst !== "green" && worst !== "none" && (
        <span class="fresh-note"> — {props.note}</span>
      )}
    </div>
  );
}
