import { useCallback, useEffect, useState } from "preact/hooks";
import type {
  DriveReport,
  Job,
  SnapshotData,
  TimelineEvent,
  VerifyReport,
} from "../../../shared/types";
import { errMessage } from "../../../../src/shared/leaf/fmt";
import { ApiError, api, toast } from "../../ui/toast";
import type { HealthTabBench } from "./HealthTab";

/** `PromiseRejectedResult.reason` is typed `any`; read it through an
 *  `{ reason: unknown }` view so the any never becomes an expression
 *  type (typecov 100% bar, #231 fan-out). */
function rejectedReason(result: PromiseSettledResult<unknown>): unknown {
  return result.status === "rejected"
    ? (result as { status: "rejected"; reason: unknown }).reason
    : undefined;
}

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
  /** #231: legs that failed on the LAST fan-out (page still renders from
   *  the healthy legs; each consumer shows its own degraded state). */
  degraded: Set<string>;
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
  const [degraded, setDegraded] = useState<Set<string>>(new Set());
  const loadError = page.status === "error" ? page.message : null;

  const refresh = useCallback(async () => {
    const enc = encodeURIComponent(driveId);
    // #231: allSettled the fan-out — one dead leg must not blank the
    // six healthy ones. The DETAIL leg owns the page gate (its failure
    // is the page's failure); every other leg degrades its own panel.
    // A named tuple (not Object.values, which erases element types)
    // keeps every leg's fulfilled-value fully typed.
    const [detailR, reportR, timelineR, benchR, probesR, jobsR, verifyR] =
      await Promise.allSettled([
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
    const legNames = [
      "detail",
      "report",
      "timeline",
      "bench",
      "probes",
      "jobs",
      "verify",
    ] as const;
    const failed = new Set<string>(
      legNames.filter(
        (_, i) =>
          [detailR, reportR, timelineR, benchR, probesR, jobsR, verifyR][i]
            ?.status === "rejected",
      ),
    );

    if (failed.has("detail")) {
      // The page-defining leg failed — distinguish 404 (gone) from
      // transport/500 (retryable) exactly as before.
      const reason: unknown = rejectedReason(detailR);

      console.error(`drive ${driveId} load failed`, reason);
      if (reason instanceof ApiError && reason.status === 404) {
        setPage({ status: "not-found" });
        return;
      }
      const message = errMessage(reason);
      setPage((previous) =>
        previous.status === "ok" ? previous : { status: "error", message },
      );
      setDegraded(failed);
      return;
    }

    if (detailR.status !== "fulfilled" || !detailR.value?.drive) {
      // api() only gets here after a real 200, so this represents a stale
      // registry link rather than a transport failure.
      setPage({ status: "not-found" });
      return;
    }
    const detail = detailR.value;
    // Keep the LAST GOOD payload for a failed leg (stale beats blank);
    // only a fulfilled leg replaces its state.
    if (reportR.status === "fulfilled") setReport(reportR.value);
    if (timelineR.status === "fulfilled") setTimeline(timelineR.value);
    if (benchR.status === "fulfilled") setBench(benchR.value);
    if (probesR.status === "fulfilled") setProbes(probesR.value);
    if (jobsR.status === "fulfilled") setJobs(jobsR.value);
    if (verifyR.status === "fulfilled") setVerify(verifyR.value);
    setPage({ status: "ok", detail });
    setDegraded(failed);
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

  return {
    page,
    report,
    timeline,
    bench,
    probes,
    jobs,
    verify,
    degraded,
    refresh,
  };
}
