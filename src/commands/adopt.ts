/**
 * megadj adopt — register existing audio files into the state database
 * without re-downloading. Matches by fuzzy title against the current
 * playlist snapshot. Intended for bootstrapping an archive that predates
 * the tool.
 */

import type { Stats } from "node:fs";
import { walkAudioFiles } from "../../fulltags/src/exports";
import { normalize } from "../../fulltags/src/identity";
import type { ArchiveState } from "../state";
import { commandLog } from "../progress";

export interface AdoptOptions {
  state: ArchiveState;
  musicDir: string;
  onProgress?: (msg: string) => void;
  /** Machine-readable summary instead of human logs (P1: --json everywhere). */
  json?: boolean;
}

/** Audio files under the archive (the tree has genre subfolders) — shared
 * FullTags walker, filtered to .m4a for the YouTube-intake format. Sync
 * walk is fine here: adopt is a short CLI pass. */
function walkM4a(dir: string): string[] {
  return walkAudioFiles(dir).filter((f) => f.toLowerCase().endsWith(".m4a"));
}

export async function adopt(opts: AdoptOptions): Promise<void> {
  const log = commandLog(opts);
  const files = walkM4a(opts.musicDir);
  log(`found ${files.length} audio files under ${opts.musicDir}`);

  const tracks = opts.state.allTracks();
  // Build a lookup of normalized title -> track row. Prefer entries that
  // are not already marked downloaded.
  const byTitle = new Map<string, (typeof tracks)[number]>();
  for (const t of tracks) {
    if (t.status === "downloaded" || !t.title) continue;
    byTitle.set(normalize(t.title), t);
  }

  let adopted = 0;
  let vanished = 0;
  for (const file of files) {
    const base =
      file
        .replace(/\.m4a$/, "")
        .split("/")
        .pop() ?? file;
    const key = normalize(base);
    const match = byTitle.get(key);
    if (!match) continue;
    // A file can vanish between the directory walk and this stat (cleanup,
    // another agent, a moving tree). Skipping one file beats crashing the
    // whole adoption pass — same hardening `sync` got for its byte counter.
    let stat: Stats;
    try {
      stat = await Bun.file(file).stat();
    } catch {
      vanished++;
      log(`  ✗ vanished mid-scan, skipped: ${base}`);
      continue;
    }
    opts.state.markDownloaded(match.video_id, {
      title: match.title,
      artist: match.artist,
      album: match.album,
      formatId: null,
      bitrateKbps: null,
      codec: "aac",
      filePath: file,
      fileSizeBytes: stat.size,
      durationS: null,
    });
    byTitle.delete(key);
    adopted++;
    log(`  adopted: ${base}`);
  }

  log(
    `\nadopted ${adopted} file(s); ${files.length - adopted} unmatched (left pending or already tracked)` +
      (vanished > 0 ? `, ${vanished} vanished` : ""),
  );
  if (opts.json) {
    // P1 (--json on every command): one summary object on stdout, last.
    console.log(
      JSON.stringify({
        command: "adopt",
        scanned: files.length,
        adopted,
        unmatched: files.length - adopted,
        vanished,
      }),
    );
  }
}
