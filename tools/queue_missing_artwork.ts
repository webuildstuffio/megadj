/**
 * tools/queue_missing_artwork.ts — find archive mp3/m4a files without
 * embedded artwork and mark them queued (DB) + append to the artwork
 * queue file so `megadj artwork` can process them.
 */
import { $ } from "bun";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { appendFile } from "node:fs/promises";

const home = process.env.HOME!;
const root = `${home}/Music/YTMusic-Liked`;
const queuePath = `${home}/.local/state/megadj/artwork-queue.jsonl`;
const db = new Database(`${home}/.local/state/megadj/archive.db`);

const ents = await readdir(root, { withFileTypes: true });
let withArt = 0;
let wav = 0;
let newlyQueued = 0;
const queueLines: string[] = [];

for (const e of ents) {
  if (e.name.startsWith(".") || !/\.(m4a|mp3|wav)$/i.test(e.name)) continue;
  const p = join(root, e.name);
  if (/\.wav$/i.test(e.name)) {
    wav++;
    continue;
  }
  const pr = await $`ffprobe -v error -print_format json -show_streams ${p}`
    .quiet()
    .nothrow();
  if (pr.exitCode !== 0) continue;
  const stdout =
    typeof pr.stdout === "string" ? pr.stdout : pr.stdout.toString();
  const streams = JSON.parse(stdout).streams ?? [];
  if (streams.some((s: { codec_type?: string }) => s.codec_type === "video")) {
    withArt++;
    continue;
  }
  const row = db
    .query(
      "SELECT video_id, title, artist, album FROM tracks WHERE file_path = ?",
    )
    .get(p) as
    | {
        video_id: string;
        title: string | null;
        artist: string | null;
        album: string | null;
      }
    | undefined;
  if (!row || row.artwork_status === "queued") continue;
  db.query(
    "UPDATE tracks SET artwork_status = 'queued' WHERE video_id = ?",
  ).run(row.video_id);
  queueLines.push(
    JSON.stringify({
      path: p,
      title: row.title,
      artist: row.artist,
      album: row.album,
      reason: "no-source-found",
    }),
  );
  newlyQueued++;
}

if (queueLines.length > 0) {
  await appendFile(queuePath, queueLines.join("\n") + "\n", "utf8");
}
console.log(
  `with art: ${withArt} | wav (skip): ${wav} | newly queued: ${newlyQueued}`,
);
db.close();
