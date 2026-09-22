// server-port.ts — THE port resolution (issue #227). Two hand-rolled
// chains used to live in config.ts (lenient `||` rank-fallthrough:
// CRATEDECK_PORT=0/abc silently lost to config) and deckapi.ts (strict
// gates) — the same env→config→default surface with different
// strictness, the S14 config-twin class. The port is the load-bearing
// shared surface between `deck` server, `deckctl`, and `mcp`: a
// silently discarded env value sends the CLI/MCP against the wrong
// port (probe fails → ensureServer spawns a SECOND server over one
// SQLite DB).
//
// Resolution: CRATEDECK_PORT env → config port → default 7742.
// An INVALID env value (non-integer, ≤0, >65535) throws — operators
// get the invalid value named, never a silent rank-fallthrough.
import { existsSync, readFileSync } from "node:fs";

export const DEFAULT_PORT = 7742;

/** Parse one candidate: finite integer in 1..65535, else null.
 *  Regex-gated so "12.5" and "0x10" reject instead of parseInt-truncating
 *  to 12/0 (the silent-mangle trap the lenient twin had). */
function strictPort(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? n : null;
}

/** First `port = <int>` line of a config.toml-shaped text → number|null.
 *  Same regex shape deckapi's twin used, so existing configs keep
 *  resolving identically. */
function configPortFrom(text: string): number | null {
  for (const line of text.split("\n")) {
    const m = /^\s*port\s*=\s*(\d+)/.exec(line);
    if (m?.[1]) return strictPort(m[1]);
  }
  return null;
}

/**
 * Resolve the CrateDeck server port. env > config file > default;
 * an invalid CRATEDECK_PORT throws (server: boot refuses; CLI/MCP:
 * the throw surfaces before any request is made).
 *
 * @param envPort raw CRATEDECK_PORT value (undefined = unset)
 * @param configPath path to config.toml; missing file = no config tier
 */
export function resolveServerPort(
  envPort: string | undefined,
  configPath: string,
): number {
  const raw = envPort?.trim();
  if (raw !== undefined && raw !== "") {
    const parsed = strictPort(raw);
    if (parsed === null) {
      throw new Error(
        `invalid CRATEDECK_PORT '${envPort}' — must be an integer 1..65535`,
      );
    }
    return parsed;
  }
  if (existsSync(configPath)) {
    const fromCfg = configPortFrom(readFileSync(configPath, "utf8"));
    if (fromCfg !== null) return fromCfg;
  }
  return DEFAULT_PORT;
}
