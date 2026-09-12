export const JOB_EVENT_COALESCE_MS = 1_000;
export const JOB_ERROR_TOAST_MS = 30_000;

type Refresh = () => Promise<void>;

/** Coalesce a burst of job SSE events. The trailing refresh wins, so a
 * stream of progress ticks never causes a matching stream of SQLite reads. */
export function createJobRefreshCoalescer(
  refresh: Refresh,
  delayMs = JOB_EVENT_COALESCE_MS,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule(): void {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void refresh();
      }, delayMs);
    },
    dispose(): void {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Keep a failed background refresh visible without flooding the operator
 * with an identical toast once per SSE tick. */
export function createErrorThrottle(
  notify: (error: unknown) => void,
  now: () => number = Date.now,
  cooldownMs = JOB_ERROR_TOAST_MS,
): (error: unknown) => void {
  let lastAt = Number.NEGATIVE_INFINITY;
  return (error) => {
    const current = now();
    if (current - lastAt < cooldownMs) return;
    lastAt = current;
    notify(error);
  };
}
