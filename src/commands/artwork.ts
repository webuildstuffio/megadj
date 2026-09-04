/**
 * megadj artwork — process the queued no-artwork tracks through the local
 * image-maker CLI (OpenRouter image models). Bootlegs/edits rarely have
 * canonical cover art to fetch, so ingest flags them `queued` and writes
 * prompts; this command generates square covers (default nano-banana-2,
 * ~$0.034–0.07 per image) and embeds them. A hard cap keeps spend bounded.
 *
 * Queue file: ~/.local/state/megadj/artwork-queue.jsonl (written by ingest).
 * Env: OPENROUTER_API_KEY (required), MEGADJ_ART_MAX (max images, default 20).
 */

import { $ } from "bun";
import { readFile, appendFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { ArchiveState } from "../state";
import { extname } from "node:path";

export interface ArtworkOptions {
  state: ArchiveState;
  model?: string;
  maxImages?: number;
  dryRun?: boolean;
  onProgress?: (msg: string) => void;
}

const ARTWORK_EXTS = new Set([
  ".m4a",
  ".mp3",
  ".flac",
  ".aiff",
  ".aif",
  ".wav",
]);
const DEFAULT_MODEL = "nano-banana-2-lite"; // $0.034/img — "a few cents max"
const QUEUE_PATH = () =>
  process.env.MEGADJ_ART_QUEUE ??
  `${process.env.HOME}/.local/state/megadj/artwork-queue.jsonl`;
const DONE_PATH = () => `${QUEUE_PATH()}.done`;

interface QueueEntry {
  path: string;
  title: string;
  artist: string | null;
  album: string | null;
  reason: string;
  remixOf?: string | null;
}

/** Build the generation prompt from whatever track metadata we have. */
export function buildPrompt(entry: QueueEntry): string {
  const genreish = entry.album && !entry.album.includes("—") ? entry.album : "";
  const parts = [
    "Square album cover art for a DJ track",
    entry.artist ? `by ${entry.artist}` : "",
    entry.title ? `titled "${entry.title}"` : "",
    entry.remixOf ? `(remix of ${entry.remixOf})` : "",
    genreish ? `style: ${genreish}` : "",
    "bold graphic design, high contrast, club music aesthetic, no text, no words, no letters",
  ];
  return parts.filter(Boolean).join(". ");
}

async function embedArtwork(
  filePath: string,
  artPath: string,
): Promise<boolean> {
  const ext = extname(filePath).toLowerCase();
  // WAV: ffmpeg's wav muxer can't carry attached_pic — use mutagen APIC
  if (ext === ".wav") {
    const script = `
from mutagen.wave import WAVE
from mutagen.id3 import ID3, APIC
a = WAVE(${JSON.stringify(filePath)})
try:
    a.add_tags()
except Exception:
    pass
if not isinstance(a.tags, ID3):
    a.tags = ID3()
a.tags.add(APIC(encoding=3, mime="image/png", type=3, desc="Cover", data=open(${JSON.stringify(artPath)}, "rb").read()))
a.save()
print("ok")`;
    const proc = await $`uv run --with mutagen python -c ${script}`
      .quiet()
      .nothrow();
    return (
      proc.exitCode === 0 && (proc.stdout as Buffer).toString().includes("ok")
    );
  }
  const tmp = filePath.replace(/(\.[^.]+)$/, ".art$1");
  const args = ext === ".mp3" ? ["-id3v2_version", "3"] : [];
  const proc =
    await $`ffmpeg -y -hide_banner -loglevel error -i ${filePath} -i ${artPath} -map 0:a -map 1:v -c:a copy -c:v mjpeg -disposition:v:0 attached_pic ${args} ${tmp}`
      .quiet()
      .nothrow();
  if (proc.exitCode !== 0) return false;
  return (await $`mv -f ${tmp} ${filePath}`.quiet().nothrow()).exitCode === 0;
}

export async function artwork(opts: ArtworkOptions): Promise<void> {
  const log = opts.onProgress ?? ((m: string) => console.log(m));
  const model = opts.model ?? DEFAULT_MODEL;
  const max = opts.maxImages ?? Number(process.env.MEGADJ_ART_MAX ?? 20);
  const apiKey = process.env.OPENROUTER_API_KEY;

  let entries: QueueEntry[] = [];
  try {
    const raw = await readFile(QUEUE_PATH(), "utf8");
    entries = raw
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as QueueEntry);
  } catch {
    log(
      "queue is empty — nothing to do (entries appear after `megadj ingest`)",
    );
    return;
  }

  if (entries.length === 0) {
    log("queue is empty — nothing to do");
    return;
  }
  if (!apiKey && !opts.dryRun) {
    log("OPENROUTER_API_KEY not set — cannot generate. Export it and retry.");
    log(`queue (${entries.length} entries) is preserved at ${QUEUE_PATH()}`);
    process.exitCode = 1;
    return;
  }

  const batch = entries.slice(0, max);
  log(
    `${entries.length} queued entr(ies), processing ${batch.length}` +
      (entries.length > batch.length
        ? ` (${entries.length - batch.length} left for next run)`
        : "") +
      ` with ${model}` +
      (opts.dryRun ? " (dry run)" : ""),
  );

  const { ImageClient } =
    await import("~/github/image-maker-cli/dist/client.js");
  const client = new ImageClient(apiKey ?? "");
  const { mkdir } = await import("node:fs/promises");
  const coverDir = join(QUEUE_PATH(), "..", "artwork-covers");
  if (!opts.dryRun) await mkdir(coverDir, { recursive: true });

  let done = 0;
  let failed = 0;
  const doneLines: string[] = [];

  for (const entry of batch) {
    if (!ARTWORK_EXTS.has(extname(entry.path).toLowerCase())) {
      log(`  - skip (wav/aiff): ${basename(entry.path)}`);
      doneLines.push(JSON.stringify({ ...entry, result: "skipped-ext" }));
      continue;
    }
    const prompt = buildPrompt(entry);
    const coverPath = join(
      coverDir,
      `${basename(entry.path).replace(/\.[^.]+$/, "")}.png`,
    );
    log(`  ~ ${entry.title}${entry.artist ? ` — ${entry.artist}` : ""}`);
    log(`    prompt: ${prompt.slice(0, 110)}…`);
    if (opts.dryRun) continue;

    try {
      const result = await client.generate({
        prompt,
        model,
        size: "1024x1024",
        output: coverPath,
        outputFormat: "png",
      });
      const cost = (result as { cost?: number }).cost;
      log(
        `    generated ${coverPath}${cost !== undefined ? ` ($${Number(cost).toFixed(3)})` : ""}`,
      );
      if (await embedArtwork(entry.path, coverPath)) {
        log("    embedded ✓");
        done++;
        doneLines.push(
          JSON.stringify({ ...entry, result: "embedded", model, coverPath }),
        );
      } else {
        log("    embed FAILED — entry stays in queue");
        failed++;
      }
    } catch (err) {
      log(
        `    generation FAILED: ${err instanceof Error ? err.message : String(err)}`,
      );
      failed++;
    }
  }

  if (!opts.dryRun && doneLines.length > 0) {
    await appendFile(DONE_PATH(), doneLines.join("\n") + "\n", "utf8");
    // Rewrite the queue without processed entries.
    const remaining = entries.slice(batch.length);
    await Bun.write(
      QUEUE_PATH(),
      remaining.map((e) => JSON.stringify(e)).join("\n") +
        (remaining.length ? "\n" : ""),
    );
  }

  log(
    `\ndone: ${done} embedded, ${failed} failed` +
      (opts.dryRun ? " (dry run — nothing generated)" : "") +
      `, ${Math.max(0, entries.length - batch.length)} left in queue`,
  );
}
