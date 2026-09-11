import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DB } from "../src/db";

const DRIVE_ID = "1111-2222-3333";

describe("issue #33: process-crash recovery", () => {
  test("a SIGKILL during a running job is recovered on the next boot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cratedeck-kill-9-"));
    const dbPath = join(dir, "db.sqlite");
    const dbUrl = new URL("../src/db.ts", import.meta.url).href;
    const childCode = `
      import { DB } from ${JSON.stringify(dbUrl)};
      const db = new DB(${JSON.stringify(dbPath)});
      db.upsertDrive({ id: ${JSON.stringify(DRIVE_ID)}, volume_uuid: ${JSON.stringify(DRIVE_ID)}, name: "CRASH_TEST", mounted: true });
      db.insertJob({ id: "killed-job", drive_id: ${JSON.stringify(DRIVE_ID)}, kind: "verify", status: "running", progress: 0.5, message: null, phase: null, eta_seconds: null, error: null, result_json: null, log_path: null, created_at: Date.now(), started_at: Date.now(), finished_at: null });
      console.log("READY");
      setInterval(() => {}, 1_000);
    `;
    const child = Bun.spawn([process.execPath, "-e", childCode], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const ready = await child.stdout.getReader().read();
    expect(new TextDecoder().decode(ready.value)).toContain("READY");
    child.kill("SIGKILL");
    await child.exited;

    const restarted = new DB(dbPath);
    expect(restarted.reapOrphanJobs()).toBe(1);
    expect(restarted.getJob("killed-job")?.status).toBe("interrupted");
    restarted.sqlite.close();
  });

  test("timeline event retention remains capped across a database restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "cratedeck-event-cap-"));
    const dbPath = join(dir, "db.sqlite");
    const db = new DB(dbPath);
    db.upsertDrive({
      id: DRIVE_ID,
      volume_uuid: DRIVE_ID,
      name: "CAP_TEST",
      mounted: true,
    });
    for (let i = 0; i < 2_005; i++) db.event(DRIVE_ID, "scan", { i });
    expect(db.timeline(DRIVE_ID, 3_000)).toHaveLength(2_000);
    db.sqlite.close();

    const restarted = new DB(dbPath);
    expect(restarted.timeline(DRIVE_ID, 3_000)).toHaveLength(2_000);
    restarted.sqlite.close();
  });
});
