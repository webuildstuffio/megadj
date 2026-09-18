/**
 * Shared mutagen-over-uv runner. Every mutagen call in fulltags is the
 * same shape: build a python script, `uv run --with mutagen python -c`,
 * read stdout, check for the "ok" sentinel or parse the last JSON line.
 * One runner here means the uv invocation (warm-env form, version pin
 * policy) can never drift between the writer and the readers.
 */
import { errMessage as errorText } from "../../../cratedeck/shared/fmt";
import { extname } from "node:path";

/** Run a mutagen python script, return trimmed stdout ("" on failure).
 * Never throws — spawn errors (uv missing, ENOENT) read as failure. */
function runMutagen(script: string): string {
  try {
    const pr = Bun.spawnSync({
      cmd: ["uv", "run", "--with", "mutagen", "python", "-c", script],
      stdout: "pipe",
    });
    if (pr.exitCode !== 0) return "";
    return new TextDecoder().decode(pr.stdout).trim();
  } catch (error) {
    void error;
    return "";
  }
}

/** Run a mutagen script that ends with `print("ok" + ` — true on ok. */
export function mutagenOk(script: string): boolean {
  return runMutagen(script) === "ok";
}

/** Run a mutagen script whose last stdout line is JSON — parsed, or the
 * caller's fallback on any failure (empty output, bad JSON). */
export function mutagenJson<T>(script: string, fallback: T): T {
  const parsed = parseMutagenJsonOutput<T>(runMutagen(script));
  if (parsed.ok) return parsed.value;
  console.error(`[${parsed.context}] ${parsed.detail}`);
  return fallback;
}

export type MutagenJsonParseResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      context: "fulltags mutagen subprocess";
      detail: string;
    };

/** Parse the final JSON line from mutagen. The failure result is contextual,
 * leaving mutagenJson free to preserve its fallback API while reporting why. */
export function parseMutagenJsonOutput<T = unknown>(
  stdout: string,
): MutagenJsonParseResult<T> {
  const context = "fulltags mutagen subprocess" as const;
  const last = stdout.trim().split("\n").at(-1);
  if (!last) return { ok: false, context, detail: "empty stdout" };
  try {
    const value: unknown = JSON.parse(last);
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return { ok: false, context, detail: "response is not an object" };
    return { ok: true, value: value as T };
  } catch (error) {
    return {
      ok: false,
      context,
      detail: `malformed JSON: ${errorText(error)}`,
    };
  }
}

/** Python opener line for the ID3-chunk containers (WAV RIFF / AIFF). */
export function id3Open(p: string): string {
  return extname(p).toLowerCase() === ".aiff" ||
    extname(p).toLowerCase() === ".aif"
    ? `from mutagen.aiff import AIFF\na = AIFF(${JSON.stringify(p)})`
    : `from mutagen.wave import WAVE\na = WAVE(${JSON.stringify(p)})`;
}
