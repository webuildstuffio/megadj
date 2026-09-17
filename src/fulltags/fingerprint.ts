/**
 * fingerprint.ts — the chromaprint acoustic fingerprint probe (analysis
 * stage 1 of 3). Split from analysis.ts (#42 stage split).
 *
 * OFFLINE and file-first: reads the audio file itself, never the DB.
 * Idempotent-friendly: callers check the existing TXXX:ACOUSTID stamp
 * before spending compute.
 */
import { existsSync } from "node:fs";
import { parseJsonObject } from "./parse-json";

/** Parse fpcalc's JSON boundary. Null is an explicit malformed/schema-failed
 * result; callers preserve their documented degrade-to-null contract. */
export function parseFpcalcJson(raw: string): {
  fingerprint: string | null;
  durationS: number | null;
} | null {
  const value = parseJsonObject(raw);
  if (!value) return null;
  const fingerprint =
    typeof value.fingerprint === "string" ? value.fingerprint : null;
  const duration = value.duration;
  return {
    fingerprint,
    durationS:
      typeof duration === "number" && Number.isFinite(duration)
        ? Math.round(duration)
        : null,
  };
}

/** Where the OpenKeyScan analyzer repo is cloned (stdin/stdout JSON mode).
 * Override with FULLTAGS_KEYSCAN_DIR. Resolved lazily so tests/env can
 * set the variable at runtime. Lives beside the fingerprint probe because
 * both analysis passes share the "env dir + degrade-to-null" contract
 * (key-analysis.ts imports it from here — one env resolution, not two). */
export function keyscanDir(): string {
  return (
    process.env.FULLTAGS_KEYSCAN_DIR ??
    `${process.env.HOME}/.local/share/openkeyscan-analyzer`
  );
}

/** The shared fpcalc spawn + degrade contract (#99): run `fpcalc` with
 *  `args` and parse its stdout; null on unreadable file, missing binary
 *  (spawn throws ENOENT), or non-zero exit — degrade-to-null, never
 *  abort the caller's pass. All three fpcalc call sites (json
 *  fingerprint, `-length` dedupe fingerprint, duration companion) ride
 *  this frame; only the arg vector and parser differ. */
function runFpcalc<T>(
  args: string[],
  parse: (stdout: string) => T | null,
): T | null {
  let pr: Bun.SyncSubprocess;
  try {
    pr = Bun.spawnSync({
      cmd: ["fpcalc", ...args],
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    void error;
    return null; // fpcalc not installed
  }
  if (pr.exitCode !== 0) return null;
  return parse(new TextDecoder().decode(pr.stdout));
}

/** Chromaprint fingerprint (raw fpcalc output, base64). Null when the
 * file is unreadable or fpcalc is missing (brew install chromaprint).
 * Throws are caught — Bun.spawnSync throws ENOENT when the binary is
 * absent from PATH, and the stage contract is degrade-to-null, never
 * abort the caller's pass. */
export function fingerprintFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return runFpcalc(["-json", path], parseFpcalcJson)?.fingerprint ?? null;
}

/**
 * fingerprintFileLength — the dedupe-grade fingerprint (`fpcalc -length
 * 120`, raw text output parsed here). THE one spawn+parse for every
 * fingerprint pass in the repo (shelf-dupescan, shelf-dedupe,
 * shelf-hygiene) — previously three hand-copies whose base64url parse
 * regex omitted `-`/`_` and truncated at the first hyphen, colliding
 * unrelated files into fake duplicate groups (the Sep 11 mass-collision,
 * fixed in three places at once — this function exists so it can only be
 * fixed in one). Returns null when fpcalc is missing/fails or the file is
 * unreadable — degrade-to-null, never abort the caller's pass.
 */
export function fingerprintFileLength(path: string): string | null {
  if (!existsSync(path)) return null;
  return runFpcalc(["-length", "120", path], parseFpcalcOutput);
}

/** Parse fpcalc's raw `-length` stdout into a fingerprint. Base64url
 *  alphabet includes `-` and `_` — a char class without them truncates at
 *  the first hyphen and every file whose fingerprint shares the prefix
 *  collides into fake duplicate groups (the Sep 11 mass-collision;
 *  regression-tested in shelf-dupescan.test.ts). */
export function parseFpcalcOutput(stdout: string): string | null {
  const m = stdout.match(/FINGERPRINT=([A-Za-z0-9+=/_-]+)/);
  return m?.[1] ?? null;
}

/** Duration (s, rounded) as reported by fpcalc — cheap sanity companion
 * to the fingerprint. */
export function fingerprintWithDuration(path: string): {
  fingerprint: string | null;
  durationS: number | null;
} {
  if (!existsSync(path)) return { fingerprint: null, durationS: null };
  return (
    runFpcalc(["-json", path], parseFpcalcJson) ?? {
      fingerprint: null,
      durationS: null,
    }
  );
}
