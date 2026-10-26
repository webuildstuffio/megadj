/**
 * cli.test.ts — the MEGADJ_ALLOW_LINUX escape hatch (#514).
 *
 * assertMac fails fast off-darwin (exit 2) unless MEGADJ_ALLOW_LINUX is
 * the exact value "1" — the value CI sets so Linux runners can exercise
 * flag validation. A bare-truthiness check historically let "0" /
 * "false" / any nonempty string unlock every production command
 * (rekordbox, Pioneer hardware, DB writes) on unsupported hosts.
 *
 * cli.ts runs main() at module load, so these pins spawn the real entry
 * rather than importing it. They are meaningful only off-darwin — on
 * macOS hosts the guard is platform-open by design, so the suite skips.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tempDir } from "./test-support/testutil";

const CLI = join(import.meta.dir, "cli.ts");
const MACOS_ONLY = "macOS-only by design";

const fixtures = tempDir("megadj-cli-gate-").rippable();
afterAll(() => fixtures.rippleAll());

/** Spawn the real CLI with MEGADJ_ALLOW_LINUX forced to `value`
 *  (undefined strips it, defeating the CI-wide =1 setting). The gate
 *  sits after the help short-circuit, so an unknown command reaches it
 *  and the post-guard epilogue (exit 1, "unknown command") proves the
 *  hatch opened without touching any real command. */
function runCliWithAllowLinux(value: string | undefined): { code: number; stderr: string } {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== "MEGADJ_ALLOW_LINUX") env[k] = v;
  }
  if (value !== undefined) env["MEGADJ_ALLOW_LINUX"] = value;
  // ArchiveState's constructor eagerly creates the DB — keep it in the
  // rippable fixture dir, never the developer's default state path.
  env["MEGADJ_DB"] = join(fixtures.dir(), `allow-${String(value)}-db`);
  const p = Bun.spawnSync(["bun", CLI, "definitely-not-a-command"], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: p.exitCode, stderr: p.stderr.toString() };
}

describe('MEGADJ_ALLOW_LINUX opens the macOS-only gate only on "1" (#514)', () => {
  test.skipIf(process.platform === "darwin")(
    'unset / empty / "0" / "false" keep the fail-fast (exit 2)',
    () => {
      for (const value of [undefined, "", "0", "false"]) {
        const r = runCliWithAllowLinux(value);
        expect(r.code).toBe(2);
        expect(r.stderr).toContain(MACOS_ONLY);
      }
    },
    { timeout: 30_000 },
  );

  test.skipIf(process.platform === "darwin")(
    '"1" opens the hatch — the run proceeds past the guard',
    () => {
      const r = runCliWithAllowLinux("1");
      expect(r.stderr).not.toContain(MACOS_ONLY);
      expect(r.code).not.toBe(2);
    },
    { timeout: 15_000 },
  );
});
