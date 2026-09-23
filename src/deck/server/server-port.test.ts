import { afterAll, describe, expect, test } from "bun:test";
import { tempDir } from "../../test-support/testutil";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { resolveServerPort, DEFAULT_PORT } from "../server/server-port";

// #248 fixture seam: tempDir owns the mkdtemp lifecycle (ripple teardown).
const t = tempDir("cratedeck-port-").rippable();
afterAll(() => {
  t.rippleAll();
});

// Issue #227: ONE strict port resolution. The old twins disagreed —
// config.ts's `||` chain silently swallowed CRATEDECK_PORT=0/abc while
// deckapi's gates rejected them. Invalid env now throws with the value
// named; valid env wins over config; config wins over the default.

function withCfg(body: string | null): string {
  const dir = t.dir();
  if (body !== null) writeFileSync(join(dir, "config.toml"), body);
  return dir;
}

describe("resolveServerPort (#227 strictness)", () => {
  test("default when no env and no config", () => {
    const dir = withCfg(null);
    expect(resolveServerPort(undefined, join(dir, "config.toml"))).toBe(
      DEFAULT_PORT,
    );
    expect(resolveServerPort("", join(dir, "config.toml"))).toBe(DEFAULT_PORT);
    rmSync(dir, { recursive: true, force: true });
  });

  test("valid env beats config", () => {
    const dir = withCfg("[server]\nport = 9999\n");
    expect(resolveServerPort("8123", join(dir, "config.toml"))).toBe(8123);
    rmSync(dir, { recursive: true, force: true });
  });

  test("config port used when env unset (deckctl/mcp parity tier)", () => {
    const dir = withCfg("[server]\nport = 9999\n");
    expect(resolveServerPort(undefined, join(dir, "config.toml"))).toBe(9999);
    rmSync(dir, { recursive: true, force: true });
  });

  test("invalid env throws LOUDLY with the value named — never silent fallthrough", () => {
    const dir = withCfg("[server]\nport = 9999\n");
    for (const bad of ["abc", "0", "-5", "65536", "12.5", "0x10"]) {
      expect(() => resolveServerPort(bad, join(dir, "config.toml"))).toThrow(
        bad,
      );
    }
    // blank/whitespace-only = unset (same tier as an exported-empty var),
    // NOT invalid — it falls through to config/default like "not set"
    expect(resolveServerPort("  ", join(dir, "config.toml"))).toBe(9999);
    rmSync(dir, { recursive: true, force: true });
  });
});
