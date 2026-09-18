/**
 * FullTags pipeline — art half (#90 diet): the cover-art ladder and the
 * AI-queue fallback. Ladder order is a product decision (SC original →
 * SC thumb → Beatport 1500² → hype gateway → mp3 twin → Deezer →
 * iTunes), pinned by pipeline/art tests; a miss at every rung queues
 * the track for AI covers (deduped by path — re-runs never double-burn
 * AI generations).
 */
import { existsSync, readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import {
  deezerArt,
  fetchBestScArt,
  fetchImage,
  gatewayArt,
  pageOgImage,
  twinArt,
  type ArtRow,
} from "./sources/art-sources";
import { beatportArt, type BpTrack } from "./sources/beatport";

export type { ArtRow } from "./sources/art-sources";

/** Where AI-cover misses are queued when no explicit queue path is passed. */
export const DEFAULT_QUEUE =
  process.env.FULLTAGS_ARTWORK_QUEUE ??
  `${process.env.HOME}/.local/state/megadj/artwork-queue.jsonl`;

/** The SC rung: page og:image at original resolution when offered, else
 * the search thumbnail. Null bytes = the hit produced nothing usable. */
export async function scArt(scBest: {
  url: string;
  thumb?: string | null;
}): Promise<Uint8Array | null> {
  const og = await pageOgImage(scBest.url);
  if (og) return fetchBestScArt(og);
  return scBest.thumb ? await fetchImage(scBest.thumb) : null;
}

async function itunesArt(r: ArtRow): Promise<Uint8Array | null> {
  const { itunesArtwork } = await import("./sources/art-sources");
  const url = await itunesArtwork(r.artist ?? "", r.album ?? r.title);
  if (!url) return null;
  return fetchImage(url);
}

/** The full art ladder (minus the already-consumed SC rung handled by
 * the caller): Beatport → gateway → twin → Deezer → iTunes. */
export async function artLadder(
  artRow: ArtRow,
  bpBest: BpTrack | null,
): Promise<{ bytes: Uint8Array | null; source: string | null }> {
  // Beatport official release art at 1500² — second rung, before the
  // hype-gateway scraping (store master beats a gateway screenshot).
  if (bpBest) {
    const bytes = await beatportArt(bpBest);
    if (bytes) return { bytes, source: "beatport" };
  }
  const gw = await gatewayArt(artRow);
  if (gw) return { bytes: gw.bytes, source: "gateway" };
  const twin = twinArt(artRow);
  if (twin) return { bytes: twin, source: "twin" };
  const dz = await deezerArt(artRow);
  if (dz) return { bytes: dz, source: "deezer" };
  const it = await itunesArt(artRow);
  if (it) return { bytes: it, source: "itunes" };
  return { bytes: null, source: null };
}

export function appendQueue(queuePath: string, r: ArtRow): boolean {
  try {
    // Dedupe: a path already queued (by path) must not re-queue on every
    // re-run — the queue is consumed by megadj artwork, duplicates just
    // burn AI generations.
    if (existsSync(queuePath)) {
      const seen = readFileSync(queuePath, "utf8");
      if (seen.includes(JSON.stringify(r.file_path))) return false;
    }
    void appendFile(
      queuePath,
      `${JSON.stringify({
        path: r.file_path,
        title: r.title,
        artist: r.artist,
        album: r.album ?? null,
        reason: "no-online-cover",
      })}\n`,
    ).catch((e: unknown) => {
      // queue is best-effort (never fails the pipeline) but not silent:
      // a failed append means the artwork-queue silently stays empty and
      // the track never gets its AI cover — the operator needs to know.
      console.error(`artwork queue append failed (${queuePath})`, e);
    });
    return true;
  } catch {
    // queue is best-effort — never fail the pipeline over it
    return false;
  }
}
