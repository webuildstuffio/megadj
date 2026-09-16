/**
 * ledger-freshness.ts — THE ledger-age compute + format (issue #161).
 *
 * The AGENTS rule — "freshness ledgers must surface ages in UI
 * (green/amber/red) instead of static counts" — was implemented by four
 * hand-rolled computations: cratedeck's poolFreshness probe, megaset's
 * CLI `dayOf` slice, the web FreshnessLine's private daysAgo/ageWord
 * pair, and rb-comment-sync's documented-but-unshared convention. Same
 * semantic question ("how old is the newest row, and is that fresh?"),
 * four formats, four band thresholds.
 *
 * One module, one vocabulary:
 * - `ledgerFreshness(newestAt, now?)` — age + band. Bands ARE the AGENTS
 *   thresholds, named in code: green <24h, amber <7d, red ≥7d, none.
 * - `formatAge(f)` — the one human line ("3h ago", "12d ago", "never").
 *
 * Lives in cratedeck/shared (the dependency leaf — same precedent as
 * errorText/fmt from #82). Pure: no SQL, no clock reads — callers pass
 * `now` for testability.
 */

export type FreshnessBand = "green" | "amber" | "red" | "none";

export interface LedgerFreshness {
  /** The newest row's ISO timestamp, passed through (null = empty ledger). */
  newestAt: string | null;
  /** Whole hours since the newest row (null = empty ledger). */
  ageHours: number | null;
  /** green <24h · amber <7d · red ≥7d · none = empty ledger. */
  band: FreshnessBand;
}

const HOUR_MS = 3_600_000;

export function ledgerFreshness(
  newestAt: string | null,
  now: Date = new Date(),
): LedgerFreshness {
  if (newestAt === null) {
    return { newestAt: null, ageHours: null, band: "none" };
  }
  const parsed = Date.parse(newestAt);
  if (!Number.isFinite(parsed)) {
    // A corrupt stamp is RED, not a crash — freshness must never take
    // down the surface that displays it.
    return { newestAt, ageHours: null, band: "red" };
  }
  const ageHours = Math.max(0, Math.floor((now.getTime() - parsed) / HOUR_MS));
  const band: FreshnessBand =
    ageHours < 24 ? "green" : ageHours < 24 * 7 ? "amber" : "red";
  return { newestAt, ageHours, band };
}

/** The one human age line: "3h ago" (<48h), "12d ago", "never". */
export function formatAge(f: LedgerFreshness): string {
  if (f.ageHours === null) return "never";
  if (f.ageHours < 48) return `${f.ageHours}h ago`;
  return `${Math.floor(f.ageHours / 24)}d ago`;
}

/** Worst (highest-severity) band across a set — the "any ledger stale →
 * surface stale" rollup the FreshnessLine UI bakes in. */
export function worstBand(bands: readonly FreshnessBand[]): FreshnessBand {
  const rank: Record<FreshnessBand, number> = {
    none: 0,
    green: 1,
    amber: 2,
    red: 3,
  };
  return bands.reduce<FreshnessBand>(
    (worst, b) => (rank[b] > rank[worst] ? b : worst),
    "none",
  );
}
