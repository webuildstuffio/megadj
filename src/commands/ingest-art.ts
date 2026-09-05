/**
 * Ingest Phase-D helpers: artwork acquisition + AI-art queueing.
 * The art ladder itself is FullTags-owned (soundcloudUrlInTags +
 * soundcloudArtwork/itunesArtwork via embed.ts shims); this module adds
 * the ingest-specific outcome tracking and the AI-generation queue flush.
 */
import { extname } from "node:path";
import { embedArtwork, soundcloudArtwork, itunesArtwork } from "./embed";
import { soundcloudUrlInTags } from "../../fulltags/src/exports";
import { appendQueueEntries, type QueueEntry } from "./queue";

export { soundcloudUrlInTags };

/** Containers that reliably hold embedded artwork. */
export const ARTWORK_EXTS = new Set([
  ".m4a",
  ".mp3",
  ".flac",
  ".aiff",
  ".aif",
  ".wav",
]);

/** Outcome of the artwork step for one track. */
export interface ArtworkOutcome {
  /** Where art came from, if it was fetched+embedded this run. */
  source: "sc" | "itunes" | null;
  /** A fetched URL we failed to embed (caller queues for retry). */
  failedUrl: string | null;
  /** Nothing online — caller queues for AI generation. */
  queued: boolean;
  /** Track format can't hold art (no queue entry makes sense). */
  skipped: boolean;
}

/**
 * Try to fetch + embed artwork for a track that has none.
 * Ladder: SoundCloud (URL from tags → oembed/page og:image) → iTunes Search.
 */
export async function fetchAndEmbedArtwork(
  file: string,
  opts: {
    tags: Record<string, string>;
    hasArt: boolean;
    noArtwork?: boolean;
    artist: string | null;
    album: string | null;
    title: string;
    dryRun?: boolean;
  },
): Promise<ArtworkOutcome> {
  const out: ArtworkOutcome = {
    source: null,
    failedUrl: null,
    queued: false,
    skipped: false,
  };
  if (opts.hasArt || opts.noArtwork || !opts.artist) return out;
  const ext = extname(file).toLowerCase();
  if (!ARTWORK_EXTS.has(ext)) {
    out.skipped = true;
    return out;
  }
  const scUrl = soundcloudUrlInTags(opts.tags);
  const artUrl =
    (scUrl && (await soundcloudArtwork(scUrl))) ||
    (await itunesArtwork(opts.artist, opts.album ?? opts.title));
  if (!artUrl) {
    out.queued = true;
    return out;
  }
  if (!opts.dryRun && (await embedArtwork(file, artUrl))) {
    out.source = artUrl.includes("soundcloud") ? "sc" : "itunes";
  } else if (opts.dryRun) {
    out.source = artUrl.includes("soundcloud") ? "sc" : "itunes";
  } else {
    out.failedUrl = artUrl;
  }
  return out;
}

/** Persist artwork-queue entries (AI generation fallback) after a run. */
export async function flushArtworkQueue(
  dbDir: string,
  entries: QueueEntry[],
  dryRun?: boolean,
): Promise<void> {
  if (entries.length === 0 || dryRun) return;
  await appendQueueEntries(dbDir, entries);
}
