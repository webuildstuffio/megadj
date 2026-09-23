/**
 * GetDat ingest — probe half (#88 item 3): Phase A walks each intake file
 * through the container-truth repair and builds the dedupe input records.
 *
 * Phase A guarantees (each earned by an incident):
 *  - a file that vanishes between walk and stat is SKIPPED — one ENOENT
 *    must not kill a 373-file pass;
 *  - broken/zero-byte files are reported, never moved;
 *  - mislabeled containers get renamed in place BEFORE dedupe/tagging
 *    (pool rips ship AAC-in-MP4 wearing `.mp3` names; the mp3 muxer and
 *    Pioneer hardware both reject those — Sep 11: 14 rescue files failed
 *    tag-write with ffmpeg exit 234 for exactly this).
 */
import { stat } from "node:fs/promises";
import { existsSync, renameSync, type Stats } from "node:fs";
import { basename, extname } from "node:path";
import {
  firstTag,
  parseFilename,
  probeFile,
  qualityScore,
  trueContainerExt,
} from "../../fulltags/utils/media-probe";
import { identityKey } from "../../fulltags/pipeline/identity";
import type { Record_ } from "./ingest-probe";

/** Probe every file; returns the dedupe input records + the broken list. */
export async function probeAllFiles(
  files: string[],
  log: (msg: string) => void,
): Promise<{ records: Record_[]; broken: string[] }> {
  const records: Record_[] = [];
  const broken: string[] = [];
  for (const file of files) {
    let st: Stats;
    try {
      st = await stat(file);
    } catch {
      log(`  ✗ vanished mid-scan, skipped: ${basename(file)}`);
      continue;
    }
    const probe = await probeFile(file);
    if (!st.size || !probe.ok) {
      broken.push(file);
      log(`  ✗ broken/zero-byte: ${basename(file)}`);
      continue;
    }
    // Container-truth rename: extension says mp3, container says MP4 →
    // rename in place (collision-safe), then continue with the real name.
    let livePath = file;
    const truth = trueContainerExt(probe);
    const ext = extname(file).toLowerCase();
    if (truth && truth !== ext && truth !== ".aiff") {
      const fixedPath = file.slice(0, -ext.length) + truth;
      if (!existsSync(fixedPath)) {
        try {
          renameSync(file, fixedPath);
          livePath = fixedPath;
          log(
            `  [fix] mislabeled container renamed: ${basename(file)} → ${basename(fixedPath)} (audio untouched)`,
          );
        } catch (e) {
          log(
            `  ✗ rename failed, keeping original: ${basename(file)} — ${(e as Error).message?.slice(0, 60)}`,
          );
        }
      } else {
        log(
          `  ⚠ truth-name exists, keeping both for review: ${basename(file)}`,
        );
      }
    }
    const parsed = parseFilename(basename(livePath));
    const tagTitle = firstTag(probe.tags, ["title"]);
    const tagArtist = firstTag(probe.tags, ["artist"]);
    const title = tagTitle || parsed.title;
    const artist = tagArtist || parsed.artist;
    records.push({
      file: livePath,
      size: st.size,
      probe,
      parsed,
      identity: identityKey(artist, title),
      score: qualityScore(probe),
    });
  }
  return { records, broken };
}
