// toast.tsx — tiny toast store. api() enqueues failures automatically;
// components can also toast success/info explicitly via `toast()`.
import { useEffect, useState } from "preact/hooks";
import { Icon } from "./icons";

export interface Toast {
  id: number;
  tone: "ok" | "err" | "info";
  text: string;
}

let seq = 1;
let push: ((t: Omit<Toast, "id">) => void) | null = null;
const AUTO_DISMISS_MS = 4200;

export function toast(text: string, tone: Toast["tone"] = "info"): void {
  push?.({ text, tone });
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    push = (t) => {
      const id = seq++;
      setItems((cur) => [...cur.slice(-3), { ...t, id }]);
      setTimeout(
        () => setItems((cur) => cur.filter((x) => x.id !== id)),
        AUTO_DISMISS_MS,
      );
    };
    return () => {
      push = null;
    };
  }, []);
  return (
    <div class="toaster" role="status" aria-live="polite">
      {items.map((t) => (
        <div class={`toast ${t.tone}`} key={t.id}>
          <Icon
            name={
              t.tone === "ok" ? "check" : t.tone === "err" ? "warn" : "bolt"
            }
          />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

/** fetch wrapper: JSON in, JSON out, failures surface as toasts + throw. */
export class ApiError extends Error {
  /** HTTP status, or 0 when the request never got a response. */
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(
  path: string,
  init?: RequestInit & { quiet?: boolean; timeoutMs?: number },
): Promise<T> {
  // quiet = caller owns the surfacing (poll loops, probes, mapped verdicts).
  // The error still throws — quiet only suppresses the generic toast.
  // timeoutMs: abort a hung request instead of spinning forever (default
  // 30s). Long calls (prep digest ≈ the D30 sweep leg) pass their own,
  // larger budget — the deadline must EXIST and must exceed the server's
  // job duration.
  const { quiet, timeoutMs = 30_000, ...fetchInit } = init ?? {};
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(path, { ...fetchInit, signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    const msg =
      (e as Error).name === "AbortError"
        ? `timed out after ${Math.round(timeoutMs / 1000)}s — server busy; retry`
        : `network error: ${(e as Error).message}`;
    if (!quiet) toast(msg, "err");
    throw new ApiError(msg, 0);
  }
  clearTimeout(timer);
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      // non-JSON error body (proxy/interlock plaintext) — the status code is
      // still the message; res.ok already failed and we throw below.
    }
    if (res.status === 423) msg = `locked — ${msg}`;
    if (!quiet) toast(msg, "err");
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

/** JSON POST helper — body + Content-Type in one; returns api() parsed T. */
export function apiPost<T = unknown>(
  path: string,
  body: unknown,
  init?: Omit<RequestInit, "method" | "body" | "headers"> & {
    quiet?: boolean;
    timeoutMs?: number;
  },
): Promise<T> {
  // timeoutMs must be forwarded or long POSTs (dossier-style calls) inherit
  // the 30s default and abort mid-flight.
  const { quiet, timeoutMs, ...rest } = init ?? {};
  return api<T>(path, {
    ...rest,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(quiet === undefined ? {} : { quiet }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}
