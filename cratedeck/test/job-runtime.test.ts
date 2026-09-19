import { describe, expect, it } from "bun:test";
import {
  recordProgressIncrease,
  withJobBudget,
  type RunHandle,
} from "../src/job-runtime";

describe("job wall-clock budget", () => {
  it("cancels and kills whichever extracted leg owns the subprocess", async () => {
    let killed = false;
    const proc = {
      kill(): void {
        killed = true;
      },
    } as unknown as Bun.Subprocess;
    const handle: RunHandle = { cancelled: false, proc };
    const neverFinishes = new Promise<never>(() => {});

    await expect(withJobBudget(neverFinishes, handle, 0)).rejects.toThrow(
      "job exceeded its 0 min wall-clock budget — cancelled",
    );
    expect(handle.cancelled).toBe(true);
    expect(killed).toBe(true);
  });

  it("leaves a completed leg and its handle untouched", async () => {
    const handle: RunHandle = { cancelled: false };

    await expect(
      withJobBudget(Promise.resolve("done"), handle, 1),
    ).resolves.toBe("done");
    expect(handle.cancelled).toBe(false);
  });
});

describe("job stall progress clock", () => {
  it("moves only when the observed progress fraction increases", () => {
    const progressAt = new Map<string, number>();

    expect(recordProgressIncrease(progressAt, "job-1", null, 50)).toBe(false);
    expect(recordProgressIncrease(progressAt, "job-1", Number.NaN, 60)).toBe(
      false,
    );
    expect(recordProgressIncrease(progressAt, "job-1", 1.01, 70)).toBe(false);
    expect(progressAt.has("job-1")).toBe(false);
    expect(recordProgressIncrease(progressAt, "job-1", 0.25, 100)).toBe(true);
    expect(recordProgressIncrease(progressAt, "job-1", 0.25, 200)).toBe(false);
    expect(recordProgressIncrease(progressAt, "job-1", 0.2, 300)).toBe(false);
    expect(progressAt.get("job-1")).toBe(100);

    expect(recordProgressIncrease(progressAt, "job-1", 0.5, 400)).toBe(true);
    expect(progressAt.get("job-1")).toBe(400);
  });

  it("refreshes when a later stage restarts its own monotonic progress", () => {
    const progressAt = new Map<string, number>();

    expect(recordProgressIncrease(progressAt, "job-1", 1, 1_000, "copy")).toBe(
      true,
    );
    expect(
      recordProgressIncrease(progressAt, "job-1", 0.1, 2_000, "verify"),
    ).toBe(true);
    expect(
      recordProgressIncrease(progressAt, "job-1", 0.2, 3_000, "verify"),
    ).toBe(true);
    expect(progressAt.get("job-1")).toBe(3_000);
  });
});
