// fmt.ts — shared human formatters (server + web).

/** THE `unknown → message` seam (issue #82): one implementation, every
 *  tier. src/ callers import it as `errMessage as errorText` (#221:
 *  the errorText re-export shim, 9L, merged away — the alias IS the
 *  seam name); the fulltags leaf imports it directly from here
 *  (src/deck/shared is the sanctioned dependency leaf — src/ is NOT
 *  importable from fulltags). One shared helper so caught unknowns
 *  render identically everywhere — and so a future improvement (e.g.
 *  cause chains) lands in every error path at once. */
export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(1)} TB`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${Math.round(n)} B`;
}

// ---- shared rounding helpers ------------------------------------------------
// ONE set of wire-payload rounders. Every file that hand-rolled
// `Math.round(v * 1000) / 1000` (genre-diagnostics, gold-score, grid-audit,
// regate, verify-key, cues, ledgers, genre-run-eval) or
// `Math.round(v * 10000) / 10000` (similar, genre, linear-probe) imports
// from here. The names carry the decimal-place count so the intent is
// self-documenting; `round3n` is the nullable variant (null → 0, same as
// the old `round3` in core/ledgers.ts and `r4` in mood.ts).

/** Round to 1 decimal place. */
export const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Round to 3 decimal places. */
export const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Round to 3dp, null degrades to 0 (wire payloads where null = absent). */
export const round3n = (v: number | null): number =>
  Math.round((v ?? 0) * 1000) / 1000;

/** Round to 4 decimal places (embedding scores, vote weights). */
export const round4 = (v: number): number => Math.round(v * 10000) / 10000;

/** Relative "3m ago" style timestamps. */
export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function fmtPct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** Split after rounding the total, so seconds always stay within 0..59. */
function roundedDurationParts(s: number): {
  minutes: number;
  seconds: number;
} {
  const totalSeconds = Math.round(s);
  return {
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60,
  };
}

/** m:ss for durations given in seconds. */
export function fmtDur(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "—";
  const { minutes, seconds } = roundedDurationParts(s);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** 130-char macOS serials → readable head + tail. */
export function shortSerial(s: string): string {
  return s.length <= 18 ? s : `${s.slice(0, 10)}…${s.slice(-6)}`;
}

/** Human countdown from an ETA in seconds ("1m 20s"). Empty when unknown. */
export function fmtEta(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s) || s < 0) return "";
  const { minutes, seconds } = roundedDurationParts(s);
  if (minutes === 0) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** "today 14:32" / "Sep 2, 13:04" — compact wall-clock for feeds. */
export function fmtWhen(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (sameDay) return `today ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

/** Human event-payload strings instead of raw JSON fragments. */
export function fmtEventData(data: Record<string, unknown>): string {
  const parts = Object.entries(data).map(([k, v]) => {
    if (v === null || v === undefined) return null;
    if (k === "dismissed_at") return null; // O88: dismissal is UI state, not text
    if (Array.isArray(v)) return `${k}×${v.length}`;
    if (typeof v === "object") return null;
    if (typeof v === "string" && v.length > 120)
      return `${k} ${v.slice(0, 117)}…`;
    return `${k} ${String(v)}`;
  });
  const out = parts.filter((x): x is string => x !== null);
  return out.length ? out.join(" · ") : "—";
}
