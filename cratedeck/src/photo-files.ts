// photo-files.ts — the cover-photo file primitives (#42 item 2 split,
// out of image-store.ts): the canonical-name/extension rules, the
// size-capped response reader, and the MIME→extension mapping. The
// ImageService class lives in image-store.ts; drive routes import the
// byte cap from here.
export const PHOTO_BASENAME = /^photo(?:\.(?:png|jpe?g|gif|webp|avif))?$/i;
/** Extensions accepted for cover photos. */
export const PHOTO_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
]);

/** Content-type → file extension for the photo download path. */
export function extFromMime(ctype: string): string | null {
  const m = ctype.match(/image\/(png|jpeg|gif|webp|avif)/);
  if (!m?.[1]) return null;
  return m[1] === "jpeg" ? ".jpg" : `.${m[1]}`;
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Read an image response without ever buffering beyond the configured cap. */
export async function readBoundedImageBody(
  response: Response,
  maxBytes = MAX_IMAGE_BYTES,
): Promise<Uint8Array> {
  const tooLarge = (): Error =>
    new Error(
      maxBytes === MAX_IMAGE_BYTES
        ? "image > 10MB"
        : `image > ${maxBytes} bytes`,
    );
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (Number.isFinite(bytes) && bytes > maxBytes) throw tooLarge();
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Lowercased extension of a path/URL ("" → null). Query strings off. */
export function extOfPhotoPath(p: string | undefined): string | null {
  if (!p) return null;
  const clean = p.split(/[?#]/)[0] ?? p;
  const ext = extname(clean).toLowerCase();
  return PHOTO_EXT.has(ext) ? ext : null;
}

import { extname } from "node:path";
