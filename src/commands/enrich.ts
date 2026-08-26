/**
 * megadj enrich — fill missing/weak genres using MusicBrainz artist tags.
 *
 * YouTube's "Music" category is useless for organization. MusicBrainz folksonomy
 * tags per artist give a real genre ("house", "uk garage", "emo rap"). Tracks
 * whose DB genre is null or the generic "Music" get upgraded, then re-tagged
 * in-file with ffmpeg, ready for a follow-up `organize`.
 */

import { $ } from "bun";
import type { ArchiveState } from "../state";
import { inferGenre, sanitizeGenreFolder } from "../metadata";

export interface EnrichOptions {
  state: ArchiveState;
  musicDir: string;
  dryRun?: boolean;
  onProgress?: (msg: string) => void;
}

interface MbArtist {
  id: string;
  name: string;
  tags?: Array<{ name: string; count: number }>;
}

interface MbSearchResponse {
  artists?: MbArtist[];
}

const artistCache = new Map<string, string | null>();

async function mbGenreForArtist(artist: string): Promise<string | null> {
  const key = artist.toLowerCase().trim();
  if (artistCache.has(key)) return artistCache.get(key) ?? null;

  const url = `https://musicbrainz.org/ws/2/artist/?query=artist:"${encodeURIComponent(artist)}"&fmt=json&limit=1`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "megadj/0.1 (https://github.com/megadj/megadj)" },
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

async function rewriteGenreTag(filePath: string, genre: string): Promise<boolean> {
  const tmp = filePath.replace(/(\.[^.]+)$/, ".retag$1");
  const proc = await $`ffmpeg -y -hide_banner -loglevel error -i ${filePath} -c copy -map 0 -metadata genre=${genre} ${tmp}`
    .quiet()
    .nothrow();
  if (proc.exitCode !== 0) return false;
  const proc2 = await $`mv ${tmp} ${filePath}`.quiet().nothrow();
  return proc2.exitCode === 0;
}

export async function enrich(opts: EnrichOptions): Promise<void> {
  const log = opts.onProgress ?? ((m: string) => console.log(m));
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

  for (const track of tracks) {
    if (!track.artist) {
      unchanged++;
      continue;
    }
    const genre = await mbGenreForArtist(track.artist);
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
    if (track.file_path) {
      await rewriteGenreTag(track.file_path, genre);
    }
    opts.state.updateGenre(track.video_id, genre);
    log(`  ${track.title?.slice(0, 40) ?? track.video_id} → ${genre}`);
    upgraded++;
    // Be polite to MusicBrainz: 1 rps.
    await new Promise((r) => setTimeout(r, 1050));
  }

  log(
    `\nenrich complete: ${upgraded} upgraded, ${unchanged} unchanged (of ${tracks.length})`,
  );
  void sanitizeGenreFolder;
}
