import { describe, expect, it } from "bun:test";
import { withJobBudget, type RunHandle } from "../src/job_runtime";

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
