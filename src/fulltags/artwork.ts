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
import type { ArchiveState } from "../archive/state";
import { embedArt, fetchImage, ARTWORK_EXTS } from "../../fulltags/src/exports";
import type { QueueEntry } from "../getdat/commands/queue";
import { commandLog } from "../progress";

export type { QueueEntry };

export interface ArtworkOptions {
  state: ArchiveState;
  model?: string | undefined;
  maxImages?: number | undefined;
  dryRun?: boolean | undefined;
  onProgress?: ((msg: string) => void) | undefined;
  /** Machine-readable summary instead of human logs (P1: --json everywhere). */
  json?: boolean | undefined;
}

const DEFAULT_MODEL = "nano-banana-2-lite"; // $0.034/img — "a few cents max"
const QUEUE_PATH = () =>
  process.env.MEGADJ_ART_QUEUE ??
  `${process.env.HOME}/.local/state/megadj/artwork-queue.jsonl`;
const DONE_PATH = () => `${QUEUE_PATH()}.done`;

/**
 * Parse JSONL queue content. One corrupt line (partial write, hand edit)
 * never bricks the pass: bad lines are skipped and counted — the caller
 * surfaces them — instead of the old all-or-nothing `JSON.parse` throw that
 * reported a non-empty queue as "queue is empty" (exit 0, nothing done).
 * Exported for tests. Returns null when the file is missing/unreadable.
 */
export function parseQueue(raw: string): {
  entries: QueueEntry[];
  badLines: number;
} {
  let badLines = 0;
  const entries = raw
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as QueueEntry];
      } catch {
        badLines++;
        return [];
      }
    });
  return { entries, badLines };
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
    // User preference (Sep 10 2026): the artwork must be a full 1:1 square
    // composition framed by a clean white border — looks intentional on
    // the CDJ grid instead of bleeding to the edges.
    "full square 1:1 composition with a clean solid white border frame around the entire image",
  ];
  return parts.filter(Boolean).join(". ");
}

/** Embed a generated cover file as the front cover (any container).
 * The generated cover is a LOCAL path (artwork-covers/<name>.png) —
 * read it from disk directly; `fetchImage` is http-only, so routing the
 * local file through it failed every embed (Sep 10 2026: a generated
 * cover sat unread while the queue reported "embed FAILED"). HTTP URLs
 * still go through fetchImage (mp3-twin art, future remote sources). */
async function embedArtwork(
  filePath: string,
  artPath: string,
): Promise<boolean> {
  const bytes = /^https?:\/\//i.test(artPath)
    ? await fetchImage(artPath)
    : await readFile(artPath).then(
        (b) => new Uint8Array(b),
        () => null,
      );
  return bytes ? embedArt(filePath, bytes) : false;
}

interface ArtworkCounters {
  done: number;
  failed: number;
}

/** Load + validate the artwork queue. Returns null (after logging) when
 *  there is nothing to do or the environment can't generate. */
async function loadQueue(
  log: (msg: string) => void,
): Promise<QueueEntry[] | null> {
  let entries: QueueEntry[] = [];
  try {
    const raw = await readFile(QUEUE_PATH(), "utf8");
    const parsed = parseQueue(raw);
    entries = parsed.entries;
    if (parsed.badLines > 0) {
      log(
        `  ⚠ skipped ${parsed.badLines} corrupt queue line(s) — re-save or fix artwork-queue.jsonl if entries are missing`,
      );
    }
  } catch {
    log(
      "queue is empty — nothing to do (entries appear after `megadj ingest`)",
    );
    return null;
  }
  if (entries.length === 0) {
    log("queue is empty — nothing to do");
    return null;
  }
  return entries;
}

/** Generate + embed art for one queue entry. Returns "embedded",
 *  "skipped-ext", or "failed" — only embedded/skipped leave the queue. */
async function processEntry(
  log: (msg: string) => void,
  client: {
    generate(req: {
      prompt: string;
      model: string;
      size: string;
      output: string;
      outputFormat: string;
    }): Promise<{ cost?: number }>;
  },
  entry: QueueEntry,
  coverDir: string,
  model: string,
  dryRun: boolean | undefined,
  counters: ArtworkCounters,
  doneLines: string[],
): Promise<"embedded" | "skipped-ext" | "failed" | "pending"> {
  if (!ARTWORK_EXTS.has(extname(entry.path).toLowerCase())) {
    log(`  - skip (unsupported container): ${basename(entry.path)}`);
    doneLines.push(JSON.stringify({ ...entry, result: "skipped-ext" }));
    return "skipped-ext";
  }
  const prompt = buildPrompt(entry);
  const coverPath = join(
    coverDir,
    `${basename(entry.path).replace(/\.[^.]+$/, "")}.png`,
  );
  log(`  ~ ${entry.title}${entry.artist ? ` — ${entry.artist}` : ""}`);
  log(`    prompt: ${prompt.slice(0, 110)}…`);
  if (dryRun) return "pending";

  try {
    const result = await client.generate({
      prompt,
      model,
      size: "1024x1024",
      output: coverPath,
      outputFormat: "png",
    });
    const { cost } = result;
    log(
      `    generated ${coverPath}${cost !== undefined ? ` ($${Number(cost).toFixed(3)})` : ""}`,
    );
    if (await embedArtwork(entry.path, coverPath)) {
      log("    embedded ✓");
      counters.done++;
      doneLines.push(
        JSON.stringify({ ...entry, result: "embedded", model, coverPath }),
      );
      return "embedded";
    } else {
      log("    embed FAILED — entry stays in queue");
      counters.failed++;
      return "failed";
    }
  } catch (err) {
    log(
      `    generation FAILED: ${err instanceof Error ? err.message : String(err)}`,
    );
    counters.failed++;
    return "failed";
  }
}

export async function artwork(opts: ArtworkOptions): Promise<void> {
  const log = commandLog(opts);
  const model = opts.model ?? DEFAULT_MODEL;
  // env parse at the boundary: MEGADJ_ART_MAX="" parses to NaN and
  // slice(0, NaN) would process NOTHING while reporting success.
  const envMax = Number(process.env.MEGADJ_ART_MAX ?? "");
  const max =
    opts.maxImages ??
    (Number.isFinite(envMax) && envMax > 0 ? Math.floor(envMax) : 20);
  const apiKey = process.env.OPENROUTER_API_KEY;

  const entries = await loadQueue(log);
  if (!entries) return;
  if (!apiKey && !opts.dryRun) {
    log("OPENROUTER_API_KEY not set — cannot generate. Export it and retry.");
    log(`queue (${entries.length} entries) is preserved at ${QUEUE_PATH()}`);
    process.exitCode = 1;
    return;
  }

  const batch = entries.slice(0, max);
  log(
    `${entries.length} queued entr(ies), processing ${batch.length}${
      entries.length > batch.length
        ? ` (${entries.length - batch.length} left for next run)`
        : ""
    } with ${model}${opts.dryRun ? " (dry run)" : ""}`,
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

  const counters: ArtworkCounters = { done: 0, failed: 0 };
  const doneLines: string[] = [];
  // Which batch entries actually LEFT the queue: embedded, or skipped as
  // unsupported (no point queuing a container that can't hold art).
  // Everything else (generation failed, embed failed) must stay queued —
  // the old rewrite (entries.slice(batch.length)) dropped the whole batch
  // slice, so a failed generation silently deleted its queue entry forever.
  const processedIdx = new Set<number>();

  for (let i = 0; i < batch.length; i++) {
    const entry = batch[i]!;
    const outcome = await processEntry(
      log,
      client,
      entry,
      coverDir,
      model,
      opts.dryRun,
      counters,
      doneLines,
    );
    if (outcome === "embedded" || outcome === "skipped-ext")
      processedIdx.add(i);
  }

  if (!opts.dryRun && doneLines.length > 0) {
    await appendFile(DONE_PATH(), `${doneLines.join("\n")}\n`, "utf8");
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

  const { done, failed } = counters;
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
      `\ndone: ${done} embedded, ${failed} failed${
        opts.dryRun ? " (dry run — nothing generated)" : ""
      }, ${Math.max(0, entries.length - processedIdx.size)} left in queue`,
    );
  }
}
