import { describe, expect, test } from "bun:test";
import {
  createErrorThrottle,
  createJobRefreshCoalescer,
} from "../web/app/jobEvents";

describe("useJobEvents timing primitives", () => {
  test("coalesces a burst into one trailing job refresh", async () => {
    let calls = 0;
    const coalescer = createJobRefreshCoalescer(async () => {
      calls++;
    }, 10);

    coalescer.schedule();
    coalescer.schedule();
    coalescer.schedule();
    await Bun.sleep(20);
    expect(calls).toBe(1);

    coalescer.schedule();
    await Bun.sleep(20);
    expect(calls).toBe(2);
    coalescer.dispose();
  });

  test("disposing a pending refresh prevents the trailing call", async () => {
    let calls = 0;
    const coalescer = createJobRefreshCoalescer(async () => {
      calls++;
    }, 10);
    coalescer.schedule();
    coalescer.dispose();
    await Bun.sleep(20);
    expect(calls).toBe(0);
  });

  test("throttles repeated job-refresh errors for thirty seconds", () => {
    let now = 1_000;
    const reported: string[] = [];
    const report = createErrorThrottle(
      (error) => reported.push(String(error)),
      () => now,
      30_000,
    );

    report("first");
    now += 29_999;
    report("suppressed");
    now += 1;
    report("next");
    expect(reported).toEqual(["first", "next"]);
  });
});
