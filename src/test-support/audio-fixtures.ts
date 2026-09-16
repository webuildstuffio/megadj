/**
 * audio-fixtures.ts — temp audio-file factory for tests (issue #146
 * builder 1).
 *
 * Replaces the hand-rolled ffmpeg `makeWav`/`makeWavPair`/`tone` blocks
 * in src/fulltags/convert.test.ts, src/shelf/shelf-dupescan.test.ts,
 * src/getdat/commands/ingest-md5-dedupe.test.ts,
 * src/getdat/commands/ingest-fingerprint.test.ts,
 * src/getdat/commands/intake-folders.e2e.test.ts, and the
 * `writeFileSync(file, "fake audio")` stand-ins in
 * src/fulltags/enrich.test.ts, src/fulltags/beats.test.ts,
 * src/fulltags/mood-queue.test.ts, src/getdat/commands/organize.test.ts,
 * src/getdat/commands/adopt.test.ts.
 *
 * Two tiers:
 *  - `writeFakeAudio` — a plain non-audio file. The groundTruth/probe
 *    paths only need a readable file; fields read false/null. Fast, no
 *    ffmpeg.
 *  - `ffmpegTone` / `makeWav` — a REAL container (ffmpeg lavfi sine).
 *    Byte-level suites (md5, fingerprint, wav→aiff) need real decodable
 *    audio. Every ffmpeg failure throws LOUDLY at the fixture (the Sep 15
 *    flake lesson: a silent ffmpeg OOM downstream reads like a dedupe
 *    regression).
 *
 * `freq` drives the fingerprint: two tones at different frequencies never
 * fingerprint-collide; one encode + copyFileSync gives byte-identical
 * twins (metadata rides in the header).
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Write a fake (non-audio) file, creating parent dirs. */
export function writeFakeAudio(
  path: string,
  content: string | Buffer = "not really audio, but exists",
): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

/** One real ffmpeg encode: a sine-tone WAV (pcm_s16le by default).
 *  Throws on ffmpeg failure — environment problems must be loud. */
export function ffmpegTone(
  path: string,
  opts: {
    freq?: number;
    seconds?: number;
    codec?: string;
    bitrate?: string;
    from?: string;
    title?: string;
  } = {},
): string {
  const {
    freq = 440,
    seconds = 65,
    codec = "pcm_s16le",
    bitrate,
    from,
    title,
  } = opts;
  mkdirSync(dirname(path), { recursive: true });
  const args = [
    "ffmpeg",
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    ...(from
      ? ["-i", from]
      : ["-f", "lavfi", "-i", `sine=frequency=${freq}:duration=${seconds}`]),
    "-c:a",
    codec,
    ...(bitrate ? ["-b:a", bitrate] : []),
    ...(title ? ["-metadata", `title=${title}`] : []),
    path,
  ];
  const proc = Bun.spawnSync(args);
  if (proc.exitCode !== 0 || !existsSync(path)) {
    throw new Error(
      `ffmpeg fixture encode failed for ${path} (exit ${proc.exitCode}): ${proc.stderr.toString().trim()} — environment problem, not a test regression`,
    );
  }
  return path;
}

/** Real WAV fixture: `makeWav(dir, name)` from the convert/intake suites. */
export function makeWav(
  dir: string,
  name: string,
  opts: { freq?: number; seconds?: number; title?: string } = {},
): string {
  return ffmpegTone(join(dir, name), {
    title: opts.title ?? name,
    ...(opts.freq !== undefined && { freq: opts.freq }),
    ...(opts.seconds !== undefined && { seconds: opts.seconds }),
  });
}

/** Byte-identical twin: encode once, copy under a second name (ffmpeg
 *  writes the title into the header, so two separate encodes differ in
 *  bytes AND size — a copy is the only true md5 twin). */
export function byteTwinPair(
  dir: string,
  names: [string, string],
  opts: { freq?: number; seconds?: number; title?: string } = {},
): [string, string] {
  const first = ffmpegTone(join(dir, names[0]), {
    ...(opts.freq !== undefined && { freq: opts.freq }),
    ...(opts.seconds !== undefined && { seconds: opts.seconds }),
    title: opts.title ?? "Track",
  });
  mkdirSync(dirname(join(dir, names[1])), { recursive: true });
  copyFileSync(first, join(dir, names[1]));
  return [first, join(dir, names[1])];
}
