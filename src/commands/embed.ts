/**
 * megadj artwork embedding — now FullTags re-exports.
 * `embedArtwork(file, url)` stays here as a tiny fetch+embed convenience;
 * the primitives (embedArt, art sources) live in fulltags/src/.
 */
import {
  embedArt,
  fetchImage,
  soundcloudArtwork,
  itunesArtwork,
} from "../../fulltags/src/exports";

export { soundcloudArtwork, itunesArtwork };

/** Fetch art from a URL and embed it as the front cover. */
export async function embedArtwork(
  filePath: string,
  artUrl: string,
): Promise<boolean> {
  const bytes = await fetchImage(artUrl);
  if (!bytes) return false;
  return embedArt(filePath, bytes);
}

/** APIC into a WAV's ID3 chunk, preserving existing tags. */
export async function embedWav(
  filePath: string,
  imgPath: string,
): Promise<boolean> {
  const bytes = new Uint8Array(await Bun.file(imgPath).arrayBuffer());
  return embedArt(filePath, bytes);
}
