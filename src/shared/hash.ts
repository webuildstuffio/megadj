/**
 * hash — THE in-process MD5 seam (issue #70). One implementation per
 * execution style; every other in-process digest is a hand-roll of these.
 *
 *  - `md5FileChunked`  sync, 1 MB chunks — 300 MB WAV sets never enter
 *    memory whole (the dedupe-probe readFileSync variant was the
 *    latent OOM). Returns null when the bytes could NOT be read: the
 *    explicit degrade contract — null means "cannot prove identical",
 *    never "not a duplicate" without the caller saying so.
 *  - `md5FileStream`   async stream — the ingest-family shape (zip
 *    expansion, probe copy-verify) without three hand-rolled twins.
 *
 * The SUBPROCESS seam stays `src/shelf/md5-cli.ts` (retries transient
 * spawn pressure under bun test --parallel). In-process needs import
 * from HERE so nobody rolls a sixth implementation.
 */
import { createHash } from "node:crypto";
import { createReadStream, openSync, readSync, closeSync } from "node:fs";

/** Chunk size: 1 MB — streaming cost is I/O-bound well before this. */
const CHUNK = 1 << 20;

/** Sync chunked digest. Null when the file cannot be read (caller owns
 *  the degrade decision); throws only on programmer error (bad args). */
export function md5FileChunked(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const h = createHash("md5");
    const buf = Buffer.alloc(CHUNK);
    let n = 0;
    while ((n = readSync(fd, buf, 0, buf.length, null)) > 0)
      h.update(buf.subarray(0, n));
    return h.digest("hex");
  } catch {
    // read/digest failure mid-stream: bytes NOT verified
    return null;
  } finally {
    closeSync(fd);
  }
}

/** Async streaming digest — rejects only when the read stream errors
 *  (callers that need null-degrade wrap it; ingest copy-verify treats a
 *  failed hash as unequal, which quarantines rather than deletes). */
export function md5FileStream(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("md5");
    createReadStream(path)
      .on("data", (chunk: Buffer) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}
