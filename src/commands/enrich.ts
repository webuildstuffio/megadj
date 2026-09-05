/**
 * megadj enrich — fill missing/weak genres using MusicBrainz artist tags.
 *
 * YouTube's "Music" category is useless for organization. MusicBrainz folksonomy
 * tags per artist give a real genre ("house", "uk garage", "emo rap"). Tracks
 * whose DB genre is null or the generic "Music" get upgraded, then re-tagged
 * in-file with ffmpeg, ready for a follow-up `organize`.
 */

import type { ArchiveState } from "../state";
import { inferGenre, writePatch } from "../metadata";

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

interface MbArtist {
  id: string;
  name: string;
  tags?: Array<{ name: string; count: number }>;
}

interface MbSearchResponse {
  artists?: MbArtist[];
}

/** Injectable for tests: resolve an artist → canonical genre (or null). */
export type GenreResolver = (artist: string) => Promise<string | null>;
/** Injectable for tests: write the genre tag into a file; false = failure. */
export type TagWriter = (
  filePath: string,
  genre: string,
) => Promise<boolean>;

const artistCache = new Map<string, string | null>();

async function mbGenreForArtist(artist: string): Promise<string | null> {
  const key = artist.toLowerCase().trim();
  if (artistCache.has(key)) return artistCache.get(key) ?? null;

  const url = `https://musicbrainz.org/ws/2/artist/?query=artist:"${encodeURIComponent(artist)}"&fmt=json&limit=1`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "megadj/0.1 (https://github.com/megadj/megadj)",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as MbSearchResponse;
    const artist0 = data.artists?.[0];
    if (!artist0) {
      artistCache.set(key, null);
      return null;
    }
    // MusicBrainz tags are folksonomy: pick the highest-count one that
    // maps to one of our genre buckets.
    const tags = (artist0.tags ?? []).sort((a, b) => b.count - a.count);
    const raw = tags.map((t) => t.name).join(" ");
    const genre = inferGenre([raw]);
    artistCache.set(key, genre);
    return genre;
  } catch {
    return null;
  }
}

async function rewriteGenreTag(
  filePath: string,
  genre: string,
): Promise<boolean> {
  // Route through FullTags' writer: the raw `ffmpeg -c copy` remux used here
  // before dropped embedded artwork on AIFF (its muxer discards the ID3
  // chunk — the documented repo gotcha) and leaked an orphan tmp file when
  // ffmpeg failed on a corrupt input. writePatch is atomic (tmp + rename),
  // format-aware (mutagen for AIFF/WAV/m4a), and cleans up after itself.
  try {
    await writePatch(filePath, { genre });
    return true;
  } catch {
    return false;
  }
}

export async function enrich(opts: EnrichOptions): Promise<void> {
  // --json mode (P1): human logs go quiet — the summary object is the only
  // stdout output so agents get parseable JSON.
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
      // Be polite to MusicBrainz: 1 rps even for lookups that map to nothing.
      await new Promise((r) => setTimeout(r, 1050));
      continue;
    }
    if (opts.dryRun) {
      log(`  would set ${track.title?.slice(0, 40)} → ${genre}`);
      continue;
    }
    // Ground-truth invariant: the DB row and the file's tag must agree.
    // Only record the genre when the in-file write succeeded — otherwise
    // `megadj audit`/`organize` act on a DB genre the file never got,
    // and the track is silently skipped by every later enrich run
    // (its genre is no longer "weak/missing").
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
    // Be polite to MusicBrainz: 1 rps.
    await new Promise((r) => setTimeout(r, 1050));
  }

  log(
    `\nenrich complete: ${upgraded} upgraded, ${unchanged} unchanged, ${writeFailed} write-failed (of ${tracks.length})`,
  );
  if (opts.json) {
    // P1 (--json on every command): one summary object on stdout, last.
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
