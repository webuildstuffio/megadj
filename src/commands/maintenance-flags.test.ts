/**
 * maintenance-cmds flag parsing — super-sure regression (Sep 10). The
 * maintenance family hand-rolled its flag parsing and broke three ways:
 * space-form flags documented in usage/runbook (`--tag q1`, `--limit
 * 20`) silently didn't parse; `--limit 20` became NaN and
 * `slice(0, Math.max(0, NaN))` triaged ZERO rows while "succeeding";
 * the positional filter ate the `compare` mode word. All forms now go
 * through cli-flags.ts and are pinned here, end-to-end on the real CLI
 * (P1: parse errors exit 2 with a clear stderr line, zero work).
 */
import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildAnlz } from "../../fulltags/src/anlz";

const beats = (n: number, startMs = 0) => {
  const step = 60000 / 128;
  return Array.from({ length: n }, (_, i) => ({
    num: (i % 4) + 1,
    bpmx100: 12800,
    timeMs: Math.round(startMs + i * step),
  }));
};

function fakeMount(): string {
  const mount = mkdtempSync("/tmp/megadj-maint-");
  const anlzDir = join(mount, "PIONEER", "Master", "share", "ANLZ");
  mkdirSync(anlzDir, { recursive: true });
  writeFileSync(
    join(anlzDir, "ANLZ0000.DAT"),
    buildAnlz({ path: "/x", beats: beats(8) }),
  );
  return mount;
}

const cli = join(import.meta.dir, "../cli.ts");

async function run(args: string[], extraEnv: Record<string, string> = {}) {
  return $`bun run ${cli} ${args}`
    .env({
      ...process.env,
      MEGADJ_DB: "/tmp/megadj-maint-nope.db",
      ...extraEnv,
    })
    .quiet()
    .nothrow();
}

describe("rb-anlz-spike flag forms (P1)", () => {
  test("space form `--tag q1` parses identically to `--tag=q1`", async () => {
    const mount = fakeMount();
    const a = await run(["rb-anlz-spike", mount, "snapshot", "--tag", "q1"]);
    const b = await run(["rb-anlz-spike", mount, "snapshot", "--tag=q1"]);
    expect(a.exitCode).toBe(0);
    expect(b.exitCode).toBe(0);
    // both forms wrote baselines (dir is shared; the two tags differ so
    // assert via the file system rather than stdout)
    expect(a.stderr.toString()).not.toMatch(/tag.*required/u);
    expect(b.stderr.toString()).not.toMatch(/tag.*required/u);
  });

  test("`--tag=q1 snapshot` — mode after flag value still parses (value not eaten)", async () => {
    const mount = fakeMount();
    const r = await run(["rb-anlz-spike", mount, "--tag", "q2", "snapshot"]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr.toString()).not.toMatch(/unknown mode/u);
  });

  test("unknown mode exits 2 with a clear error", async () => {
    const mount = fakeMount();
    const r = await run(["rb-anlz-spike", mount, "snaphot", "--tag=q"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr.toString()).toMatch(/snapshot\|compare/u);
  });

  test("missing --tag exits 2 with zero work", async () => {
    const mount = fakeMount();
    const r = await run(["rb-anlz-spike", mount, "snapshot"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr.toString()).toMatch(/--tag/u);
  });

  test("--json emits exactly one parseable object (snapshot + compare round-trip)", async () => {
    const mount = fakeMount();
    const s = await run([
      "rb-anlz-spike",
      mount,
      "snapshot",
      "--tag=j",
      "--json",
    ]);
    expect(s.exitCode).toBe(0);
    const snap = JSON.parse(s.stdout.toString().trim()) as {
      ok: boolean;
      tracked: number;
    };
    expect(snap.ok).toBe(true);
    expect(snap.tracked).toBe(1);
    const c = await run([
      "rb-anlz-spike",
      mount,
      "compare",
      "--tag=j",
      "--json",
    ]);
    expect(c.exitCode).toBe(0);
    const cmp = JSON.parse(c.stdout.toString().trim()) as { identical: number };
    expect(cmp.identical).toBe(1);
  });
});

describe("rb-grid-triage flag forms (P1)", () => {
  test("space form `--limit 20` parses (was: NaN → slice(0,NaN) → zero rows, fake success)", async () => {
    // The shelf volume won't exist in CI, so the command should fail
    // VISIBLY with "no master DB" — the point of this regression is
    // that it must NOT succeed while doing zero work.
    const a = await run(["rb-grid-triage", "--limit", "20", "--json"]);
    const b = await run(["rb-grid-triage", "--limit=20", "--json"]);
    expect(a.exitCode).toBe(1); // ok:false → exit 1, never a fake pass
    expect(b.exitCode).toBe(1);
    const ja = JSON.parse(
      a.stdout.toString().trim().split("\n").pop() ?? "",
    ) as {
      total: number;
      error?: string;
    };
    expect(ja.total).toBe(0);
    expect(ja.error).toBeTruthy();
    expect(a.stderr.toString()).not.toMatch(/--limit/u);
  });

  test("invalid --limit exits 2 in BOTH forms with a clear error", async () => {
    for (const form of [["--limit", "abc"], ["--limit=abc"], ["--limit="]]) {
      const r = await run(["rb-grid-triage", ...form, "--json"]);
      expect(r.exitCode).toBe(2);
      expect(r.stderr.toString()).toMatch(
        /--limit must be a non-negative number/u,
      );
    }
  });
});
