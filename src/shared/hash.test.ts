/**
 * hash.test.ts — pins the in-process MD5 seam (issue #70):
 *  - chunked sync digest matches the known vector and streams a file
 *    larger than the 1 MB chunk without loading it whole (the old
 *    dedupe-probe readFileSync variant was the latent OOM);
 *  - the explicit null-degrade contract: unreadable path → null, never
 *    a silent wrong digest;
 *  - the async stream form agrees with the sync form.
 */
import { describe, expect, test } from "bun:test";
import { md5FileChunked, md5FileStream } from "./hash";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("shared/hash — the in-process md5 seam (#70)", () => {
  test("known digest vector", async () => {
    const dir = mkdtempSync(join(tmpdir(), "megadj-hash-"));
    try {
      const p = join(dir, "a.bin");
      writeFileSync(p, "hello world");
      // well-known md5 of "hello world"
      expect(md5FileChunked(p)).toBe("5eb63bbbe01eeed093cb22bb8f5acdc3");
      expect(await md5FileStream(p)).toBe("5eb63bbbe01eeed093cb22bb8f5acdc3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("file larger than the 1 MB chunk digests correctly (no full read)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "megadj-hash-"));
    try {
      const p = join(dir, "big.bin");
      // 3 MB + 1 byte — crosses chunk boundaries
      const buf = Buffer.alloc(3 * (1 << 20) + 1, 0x5a);
      writeFileSync(p, buf);
      const syncDigest = md5FileChunked(p);
      expect(syncDigest).toBeString();
      expect(syncDigest).toBe(await md5FileStream(p));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("unreadable file → null (bytes NOT verified), missing file → null", async () => {
    expect(md5FileChunked(join(tmpdir(), "megadj-hash-does-not-exist"))).toBe(
      null,
    );
    const dir = mkdtempSync(join(tmpdir(), "megadj-hash-"));
    try {
      const p = join(dir, "unreadable");
      writeFileSync(p, "x");
      Bun.spawnSync(["chmod", "000", p]);
      expect(md5FileChunked(p)).toBe(null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
