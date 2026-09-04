/** queue.ts — artwork-queue fallback persistence for `megadj ingest`. */

export interface QueueEntry {
  path: string;
  title: string;
  artist?: string | null;
  album?: string | null;
  reason: string;
  remixOf?: string | null;
  sourceUrl?: string | null;
}

export async function appendQueueEntries(
  dbDir: string,
  entries: QueueEntry[],
): Promise<string> {
  const { appendFile, mkdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await mkdir(dbDir, { recursive: true });
  const queuePath = join(dbDir, "artwork-queue.jsonl");
  await appendFile(
    queuePath,
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf8",
  );
  return queuePath;
}
