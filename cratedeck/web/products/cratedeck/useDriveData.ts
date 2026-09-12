import { useCallback, useEffect, useState } from "preact/hooks";
import type {
  DriveReport,
  Job,
  SnapshotData,
  TimelineEvent,
  VerifyReport,
} from "../../../shared/types";
import { errMessage } from "../../../shared/fmt";
import { ApiError, api, toast } from "../../ui/toast";
import type { HealthTabBench } from "./HealthTab";

export interface DriveDetail {
  drive: DriveReport["drive"];
  snapshot: SnapshotData | null;
  sync: DriveReport["sync"];
  master_name: string;
}

/** Page load state: a machine where every branch is named. */
export type DrivePageState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "not-found" }
  | { status: "ok"; detail: DriveDetail };

export interface DriveData {
  page: DrivePageState;
  report: (DriveReport & { overall?: string }) | null;
  timeline: TimelineEvent[];
  bench: HealthTabBench[];
  probes: { ran_at: number; mbps: number }[];
  jobs: Job[];
  verify: VerifyReport | null;
  refresh: () => Promise<void>;
}

/** Owns the drive detail's API fan-out and its two self-healing refresh
 * loops. Keeping this lifecycle outside DrivePage makes the page a
 * presentation/action shell and gives loading behavior one testable home. */
export function useDriveData(driveId: string): DriveData {
  const [page, setPage] = useState<DrivePageState>({ status: "loading" });
  const [report, setReport] = useState<
    (DriveReport & { overall?: string }) | null
  >(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [bench, setBench] = useState<HealthTabBench[]>([]);
  const [probes, setProbes] = useState<{ ran_at: number; mbps: number }[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [verify, setVerify] = useState<VerifyReport | null>(null);
  const loadError = page.status === "error" ? page.message : null;

  const refresh = useCallback(async () => {
    const enc = encodeURIComponent(driveId);
    try {
      const [
        detail,
        nextReport,
        nextTimeline,
        nextBench,
        nextProbes,
        nextJobs,
        nextVerify,
      ] = await Promise.all([
        api<DriveDetail>(`/api/drives/${enc}`, { quiet: true }),
        api<DriveReport>(`/api/drives/${enc}/report`, { quiet: true }),
        api<TimelineEvent[]>(`/api/drives/${enc}/timeline`, { quiet: true }),
        api<HealthTabBench[]>(`/api/drives/${enc}/benchmarks`, {
          quiet: true,
        }),
        api<{ ran_at: number; mbps: number }[]>(
          `/api/drives/${enc}/speedprobes`,
          { quiet: true },
        ),
        api<Job[]>(`/api/jobs?drive=${enc}`, { quiet: true }),
        api<VerifyReport>(`/api/drives/${enc}/verify`, { quiet: true }),
      ]);
      if (!detail?.drive) {
        // api() only gets here after a real 200, so this represents a stale
        // registry link rather than a transport failure.
        setPage({ status: "not-found" });
        return;
      }
      setPage({ status: "ok", detail });
      setReport(nextReport);
      setTimeline(nextTimeline);
      setBench(nextBench);
      setProbes(nextProbes);
      setJobs(nextJobs);
      setVerify(nextVerify);
    } catch (error) {
      // Keep a last good render visible while surfacing a failed refresh.
      console.error(`drive ${driveId} load failed`, error);
      if (error instanceof ApiError && error.status === 404) {
        setPage({ status: "not-found" });
        return;
      }
      const message = errMessage(error);
      setPage((previous) =>
        previous.status === "ok" ? previous : { status: "error", message },
      );
    }
  }, [driveId]);

  useEffect(() => {
    void refresh();
    // Adaptive cadence: 2s while jobs run, 10s idle. A frozen job payload
    // triggers a full reload after ~90s to recover a dropped SSE completion.
    let timer: ReturnType<typeof setTimeout>;
    let lastSnapshot = "";
    let stuckCount = 0;
    const loop = async (): Promise<void> => {
      try {
        const active = await api<Job[]>(
          `/api/jobs?drive=${encodeURIComponent(driveId)}&active=1`,
          { quiet: true },
        );
        const activeCount = Array.isArray(active) ? active.length : 0;
        if (activeCount > 0) {
          const snapshot = JSON.stringify(
            active.map((job) => [job.id, job.progress]),
          );
          stuckCount = snapshot === lastSnapshot ? stuckCount + 1 : 0;
          lastSnapshot = snapshot;
          if (stuckCount >= 45) {
            stuckCount = 0;
            lastSnapshot = "";
            await refresh();
          }
        } else {
          stuckCount = 0;
          lastSnapshot = "";
          // A failed first load must self-heal when the server comes back.
          if (loadError) await refresh();
        }
        timer = setTimeout(loop, activeCount > 0 ? 2_000 : 10_000);
      } catch (error) {
        console.debug(`drive ${driveId} activity poll failed`, error);
        timer = setTimeout(loop, 10_000);
      }
    };
    void loop();
    return () => clearTimeout(timer);
  }, [driveId, loadError, refresh]);

  const refreshJobs = useCallback(async (): Promise<void> => {
    try {
      setJobs(await api<Job[]>(`/api/jobs?drive=${driveId}`, { quiet: true }));
    } catch (error) {
      console.error(`jobs refresh for ${driveId} failed`, error);
      toast("job list refresh failed — server unreachable", "err");
    }
  }, [driveId]);

  useEffect(() => {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onJob = () => {
      const now = Date.now();
      if (now - last < 2_000) {
        if (!timer) {
          timer = setTimeout(
            () => {
              timer = null;
              last = Date.now();
              void refreshJobs();
            },
            2_000 - (now - last),
          );
        }
        return;
      }
      last = now;
      void refreshJobs();
    };
    window.addEventListener("cratedeck:job", onJob);
    return () => {
      window.removeEventListener("cratedeck:job", onJob);
      if (timer) clearTimeout(timer);
    };
  }, [refreshJobs]);

  return { page, report, timeline, bench, probes, jobs, verify, refresh };
}
