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
  onProgress?: (msg: string) => void;
  /** Machine-readable summary instead of human logs (P1: --json everywhere). */
  json?: boolean;
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

/** Recursively collect .m4a files (the tree has genre subfolders). */
async function walkM4a(dir: string, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // Missing music dir: nothing to adopt (doctor flags this upstream).
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) await walkM4a(full, out);
    else if (ent.name.endsWith(".m4a")) out.push(full);
  }
  return out;
}

export async function adopt(opts: AdoptOptions): Promise<void> {
  // --json mode (P1): human logs go quiet — the summary object is the only
  // stdout output so agents get parseable JSON.
  const rawLog = opts.onProgress ?? ((m: string) => console.log(m));
  const log = opts.json && !opts.onProgress ? () => {} : rawLog;
  const files = await walkM4a(opts.musicDir);
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
    let stat: Awaited<ReturnType<typeof Bun.file.prototype.stat>>;
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
