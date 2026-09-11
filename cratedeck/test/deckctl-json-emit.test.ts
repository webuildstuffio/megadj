// deckctl-json-emit.test.ts — the machine-output contract: `deckctl <verb>
// --json` piped to a consumer must yield ONE COMPLETE JSON document.
//
// The bug this pins (Sep 10): status --json emitted via console.log, whose
// stdout write is fire-and-forget. When stdout was a PIPE (json.load, jq,
// an agent's `| python -c json.load(sys.stdin)`), the process could exit
// before the tail flushed — the consumer read ~800 bytes of a ~97KB
// document and died with
//   json.decoder.JSONDecodeError: Unterminated string
// The fix: every JSON exit goes through emitJson (awaited Bun.write to
// Bun.stdout) + a flushStdout drain on every exit path. These tests spawn
// the real deckctl with piped stdout — exactly the failing topology — via
// server-less verbs only (help/--help read shared/help.ts directly), so no
// stray server is spawned to satisfy the probe.
import { describe, it, expect } from "bun:test";
import { join } from "node:path";

/** Spawn deckctl with piped stdout; return exit code + full stdout. */
async function runDeckctl(args: string[]): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn(["bun", "run", join("src", "deckctl.ts"), ...args], {
    cwd: join(import.meta.dir, ".."),
    env: {
      ...process.env,
      // Unreachable: never used by the server-less verbs under test, but
      // keeps an accidental regression from hitting the real dashboard.
      CRATEDECK_PORT: "59997",
      CRATEDECK_ENSURE_TIMEOUT_MS: "1500",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

describe("deckctl --json emit (piped consumer reads complete JSON)", () => {
  it("--help output is complete (usage text ends with the flag docs)", async () => {
    const { code, stdout } = await runDeckctl(["--help"]);
    expect(code).toBe(0);
    // pins the FULL document: the exact last line, no dropped tail
    expect(stdout.trimEnd().endsWith("(works with the server down)")).toBe(
      true,
    );
    expect(stdout).toContain("usage: deckctl <command> [args] [--json]");
  });

  it("help --json parses as one complete JSON document", async () => {
    const { code, stdout } = await runDeckctl(["help", "--json"]);
    expect(code).toBe(0);
    // full JSON.parse is the pin: the old truncated emit died mid-string
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(typeof parsed).toBe("object");
  });

  it("explain verify --json parses and carries the help-doc SSOT shape", async () => {
    const { code, stdout } = await runDeckctl(["explain", "verify", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as {
      verify?: { intro?: string; checks?: unknown[] };
    };
    expect(parsed.verify?.intro).toBeTruthy();
    expect(Array.isArray(parsed.verify?.checks)).toBe(true);
  });
});
