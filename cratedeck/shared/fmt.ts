// fmt.ts — shared human formatters (server + web).
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(1) + " TB";
  if (abs >= 1e9) return (n / 1e9).toFixed(0) + " GB";
  if (abs >= 1e6) return (n / 1e6).toFixed(0) + " MB";
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + " KB";
  return Math.round(n) + " B";
}

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

/** m:ss for durations given in seconds. */
export function fmtDur(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** 130-char macOS serials → readable head + tail. */
export function shortSerial(s: string): string {
  return s.length <= 18 ? s : `${s.slice(0, 10)}…${s.slice(-6)}`;
}

/** Human countdown from an ETA in seconds ("1m 20s"). Empty when unknown. */
export function fmtEta(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s) || s < 0) return "";
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  if (m < 60) return `${m}m ${r}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
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
