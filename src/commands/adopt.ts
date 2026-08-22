/**
 * megadj adopt — register existing audio files into the state database
 * without re-downloading. Matches by fuzzy title against the current
 * playlist snapshot. Intended for bootstrapping an archive that predates
 * the tool.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ArchiveState } from "../state";

export interface AdoptOptions {
  state: ArchiveState;
  musicDir: string;
}

/** Normalize a string for loose title comparison. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[｜|]/g, "|")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function adopt(opts: AdoptOptions): Promise<void> {
  const files = (await readdir(opts.musicDir)).filter((f) => f.endsWith(".m4a"));
  console.log(`found ${files.length} audio files in ${opts.musicDir}`);

  const tracks = opts.state.allTracks();
  // Build a lookup of normalized title -> track row. Prefer entries that
  // are not already marked downloaded.
  const byTitle = new Map<string, (typeof tracks)[number]>();
  for (const t of tracks) {
    if (t.status === "downloaded" || !t.title) continue;
    byTitle.set(normalize(t.title), t);
  }

  let adopted = 0;
  for (const file of files) {
    const base = file.replace(/\.m4a$/, "");
    const key = normalize(base);
    const match = byTitle.get(key);
    if (!match) continue;
    const filePath = join(opts.musicDir, file);
    const stat = await Bun.file(filePath).stat();
    opts.state.markDownloaded(match.video_id, {
      title: match.title,
      artist: match.artist,
      album: match.album,
      formatId: null,
      bitrateKbps: null,
      codec: "aac",
      filePath,
      fileSizeBytes: stat.size,
      durationS: null,
    });
    byTitle.delete(key);
    adopted++;
    console.log(`  adopted: ${base}`);
  }

  console.log(
    `\nadopted ${adopted} file(s); ${files.length - adopted} unmatched (left pending or already tracked)`,
  );
}
