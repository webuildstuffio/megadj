/**
 * Token-bucket rate limiter with jittered delays and exponential backoff
 * for transient failures. Designed for long-running archival against
 * YouTube so the account stays healthy and downloads never hammer.
 */

export interface RateLimiterOptions {
  /** Minimum gap between operations, ms. */
  minIntervalMs?: number;
  /** Base backoff for retries, ms. */
  baseBackoffMs?: number;
  /** Backoff multiplier per consecutive failure. */
  backoffMultiplier?: number;
  /** Ceiling for backoff, ms. */
  maxBackoffMs?: number;
  /** 0..1 fraction of jitter applied to sleeps (avoids thundering sync). */
  jitterFraction?: number;
  /** Called on every backoff so the UI can surface it. */
  onBackoff?: (attempt: number, waitMs: number, reason: string) => void;
  /** Called on every sleep (rate limit pacing). */
  onPace?: (waitMs: number) => void;
  /** Injectable sleep for tests. */
  sleepFn?: (ms: number) => Promise<void>;
}

const DEFAULTS = {
  minIntervalMs: 2_500,
  baseBackoffMs: 5_000,
  backoffMultiplier: 2,
  maxBackoffMs: 10 * 60_000,
  jitterFraction: 0.25,
} as const;

export class RateLimiter {
  private readonly opts: Required<
    Omit<RateLimiterOptions, "onBackoff" | "onPace" | "sleepFn">
  >;
  private readonly onBackoff?: RateLimiterOptions["onBackoff"];
  private readonly onPace?: RateLimiterOptions["onPace"];
  private readonly sleepFn: (ms: number) => Promise<void>;

  private lastOpAt = 0;
  private consecutiveFailures = 0;

  constructor(opts: RateLimiterOptions = {}) {
    const { onBackoff, onPace, sleepFn: injectedSleep, ...rest } = opts;
    this.opts = { ...DEFAULTS, ...rest };
    this.onBackoff = onBackoff;
    this.onPace = onPace;
    this.sleepFn =
      injectedSleep ??
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Uniform random in [-f, +f] * value. */
  private jitter(value: number): number {
    const f = this.opts.jitterFraction;
    const factor = 1 + (Math.random() * 2 - 1) * f;
    return Math.max(0, Math.round(value * factor));
  }

  private sleep(ms: number): Promise<void> {
    return this.sleepFn(ms);
  }

  /** Enforce minimum spacing between operations. Call before each op. */
  async acquire(): Promise<void> {
    const now = Date.now();
    const since = now - this.lastOpAt;
    if (since < this.opts.minIntervalMs) {
      const wait = this.jitter(this.opts.minIntervalMs - since);
      this.onPace?.(wait);
      await this.sleep(wait);
    }
    this.lastOpAt = Date.now();
  }

  /** Record a success; resets the backoff ladder. */
  success(): void {
    this.consecutiveFailures = 0;
  }

  /**
   * Record a failure and sleep for the exponentially-decayed backoff
   * with jitter. attemptNumber is 1-based.
   */
  async failure(reason = "transient"): Promise<number> {
    this.consecutiveFailures += 1;
    const raw =
      this.opts.baseBackoffMs *
      Math.pow(this.opts.backoffMultiplier, this.consecutiveFailures - 1);
    const capped = Math.min(raw, this.opts.maxBackoffMs);
    const wait = this.jitter(capped);
    this.onBackoff?.(this.consecutiveFailures, wait, reason);
    await this.sleep(wait);
    return wait;
  }

  /** Current consecutive failure count (for callers enforcing give-up). */
  get failures(): number {
    return this.consecutiveFailures;
  }
}

/**
 * Runs fn through the limiter with bounded retries. Distinct error
 * classes get distinct handling:
 *  - "gone"     -> permanent (video dead), fail fast, no retry
 *  - "throttle" -> hard backoff, retry
 *  - other      -> normal backoff ladder, retry up to maxRetries
 */
export async function withRetry<T>(
  limiter: RateLimiter,
  fn: () => Promise<T>,
  opts: { maxRetries?: number; onGone?: (e: Error) => void } = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await limiter.acquire();
    try {
      const result = await fn();
      limiter.success();
      return result;
    } catch (error) {
      lastError = error;
      const err = error as Error;
      if (err.message === "GONE") {
        opts.onGone?.(err);
        throw err;
      }
      if (attempt === maxRetries) break;
      await limiter.failure(err.message);
    }
  }
  throw lastError;
}
