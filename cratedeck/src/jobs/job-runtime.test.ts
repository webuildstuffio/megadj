import { describe, expect, it } from "bun:test";
import { tempDir } from "../../test/testutil";
import {
  recordProgressIncrease,
  withJobBudget,
  type RunHandle,
} from "./job-runtime";

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

// ---------------------------------------------------------------------------
// auditArchive degrade contract (#260 super-sure, Sep 20)
// ---------------------------------------------------------------------------
describe("auditArchive degrades instead of failing the job", () => {
  // The audit leg is a read-only post-check AFTER ingest's durable work:
  // a broken/empty child payload must NOT flip the whole ingest job to
  // "failed" (live Sep 20: job 42a682db died at 97% on JSON.parse("")). It
  // must resolve audit:null and log the reason. Driven through the REAL
  // spawn seam with an env-swapped megadj CLI that emits garbage.
  it("resolves audit:null when the child emits unparseable output", async () => {
    const { mkdirSync, rmSync, writeFileSync, chmodSync } =
      await import("node:fs");
    const { join } = await import("node:path");
    // #248 fixture seam: tempDir owns the mkdtemp lifecycle (this file's
    // fake-`bun` bin dir is test-owned throwaway).
    const t = tempDir("megadj-auditleg-").rippable();
    const tmp = t.dir();
    try {
      // A fake "bun" that ignores its args and prints a traceback-ish
      // fragment to stderr + nothing to stdout — the truncation shape.
      const binDir = join(tmp, "bin");
      const shellScript = join(binDir, "bun");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(
        shellScript,
        "#!/bin/sh\necho 'boom: child exploded' >&2\nexit 1\n",
      );
      chmodSync(shellScript, 0o755);
      const prevPath = process.env.PATH;
      process.env.PATH = `${binDir}:${prevPath}`;
      try {
        const { auditArchive } = await import("./job-legs-intake");
        const { loadConfig } = await import("../config");
        const cfg = loadConfig(join(import.meta.dir, ".."));
        const logs: string[] = [];
        const result = await auditArchive(
          cfg,
          { cancelled: false },
          () => {},
          (line: string) => logs.push(line),
        );
        expect(result.audit).toBeNull();
        expect(result.auditErrors).toEqual([]);
        expect(logs.some((l) => l.includes("audit leg failed to report"))).toBe(
          true,
        );
      } finally {
        process.env.PATH = prevPath;
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 30_000);
});
