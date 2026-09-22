import { useEffect, useRef } from "preact/hooks";
import type { InterlockState } from "../../shared/types";
import { createErrorThrottle, createJobRefreshCoalescer } from "./jobEvents";

type Refresh = () => Promise<void>;

export function useJobEvents(props: {
  refreshDrives: Refresh;
  refreshJobs: Refresh;
  refreshInterlock: () => Promise<InterlockState>;
  reportDrivesError: (error: unknown) => void;
  reportJobsError: (error: unknown) => void;
  setInterlock: (state: InterlockState) => void;
}): void {
  const onJobsError = useRef(props.reportJobsError);
  onJobsError.current = props.reportJobsError;
  const reportJobsError = useRef<((error: unknown) => void) | null>(null);
  if (!reportJobsError.current) {
    reportJobsError.current = createErrorThrottle((error) =>
      onJobsError.current(error),
    );
  }
  const onDrivesError = useRef(props.reportDrivesError);
  onDrivesError.current = props.reportDrivesError;
  const reportDrivesError = useRef<((error: unknown) => void) | null>(null);
  if (!reportDrivesError.current) {
    reportDrivesError.current = createErrorThrottle((error) =>
      onDrivesError.current(error),
    );
  }

  useEffect(() => {
    const refreshJobs = async (): Promise<void> => {
      try {
        await props.refreshJobs();
      } catch (error) {
        console.error("jobs refresh failed", error);
        reportJobsError.current?.(error);
      }
    };
    const refreshDrives = async (): Promise<void> => {
      try {
        await props.refreshDrives();
      } catch (error) {
        reportDrivesError.current?.(error);
      }
    };
    const coalescer = createJobRefreshCoalescer(refreshJobs);
    void refreshDrives();
    void refreshJobs();

    const es = new EventSource("/api/events");
    es.addEventListener("drives", () => void refreshDrives());
    es.addEventListener("interlock", (event) => {
      try {
        const data: unknown = JSON.parse(
          (event as MessageEvent<string>).data ?? "null",
        );
        if (
          data &&
          typeof data === "object" &&
          typeof (data as { rekordbox_running?: unknown }).rekordbox_running ===
            "boolean"
        ) {
          props.setInterlock(data as InterlockState);
        } else {
          console.error("interlock SSE payload failed shape check", data);
        }
      } catch (error) {
        console.error("interlock SSE event was not valid JSON", error);
      }
    });
    es.addEventListener("job", () => {
      coalescer.schedule();
      window.dispatchEvent(new CustomEvent("cratedeck:job"));
    });
    es.addEventListener("open", () => void refreshJobs());

    const interlockPoll = setInterval(async () => {
      try {
        props.setInterlock(await props.refreshInterlock());
      } catch (error) {
        // The server-side interlock remains authoritative. This poll only
        // heals a dropped SSE update, so it must not interrupt the operator.
        console.debug("interlock advisory refresh failed", error);
      }
    }, 3_000);
    const drivesPoll = setInterval(() => void refreshDrives(), 10_000);

    return () => {
      es.close();
      coalescer.dispose();
      clearInterval(interlockPoll);
      clearInterval(drivesPoll);
    };
  }, [
    props.refreshDrives,
    props.refreshInterlock,
    props.refreshJobs,
    props.reportDrivesError,
    props.setInterlock,
  ]);
}
