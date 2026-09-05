/**
 * megadj enrich — fill missing/weak genres via MusicBrainz folksonomy
 * (roadmap #5: the last duplicated writer is gone; this is now a thin shim
 * over FullTags' mb.ts + the shared FullTags writer).
 *
 * Kept as a megadj command because it is DB-aware (walks ArchiveState rows);
 * all the heavy lifting (MB lookup, canonical mapping, format-safe atomic
 * write) lives in FullTags.
 */
import type { ArchiveState } from "../state";
import { writePatch } from "../../fulltags/src/exports";
import { mbGenreForArtist } from "../../fulltags/src/mb";

export interface EnrichOptions {
  state: ArchiveState;
  musicDir: string;
  dryRun?: boolean;
  onProgress?: (msg: string) => void;
  /** Machine-readable summary instead of human logs (P1: --json everywhere). */
  json?: boolean;
  /** Test seam: override the MusicBrainz genre lookup. */
  genreResolver?: GenreResolver;
  /** Test seam: override the in-file tag writer (false = write failure). */
  tagWriter?: TagWriter;
}

/** Injectable for tests: resolve an artist → canonical genre (or null). */
export type GenreResolver = (artist: string) => Promise<string | null>;
/** Injectable for tests: write the genre tag into a file; false = failure. */
export type TagWriter = (filePath: string, genre: string) => Promise<boolean>;

async function rewriteGenreTag(
  filePath: string,
  genre: string,
): Promise<boolean> {
  // FullTags writePatch is atomic (tmp + rename), format-aware (mutagen for
  // AIFF/WAV/m4a — the ffmpeg muxers drop ID3/freeform atoms), and cleans
  // up after itself.
  try {
    await writePatch(filePath, { genre });
    return true;
  } catch {
    return false;
  }
}

export async function enrich(opts: EnrichOptions): Promise<void> {
  const rawLog = opts.onProgress ?? ((m: string) => console.log(m));
  const log = opts.json && !opts.onProgress ? () => {} : rawLog;
  const tracks = opts.state
    .allTracks()
    .filter(
      (t) =>
        t.status === "downloaded" &&
        t.file_path &&
        (!t.genre || t.genre === "Music"),
    );
  log(`${tracks.length} track(s) with weak/missing genre to enrich`);

  let upgraded = 0;
  let unchanged = 0;
  let writeFailed = 0;

  for (const track of tracks) {
    if (!track.artist) {
      unchanged++;
      continue;
    }
    const genre = await (opts.genreResolver ?? mbGenreForArtist)(track.artist);
    if (!genre) {
      unchanged++;
      continue;
    }
    if (opts.dryRun) {
      log(`  would set ${track.title?.slice(0, 40)} → ${genre}`);
      continue;
    }
    // Ground-truth invariant: the DB row and the file's tag must agree.
    // Only record the genre when the in-file write succeeded — otherwise
    // `megadj audit`/`organize` act on a DB genre the file never got.
    let fileOk = true;
    if (track.file_path) {
      fileOk = await (opts.tagWriter ?? rewriteGenreTag)(
        track.file_path,
        genre,
      );
      if (!fileOk) writeFailed++;
    }
    if (fileOk) {
      opts.state.updateGenre(track.video_id, genre);
      log(`  ${track.title?.slice(0, 40) ?? track.video_id} → ${genre}`);
      upgraded++;
    } else {
      log(
        `  ✗ tag write failed (DB left unchanged): ${track.title?.slice(0, 40) ?? track.video_id}`,
      );
    }
  }

  log(
    `\nenrich complete: ${upgraded} upgraded, ${unchanged} unchanged, ${writeFailed} write-failed (of ${tracks.length})`,
  );
  if (opts.json) {
    console.log(
      JSON.stringify({
        command: "enrich",
        dryRun: opts.dryRun ?? false,
        considered: tracks.length,
        upgraded,
        unchanged,
        writeFailed,
      }),
    );
  }
}
