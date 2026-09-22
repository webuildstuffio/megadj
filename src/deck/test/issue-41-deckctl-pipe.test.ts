import { expect, test } from "bun:test";
import { join } from "node:path";

test("#41: a piped JSON payload larger than 64 KiB is never truncated", async () => {
  const marker = "x".repeat(128 * 1024);
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/api/interlock") {
        return Response.json({
          rekordbox_running: false,
          pid: null,
          marker,
        });
      }
      if (path === "/api/drives" || path === "/api/jobs") {
        return Response.json([]);
      }
      return new Response("not found", { status: 404 });
    },
  });
  const originalExitCode = process.exitCode;

  try {
    const proc = Bun.spawn(
      [
        process.execPath,
        "run",
        join("src", "deck", "deckctl.ts"),
        "status",
        "--json",
      ],
      {
        cwd: join(import.meta.dir, "..", "..", ".."),
        env: {
          ...process.env,
          CRATEDECK_PORT: String(server.port),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(code, stderr).toBe(0);
    expect(new TextEncoder().encode(stdout).byteLength).toBeGreaterThan(
      64 * 1024,
    );
    const parsed = JSON.parse(stdout) as {
      interlock?: { marker?: string };
    };
    expect(parsed.interlock?.marker).toBe(marker);
  } finally {
    process.exitCode = originalExitCode;
    server.stop(true);
  }
});
