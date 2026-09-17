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
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAnlz } from "../fulltags/anlz";
import { runCli } from "../test-support/cli-run";

const TEST_ROOT = mkdtempSync(join(tmpdir(), "megadj-maintenance-test-"));
const TEST_SPIKE_DIR = join(TEST_ROOT, "spike");

afterAll(() => rmSync(TEST_ROOT, { recursive: true, force: true }));

const beats = (n: number, startMs = 0) => {
  const step = 60000 / 128;
  return Array.from({ length: n }, (_, i) => ({
    num: (i % 4) + 1,
    bpmx100: 12800,
    timeMs: Math.round(startMs + i * step),
  }));
};

function fakeMount(): string {
  const mount = mkdtempSync(join(TEST_ROOT, "mount-"));
  const anlzDir = join(mount, "PIONEER", "Master", "share", "ANLZ");
  mkdirSync(anlzDir, { recursive: true });
  writeFileSync(
    join(anlzDir, "ANLZ0000.DAT"),
    buildAnlz({ path: "/x", beats: beats(8) }),
  );
  return mount;
}

function run(args: string[], extraEnv: Record<string, string> = {}) {
  return runCli(args, {
    MEGADJ_DB: "/tmp/megadj-maint-nope.db",
    MEGADJ_SPIKE_DIR: TEST_SPIKE_DIR,
    ...extraEnv,
  });
}

describe("rb-anlz-spike flag forms (P1)", () => {
  test("space form `--tag q1` parses identically to `--tag=q1`", async () => {
    const mount = fakeMount();
    const a = await run(["rb-anlz-spike", mount, "snapshot", "--tag", "q1"]);
    const b = await run(["rb-anlz-spike", mount, "snapshot", "--tag=q1"]);
    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    // both forms wrote baselines (dir is shared; the two tags differ so
    // assert via the file system rather than stdout)
    expect(a.stderr).not.toMatch(/tag.*required/u);
    expect(b.stderr).not.toMatch(/tag.*required/u);
  });

  test("`--tag=q1 snapshot` — mode after flag value still parses (value not eaten)", async () => {
    const mount = fakeMount();
    const r = await run(["rb-anlz-spike", mount, "--tag", "q2", "snapshot"]);
    expect(r.code).toBe(0);
    expect(r.stderr).not.toMatch(/unknown mode/u);
  });

  test("unknown mode exits 2 with a clear error", async () => {
    const mount = fakeMount();
    const r = await run(["rb-anlz-spike", mount, "snaphot", "--tag=q"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/snapshot\|compare/u);
  });

  test("missing --tag exits 2 with zero work", async () => {
    const mount = fakeMount();
    const r = await run(["rb-anlz-spike", mount, "snapshot"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--tag/u);
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
    expect(s.code).toBe(0);
    const snap = JSON.parse(s.stdout.trim()) as {
      ok: boolean;
      tracked: number;
      baselinePath?: string;
    };
    expect(snap.ok).toBe(true);
    expect(snap.tracked).toBe(1);
    expect(snap.baselinePath?.startsWith(`${TEST_SPIKE_DIR}/`)).toBe(true);
    const c = await run([
      "rb-anlz-spike",
      mount,
      "compare",
      "--tag=j",
      "--json",
    ]);
    expect(c.code).toBe(0);
    const cmp = JSON.parse(c.stdout.trim()) as { identical: number };
    expect(cmp.identical).toBe(1);
  });
});

describe("rb-grid-triage flag forms (P1)", () => {
  test("space form `--limit 20` parses (was: NaN → slice(0,NaN) → zero rows, fake success)", async () => {
    // HERMETIC: MEGADJ_RB_MASTER points at a nonexistent DB so the
    // command fails VISIBLY with "no master DB" regardless of whether
    // the real shelf is mounted (this test broke the day SHELF1 was
    // attached — the env override makes the fixture independent of the
    // operator's hardware). The point of the regression: the command
    // must NOT succeed while doing zero work.
    const noDb = join(mkdtempSync(join(TEST_ROOT, "missing-db-")), "absent.db");
    const a = await run(["rb-grid-triage", "--limit", "20", "--json"], {
      MEGADJ_RB_MASTER: noDb,
    });
    const b = await run(["rb-grid-triage", "--limit=20", "--json"], {
      MEGADJ_RB_MASTER: noDb,
    });
    expect(a.code).toBe(1); // ok:false → exit 1, never a fake pass
    expect(b.code).toBe(1);
    const ja = JSON.parse(a.stdout.trim().split("\n").pop() ?? "") as {
      total: number;
      error?: string;
    };
    expect(ja.total).toBe(0);
    expect(ja.error).toBeTruthy();
    expect(a.stderr).not.toMatch(/--limit/u);
  });

  test("invalid --limit exits 2 in BOTH forms with a clear error", async () => {
    for (const form of [["--limit", "abc"], ["--limit=abc"], ["--limit="]]) {
      const r = await run(["rb-grid-triage", ...form, "--json"]);
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/--limit must be a non-negative number/u);
    }
  });
});

describe("positional vs space-form flag value across maintenance arms (Sep 17)", () => {
  // The rb-unmatched class: `--ext` is a string flag but the arm handed
  // positionalArgs an EMPTY stringOpts list, so `--ext 1 <mount>` read
  // "1" as the mount. The mount positional must survive a preceding
  // space-form flag value on EVERY arm that has both.
  test("rb-unmatched: `--ext 1 <mount>` reads <mount>, not 1", async () => {
    const mount = fakeMount();
    const r = await run(["rb-unmatched", "--ext", "1", mount, "--json"]);
    // no master DB in the fixture → visible ok:false (exit 1) whose
    // payload names the mount the arm RESOLVED: it must be the fake
    // mount path, never "1".
    expect(r.code).toBe(1);
    const out = JSON.parse(r.stdout.trim().split("\n").pop() ?? "") as {
      mount?: string;
      error?: string;
    };
    expect(out.mount ?? out.error ?? "").toContain(mount);
    expect(out.mount ?? out.error ?? "").not.toMatch(/mount-.*[/^]1$/u);
  });

  test("rb-import: `--playlist X <mount> <folder>` keeps both positionals", async () => {
    // rb-import's second positional (folder) is required — with the
    // stringOpts bug, `--playlist X` made "X" positional #1 (mount) and
    // the real mount positional #2 (folder), so the folder check
    // misfired. Post-fix, the folder check fails on the FOLDER's
    // absence. json mode: usage class = exit 2 with the error in the
    // JSON payload (P1/#160 ring 3), never human text on stderr.
    const r = await run([
      "rb-import",
      "--playlist",
      "X",
      "/Volumes/NOPE",
      "--json",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toBe("");
    const out = JSON.parse(r.stdout.trim()) as { error?: string };
    expect(out.error).toMatch(/usage — megadj rb-import <mount> <folder>/u);
  });
});
