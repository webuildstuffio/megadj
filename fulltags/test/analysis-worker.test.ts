import { describe, test, expect } from "bun:test";
import {
  openWorkerSession,
  readUntilLine,
  writeNdjsonRequest,
  lineIsReady,
  lineHasRequestId,
} from "../src/analysis-worker";
import { lineReader } from "../src/stdio";
import { join } from "node:path";

/** The fake workers live as real files: `bun -e` heredoc scripts proved
 *  flaky as stdin-driven processes (the echo worker must exit only after
 *  its reply is flushed). Files are hermetic and race-free. */
const FAKE_ECHO = join(import.meta.dir, "fixtures", "fake-echo-worker.ts");
const FAKE_IDLE = join(import.meta.dir, "fixtures", "idle-worker.ts");

describe("analysis-worker session kit (#189)", () => {
  test("readUntilLine: skips noise lines, matches pred, null on EOF", async () => {
    const script =
      'process.stdout.write("noise\\nmore noise\\n" + JSON.stringify({ hit: 1 }) + "\\n");';
    const proc = Bun.spawn({
      cmd: ["bun", "-e", script],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });
    const lr = lineReader(proc.stdout as ReadableStream);
    const line = await readUntilLine(lr, (l) => l.includes("hit"), 2_000);
    expect(line).not.toBeNull();
    expect(JSON.parse(line!).hit).toBe(1);
    // stream drained → next read hits EOF → null (no hang)
    expect(await readUntilLine(lr, () => true, 500)).toBeNull();
    proc.kill();
  });

  test("timeout-kill: a slow reply kills the session — next request is null, never misattributed", async () => {
    // The worker answers after 2s; the session's per-request budget is
    // 200ms — the first request times out, the session must die, and a
    // second request must get null WITHOUT receiving the FIRST request's
    // late reply (the misattribution the kill semantics exist to prevent).
    const session = await openWorkerSession<
      string,
      { id: string; ok: boolean }
    >({
      spawn: () =>
        Bun.spawn({
          cmd: ["bun", FAKE_ECHO, "2000"],
          stdin: "pipe",
          stdout: "pipe",
          stderr: "ignore",
        }),
      isReady: lineIsReady,
      readyTimeoutMs: 2_000,
      encodeRequest: (id, enc, proc) =>
        writeNdjsonRequest(proc, enc, { id, path: id }),
      isResponse: lineHasRequestId,
      responseTimeoutMs: 200,
      parse: (line) => JSON.parse(line) as { id: string; ok: boolean },
    });
    expect(session).toBeTruthy();
    const first = await session!.analyze("req-1");
    expect(first).toBeNull(); // timed out → null
    const second = await session!.analyze("req-2");
    expect(second).toBeNull(); // dead session → null (never req-1's reply)
    session!.close();
    session!.close(); // idempotent
  });

  test("handshake failure (no ready line) → null session, worker reaped", async () => {
    // A worker that never announces ready: openWorkerSession must return
    // null and kill the process (degrade-to-null contract).
    let spawned: Bun.Subprocess | null = null;
    const session = await openWorkerSession<string, unknown>({
      spawn: () => {
        spawned = Bun.spawn({
          cmd: ["bun", FAKE_IDLE],
          stdin: "pipe",
          stdout: "pipe",
          stderr: "ignore",
        });
        return spawned;
      },
      isReady: lineIsReady,
      readyTimeoutMs: 300,
      encodeRequest: () => undefined,
      isResponse: () => true,
      responseTimeoutMs: 100,
      parse: () => null,
    });
    expect(session).toBeNull();
    // reaped by the kit — the exit info lands only after the exit event
    // settles (SIGTERM sets signalCode, not exitCode)
    await spawned!.exited;
    expect(spawned!.exitCode !== null || spawned!.signalCode !== null).toBe(
      true,
    );
  });
});
