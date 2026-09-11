// useFetched.tsx — load-once fetch state machine for tabs that read one
// payload on mount: loading → ok | error. Replaces the per-tab
// data/err/alive/useEffect quartet (four copies existed). Failure is a
// named branch the UI must render — never a silent null.
import { useEffect, useRef, useState } from "preact/hooks";
import { errMessage } from "../../shared/fmt";
import { Icon } from "./icons";

export type Fetched<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: T };

export function useFetched<T>(
  load: () => Promise<T>,
  deps: unknown[],
): Fetched<T> {
  const [page, setPage] = useState<Fetched<T>>({ status: "loading" });
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
  return page;
}

/** Shared loading/error gates for a useFetched tab: the `card > empty`
 * rendering every tab hand-rolled. Returns the branch JSX, or null when
 * the payload is ready (caller renders the real content). */
export function FetchedGate(props: {
  page: Fetched<unknown>;
  loading: string;
}) {
  if (props.page.status === "error")
    return (
      <div class="card">
        <div class="empty">
          <Icon name="x" size={16} /> {props.page.message}
        </div>
      </div>
    );
  if (props.page.status === "loading")
    return (
      <div class="card">
        <div class="empty">{props.loading}</div>
      </div>
    );
  return null;
}
