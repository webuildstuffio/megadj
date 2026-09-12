// toast.tsx — tiny toast store. api() enqueues failures automatically;
// components can also toast success/info explicitly via `toast( + `.
import { useEffect, useState } from "preact/hooks";
import { setApiErrorReporter } from "./api";
import { Icon } from "./icons";
export { api, ApiError, apiPost } from "./api";

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

// api.ts is deliberately a transport leaf. Install presentation here so a
// failed request still reaches the existing toast UX without a circular
// api → toast → api module edge.
setApiErrorReporter((message) => toast(message, "err"));

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
