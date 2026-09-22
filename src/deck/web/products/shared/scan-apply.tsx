// scan-apply.tsx — the load/job-event-reload/scan-apply scaffold behind
// the Hygiene and Fixes tabs (#89/#90 page-skeleton pass; extracted from
// products/shared/index.tsx). Both tabs are remote controls over a job API:
// tri-state payload fetch (undefined = in flight, null = fetched, never
// scanned), reload on every `cratedeck:job` event, and scan/apply
// enqueue with busy tracking + toasts. This is the ONE implementation —
// the two tabs' handlers were a 58-line jscpd-flagged clone. `runAction`
// lets a tab add its own extra action (e.g. hygiene decide) with the
// same busy + toast + reload pattern.
import { useCallback, useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Icon } from "../../ui/icons";
import { api, apiPost, toast } from "../../ui/toast";
import { errMessage } from "../../../../shared/leaf/fmt";

export function useScanApply<T>(props: {
  readPath: string;
  actionPath: string;
  label: { thing: string; scanDone: string; applyDone: string };
}) {
  // tri-state: undefined = fetch in flight, null = fetched, never scanned
  const [payload, setPayload] = useState<T | null | undefined>(undefined);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPayload(await api<T | null>(props.readPath, { quiet: true }));
      setLoadErr(null);
    } catch (e) {
      const m = errMessage(e);
      console.error(`${props.label.thing} load failed`, e);
      setLoadErr(m);
    }
  }, [props.readPath, props.label.thing]);

  useEffect(() => {
    load().catch((e: unknown) =>
      console.error(`${props.label.thing} initial load failed`, e),
    );
    const onJob = () => {
      load().catch((e: unknown) =>
        console.error(`${props.label.thing} job-event reload failed`, e),
      );
    };
    window.addEventListener("cratedeck:job", onJob);
    return () => window.removeEventListener("cratedeck:job", onJob);
  }, [load, props.label.thing]);

  /** POST to `<actionPath>/<kind>` with busy + toast. */
  const enqueue = async (kind: "scan" | "apply", applyToast?: string) => {
    setBusy(kind);
    try {
      await apiPost(`${props.actionPath}/${kind}`, {});
      toast(
        kind === "scan"
          ? props.label.scanDone
          : (applyToast ?? props.label.applyDone),
        "ok",
      );
    } catch {
      /* toast already surfaced the failure */
    } finally {
      setBusy(null);
    }
  };

  /** Tab-specific action (decide, …) sharing the busy/toast/reload pattern. */
  const runAction = async (kind: string, fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } catch {
      /* toast already surfaced the failure */
    } finally {
      setBusy(null);
      load().catch((e: unknown) =>
        console.error(`post-${kind} reload failed`, e),
      );
    }
  };

  return {
    payload,
    setPayload,
    loadErr,
    busy,
    setBusy,
    load,
    enqueue,
    runAction,
  };
}

/** ScanApplyGate — the load-error / loading early-return both job-remote
 *  tabs render before their real body. Pair with useScanApply; the tabs
 *  hand their own unavailable/loading copy so the voice stays theirs. */
export function ScanApplyGate(props: {
  loadErr: string | null;
  payload: unknown;
  unavailable: string;
  loading: string;
  children: ComponentChildren;
}) {
  if (props.loadErr && props.payload === undefined) {
    return (
      <div class="note bad">
        <Icon name="warn" size={14} /> {props.unavailable}
      </div>
    );
  }
  if (props.payload === undefined) {
    return (
      <div class="note">
        <Icon name="clock" size={14} /> {props.loading}
      </div>
    );
  }
  return <>{props.children}</>;
}

/** ScanApplyActions — the Scan / Apply button pair (busy-aware) every
 *  job-remote tab renders in its actions bar. `applyDisabled` hides the
 *  apply button when there is nothing safe to apply; `applyTitle` carries
 *  the tab's own safety contract. */
export function ScanApplyActions(props: {
  busy: string | null;
  applyDisabled: boolean;
  scanTitle: string;
  applyTitle: string;
  applyLabel: (busy: boolean) => string;
  onScan: () => void;
  onApply: () => void;
}) {
  return (
    <>
      <button
        type="button"
        class="btn"
        disabled={props.busy !== null}
        onClick={props.onScan}
        title={props.scanTitle}
      >
        <Icon name="scan" size={14} />
        {props.busy === "scan" ? "Scanning…" : "Scan shelf"}
      </button>
      <button
        type="button"
        class="btn primary"
        disabled={props.busy !== null || props.applyDisabled}
        onClick={props.onApply}
        title={props.applyTitle}
      >
        <Icon name="check" size={14} />
        {props.busy === "apply"
          ? "Applying…"
          : props.applyLabel(props.busy === "apply")}
      </button>
    </>
  );
}
