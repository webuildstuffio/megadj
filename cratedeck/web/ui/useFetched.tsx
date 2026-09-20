// useFetched.tsx — load-once fetch state machine for tabs that read one
// payload on mount: loading → ok | error. Replaces the per-tab
// data/err/alive/useEffect quartet (four copies existed). Failure is a
// named branch the UI must render — never a silent null.
import { useEffect, useRef, useState } from "preact/hooks";
import { errMessage } from "../../../src/shared/leaf/fmt";
import { Icon } from "./icons";

export type Fetched<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: T };

export function useFetched<T>(
  load: () => Promise<T>,
  deps: unknown[],
): Fetched<T> & { refresh?: () => void } {
  const [page, setPage] = useState<Fetched<T>>({ status: "loading" });
  const [, setTick] = useState(0);
  // `load` is an inline closure at every call site — a fresh identity each
  // render. The effect keys on the CALLER'S deps only; the closure itself
  // is read through a ref so the deps rule is satisfied by construction
  // (nothing in the effect body depends on a render-scoped binding).
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let alive = true;
    loadRef.current().then(
      (data) => alive && setPage({ status: "ok", data }),
      (e: unknown) =>
        alive && setPage({ status: "error", message: errMessage(e) }),
    );
    return () => {
      alive = false;
    };
  }, deps);
  return page.status === "ok"
    ? { ...page, refresh: () => setTick((t) => t + 1) }
    : page;
}

/** Shared loading/error gates for a useFetched tab: the `card > empty`
 * rendering every tab hand-rolled. Returns the branch JSX, or null when
 * the payload is ready (caller renders the real content).
 *
 * UX polish (Sep 19): loading spins (the JobsDock `.spin` vocabulary —
 * spinning implies motion, static text implied a hang) and errors carry
 * the `.note bad` tone so failures read as failures at a glance, not
 * more muted prose. */
export function FetchedGate(props: {
  page: Fetched<unknown>;
  loading: string;
}) {
  if (props.page.status === "error")
    return (
      <div class="card">
        <div class="empty note bad">
          <Icon name="circleX" size={16} /> {props.page.message}
        </div>
      </div>
    );
  if (props.page.status === "loading")
    return (
      <div class="card">
        <div class="empty">
          <span class="spin">
            <Icon name="refresh" size={14} />
          </span>{" "}
          {props.loading}
        </div>
      </div>
    );
  return null;
}
