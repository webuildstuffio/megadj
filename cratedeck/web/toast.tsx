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
export async function api<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (e) {
    toast(`network error: ${(e as Error).message}`, "err");
    throw e;
  }
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
    toast(msg, "err");
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}
