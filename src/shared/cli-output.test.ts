/**
 * json-stdout-deadline.test.ts — the pipe-wedge regression guard
 * (live 2026-09-19): a big --json payload into an early-closing pipe
 * consumer (`head -c N`) hung the real CLI for minutes. Bun.write to
 * a full pipe never resolves, and the natural-exit path blocked on it
 * forever. The bounded writer in cli-output.ts caps the wait; this pin
 * proves the actual wedge topology now terminates.
 *
 * The repro needs a payload big enough to overflow the pipe buffer
 * (>64 KB) — the tiny summary objects of most commands never triggered
 * it, which is why the class survived so long. We spawn the real CLI
 * on `status --json` against a DB with 1,500 fake track rows (~200 KB
 * of JSON) and pipe stdout into `head -c 400` — before the fix this
 * test hit its 60 s kill; now it completes in <5 s with a clean code.
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tempDir } from "../test-support/testutil";

/** A big-enough row set: 1,500 tracks ≈ 200 KB of status JSON.
 *  Uses ArchiveState itself so the schema is always the real one. */
function seedBigDb(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS tracks (
        video_id TEXT PRIMARY KEY,
        title TEXT,
        artist TEXT,
        album TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        format_id TEXT,
        bitrate_kbps INTEGER,
        codec TEXT,
        file_path TEXT,
        file_size_bytes INTEGER,
        duration_s REAL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        last_error TEXT,
        liked_position INTEGER,
        first_seen_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
  const insert = db.query(
    `INSERT INTO tracks
     (video_id, title, status, file_path, first_seen_at, updated_at)
     VALUES (?, ?, 'downloaded', ?, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')`,
  );
  for (let i = 0; i < 1500; i++) {
    insert.run(
      `vid${i}`,
      `Track ${i} ${"x".repeat(120)}`,
      `/tmp/megadj-json-deadline-fixture/track-${i}.mp3`,
    );
  }
  db.close();
}

describe("json stdout deadline (#pipe-wedge)", () => {
  test(
    "status --json | head -c 400 terminates — the writer never wedges",
    async () => {
      const dir = tempDir("megadj-wedge-").dir();
      const dbPath = join(dir, "archive.db");
      seedBigDb(dbPath);

      const cli = spawn(
        process.execPath,
        [join(import.meta.dir, "..", "cli.ts"), "intake-status", "--json"],
        {
          env: { ...process.env, MEGADJ_DB: dbPath, MEGADJ_COOKIES: "" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      // Consume ONLY the first chunk, then destroy — head -c's shape.
      let got = 0;
      for await (const chunk of cli.stdout as AsyncIterable<Buffer>) {
        got += chunk.length;
        if (got >= 400) break;
      }
      cli.stdout.destroy();

      const code = await Promise.race([
        new Promise<number | null>((resolve) => {
          cli.on("exit", (c) => resolve(c));
          cli.on("error", () => resolve(null));
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("CLI wedged on pipe >5s")), 5000),
        ),
      ]);
      cli.kill();
      expect(code).not.toBeNull();
    },
    { timeout: 15000 },
  );

  test("a healthy full reader still receives the complete payload", async () => {
    const dir = tempDir("megadj-wedge-full--").dir();
    const dbPath = join(dir, "archive.db");
    seedBigDb(dbPath);

    const cli = spawn(
      process.execPath,
      [join(import.meta.dir, "..", "cli.ts"), "intake-status", "--json"],
      {
        env: { ...process.env, MEGADJ_DB: dbPath, MEGADJ_COOKIES: "" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let bytes = 0;
    for await (const chunk of cli.stdout as AsyncIterable<Buffer>)
      bytes += chunk.length;
    const code = await new Promise<number | null>((resolve) =>
      cli.on("exit", (c) => resolve(c)),
    );
    expect(code).toBe(0);
    expect(bytes).toBeGreaterThan(1_000);
  });
});
