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
import { readFile, appendFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import type { ArchiveState } from "../state";
import { embedArt, fetchImage, ARTWORK_EXTS } from "../../fulltags/src/exports";
import type { QueueEntry } from "./queue";

export type { QueueEntry };

export interface ArtworkOptions {
  state: ArchiveState;
  model?: string;
  maxImages?: number;
  dryRun?: boolean;
  onProgress?: (msg: string) => void;
  /** Machine-readable summary instead of human logs (P1: --json everywhere). */
  json?: boolean;
}

const DEFAULT_MODEL = "nano-banana-2-lite"; // $0.034/img — "a few cents max"
const QUEUE_PATH = () =>
  process.env.MEGADJ_ART_QUEUE ??
  `${process.env.HOME}/.local/state/megadj/artwork-queue.jsonl`;
const DONE_PATH = () => `${QUEUE_PATH()}.done`;

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

/** Embed a generated cover file as the front cover (any container). */
function embedArtwork(filePath: string, artPath: string): Promise<boolean> {
  return fetchImage(artPath).then((bytes) =>
    bytes ? embedArt(filePath, bytes) : false,
  );
}

export async function artwork(opts: ArtworkOptions): Promise<void> {
  const rawLog = opts.onProgress ?? ((m: string) => console.log(m));
  // --json mode (P1): human logs go quiet — the summary object is the only
  // stdout output so agents get parseable JSON.
  const log = opts.json && !opts.onProgress ? () => {} : rawLog;
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

  const { ImageClient } = (await import(
    process.env.IMAGE_MAKER_CLIENT ??
      `${process.env.HOME}/github/image-maker-cli/dist/client.js`
  )) as {
    ImageClient: new (apiKey: string) => {
      generate(req: {
        prompt: string;
        model: string;
        size: string;
        output: string;
        outputFormat: string;
      }): Promise<{ cost?: number }>;
    };
  };
  const client = new ImageClient(apiKey ?? "");
  const { mkdir } = await import("node:fs/promises");
  const coverDir = join(QUEUE_PATH(), "..", "artwork-covers");
  if (!opts.dryRun) await mkdir(coverDir, { recursive: true });

  let done = 0;
  let failed = 0;
  const doneLines: string[] = [];
  // Which batch entries actually LEFT the queue: embedded, or skipped as
  // unsupported (no point queuing a container that can't hold art).
  // Everything else (generation failed, embed failed) must stay queued —
  // the old rewrite (entries.slice(batch.length)) dropped the whole batch
  // slice, so a failed generation silently deleted its queue entry forever.
  const processedIdx = new Set<number>();

  for (let i = 0; i < batch.length; i++) {
    const entry = batch[i]!;
    if (!ARTWORK_EXTS.has(extname(entry.path).toLowerCase())) {
      log(`  - skip (unsupported container): ${basename(entry.path)}`);
      doneLines.push(JSON.stringify({ ...entry, result: "skipped-ext" }));
      processedIdx.add(i);
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
      const cost = result.cost;
      log(
        `    generated ${coverPath}${cost !== undefined ? ` ($${Number(cost).toFixed(3)})` : ""}`,
      );
      if (await embedArtwork(entry.path, coverPath)) {
        log("    embedded ✓");
        done++;
        processedIdx.add(i);
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
    // Rewrite the queue keeping only entries that neither embedded nor were
    // skipped as unsupported — failed generations stay queued for retry
    // (the slice-by-batch-size rewrite used to drop them forever).
    const remaining = entries.filter(
      (e) => !processedIdx.has(entries.indexOf(e)),
    );
    await Bun.write(
      QUEUE_PATH(),
      remaining.map((e) => JSON.stringify(e)).join("\n") +
        (remaining.length ? "\n" : ""),
    );
  }

  if (opts.json) {
    // P1 (--json on every command): one summary object on stdout, last.
    console.log(
      JSON.stringify({
        command: "artwork",
        dryRun: opts.dryRun ?? false,
        queued: entries.length,
        processed: batch.length,
        embedded: done,
        failed,
        leftInQueue: Math.max(0, entries.length - processedIdx.size),
      }),
    );
  } else {
    log(
      `\ndone: ${done} embedded, ${failed} failed` +
        (opts.dryRun ? " (dry run — nothing generated)" : "") +
        `, ${Math.max(0, entries.length - processedIdx.size)} left in queue`,
    );
  }
}
