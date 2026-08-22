import { describe, expect, test } from "bun:test";
import { RateLimiter, withRetry } from "./ratelimit";

const noSleep = async () => {};

describe("RateLimiter", () => {
  test("success resets failure ladder", () => {
    const rl = new RateLimiter({ minIntervalMs: 0 });
    expect(rl.failures).toBe(0);
    rl.success();
    expect(rl.failures).toBe(0);
  });

  test("backoff grows exponentially with jitter bounds", async () => {
    const waits: number[] = [];
    const rl = new RateLimiter({
      minIntervalMs: 0,
      baseBackoffMs: 1000,
      backoffMultiplier: 2,
      jitterFraction: 0,
      sleepFn: noSleep,
      onBackoff: (_a, ms) => waits.push(ms),
    });
    await rl.failure();
    await rl.failure();
    await rl.failure();
    expect(waits).toEqual([1000, 2000, 4000]);
  });

  test("backoff respects ceiling", async () => {
    const rl = new RateLimiter({
      minIntervalMs: 0,
      baseBackoffMs: 1000,
      backoffMultiplier: 10,
      maxBackoffMs: 5000,
      jitterFraction: 0,
      sleepFn: noSleep,
    });
    expect(await rl.failure()).toBe(1000);
    expect(await rl.failure()).toBe(5000);
    expect(await rl.failure()).toBe(5000);
  });

  test("jitter keeps waits within +/- fraction", async () => {
    const rl = new RateLimiter({
      minIntervalMs: 0,
      baseBackoffMs: 1000,
      jitterFraction: 0.25,
      sleepFn: noSleep,
    });
    for (let i = 0; i < 20; i++) {
      const wait = await rl.failure();
      expect(wait).toBeGreaterThanOrEqual(750);
      expect(wait).toBeLessThanOrEqual(1250);
      rl.success();
    }
  });

  test("acquire enforces minimum spacing", async () => {
    const rl = new RateLimiter({ minIntervalMs: 50, jitterFraction: 0 });
    await rl.acquire();
    const t0 = Date.now();
    await rl.acquire();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(40);
  });
});

describe("withRetry", () => {
  test("retries transient errors then succeeds", async () => {
    const rl = new RateLimiter({
      minIntervalMs: 0,
      baseBackoffMs: 1,
      jitterFraction: 0,
      sleepFn: noSleep,
    });
    let calls = 0;
    const result = await withRetry(
      rl,
      () => {
        calls++;
        if (calls < 3) throw new Error("HTTP 500");
        return Promise.resolve("ok");
      },
      { maxRetries: 3 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  test("GONE fails fast without retry", async () => {
    const rl = new RateLimiter({ minIntervalMs: 0, baseBackoffMs: 1, sleepFn: noSleep });
    let calls = 0;
    let sawGone = false;
    try {
      await withRetry(
        rl,
        () => {
          calls++;
          return Promise.reject(new Error("GONE"));
        },
        { maxRetries: 3, onGone: () => { sawGone = true; } },
      );
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toBe("GONE");
    }
    expect(calls).toBe(1);
    expect(sawGone).toBe(true);
  });

  test("gives up after maxRetries", async () => {
    const rl = new RateLimiter({ minIntervalMs: 0, baseBackoffMs: 1, jitterFraction: 0, sleepFn: noSleep });
    let calls = 0;
    try {
      await withRetry(
        rl,
        () => {
          calls++;
          return Promise.reject(new Error("flaky"));
        },
        { maxRetries: 2 },
      );
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toBe("flaky");
    }
    expect(calls).toBe(3);
  });
});
