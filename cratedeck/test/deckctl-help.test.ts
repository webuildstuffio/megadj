// deckctl-help.test.ts — the `help` verb + `--help` flag contract.
//
// Drives the REAL deckctl over a spawned process with CRATEDECK_PORT
// pointed at an unreachable port (same harness as mcp-protocol.test.ts):
// `deckctl help` reads the shared/help.ts SSOT directly, so it must work
// with the server DOWN — that's the point of an agent asking "what does
// Ghost mean" from a cold machine. Bugs this pins:
//   1. `--help` used to fall through to ensureServer() (booting a server
//      just to print usage) and then exit 2 — documentation is not a
//      usage error, and it must not need the server.
//   2. `help --json` must stay one parseable JSON object (P1: --json on
//      every verb, in every branch).
import { describe, it, expect } from "bun:test";
import { join } from "node:path";

/** Spawn deckctl with an unreachable server port; return exit code + output. */
async function runDeckctl(args: string[]): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn(["bun", "run", join("src", "deckctl.ts"), ...args], {
    cwd: join(import.meta.dir, ".."),
    env: {
      ...process.env,
      // Unreachable: anything requiring the server fails fast (exit 4);
      // `help`/`--help` never get that far — they must exit 0 offline.
      CRATEDECK_PORT: "59998",
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

describe("deckctl help + --help (work with the server down)", () => {
  it("--help prints usage and exits 0 without a server", async () => {
    const { code, stdout } = await runDeckctl(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("usage: deckctl");
    expect(stdout).toContain("help [term|kind]");
  });

  it("-h behaves identically", async () => {
    const { code, stdout } = await runDeckctl(["-h"]);
    expect(code).toBe(0);
    expect(stdout).toContain("usage: deckctl");
  });

  it("help prints glossary + jobs + surfaces, exit 0", async () => {
    const { code, stdout } = await runDeckctl(["help"]);
    expect(code).toBe(0);
    // glossary, job explainers, and the tour are all in the default dump
    expect(stdout).toContain("vocabulary");
    expect(stdout).toContain("Ghost");
    expect(stdout).toContain("the five jobs");
    expect(stdout).toContain("where everything lives");
  });

  it("help <term> deep-dives one glossary entry", async () => {
    const { code, stdout } = await runDeckctl(["help", "ghost"]);
    expect(code).toBe(0);
    expect(stdout).toContain("Ghost");
    expect(stdout).toContain("why it matters");
  });

  it("help <kind> explains a job (verify)", async () => {
    const { code, stdout } = await runDeckctl(["help", "verify"]);
    expect(code).toBe(0);
    expect(stdout).toContain("verify");
    expect(stdout).toContain("when to run");
  });

  it("job kinds win over same-named glossary terms (mirror = the JOB)", async () => {
    const { code, stdout } = await runDeckctl(["help", "mirror"]);
    expect(code).toBe(0);
    // the job explainer, not the glossary word "Mirror"
    expect(stdout).toContain("typical time");
    expect(stdout).toContain("when to run");
    expect(stdout).not.toContain("byte-for-byte second copy");
  });

  it("help --json emits one parseable object with all three sections", async () => {
    const { code, stdout } = await runDeckctl(["help", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim()) as {
      terms: unknown[];
      jobs: unknown[];
      surfaces: unknown[];
    };
    expect(parsed.terms.length).toBeGreaterThan(5);
    expect(parsed.jobs.length).toBe(5); // the five job kinds
    expect(parsed.surfaces.length).toBeGreaterThan(3);
  });

  it("help <term> --json emits the single entry", async () => {
    const { code, stdout } = await runDeckctl(["help", "interlock", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim()) as {
      term?: { term: string; def: string; why: string };
    };
    expect(parsed.term?.term).toBe("Interlock");
  });

  it("unknown help topic is a usage error (exit 2), not a server error", async () => {
    const { code, stderr } = await runDeckctl(["help", "no-such-term"]);
    expect(code).toBe(2);
    expect(stderr).toContain("no help entry");
  });

  it("help text stays in sync with the actual verbs (usage lists every case)", async () => {
    // read the source: every `case "x":` in main() must appear in usage()
    // (pre-server verbs come from PRE_SERVER_VERBS — help is in usage too)
    const src = await Bun.file(
      join(import.meta.dir, "..", "src", "deckctl.ts"),
    ).text();
    const cases = [...src.matchAll(/case "([a-z-]+)":/g)]
      .map((m) => m[1])
      .filter((v): v is string => v !== undefined);
    const preServer = (src.match(/PRE_SERVER_VERBS = \[([^\]]+)\]/)?.[1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/['"]/g, ""))
      .filter(Boolean);
    const usageStart = src.indexOf("function usageText()");
    const mainStart = src.indexOf("// ---- main", usageStart);
    const usage = src.slice(usageStart, mainStart > 0 ? mainStart : undefined);
    for (const verb of new Set([...cases, ...preServer])) {
      expect(
        usage.includes(verb),
        `usage text must document "${verb}"`,
      ).toBeTrue();
    }
  });
});
