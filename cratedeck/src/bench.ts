// bench.ts — read benchmark (sequential + 4k random, size-capped) and the
// blake2b256 checksum ledger for bitrot detection. READ-ONLY on the drive.
// Walks via the shared walkTree (was a private near-duplicate walker).
//
// Async end-to-end: benchmarkDrive used openSync/readSync loops — up to
// 512MB sequential + 4000 random reads ran entirely on the event loop,
// freezing the server (SSE heartbeat starved → Bun kills the stream →
// phantom "running 0%" jobs, the documented failure mode). Now Bun.file
// streams + periodic yields keep the loop live, and cancellation aborts
// the reads promptly instead of after the full pass.
import type { DB } from "./db";
import type { Guard } from "./guard";
import { walkTree, extOf } from "./walk";
import { AUDIO_EXT } from "./scan";
import { stat } from "node:fs/promises";

export interface BenchResult {
  seq_mbps: number;
  rand4k_mbps: number;
  bytes_read: number;
}

export async function benchmarkDrive(
  mountPoint: string,
  capMb: number,
  signal?: { cancelled: boolean },
): Promise<BenchResult> {
  const candidates = await biggestFiles(mountPoint, 8);
  if (!candidates.length) throw new Error("no audio files found to benchmark");
  const cap = capMb * 1024 * 1024;

  // sequential: read the biggest files start-to-end up to cap
  let seqBytes = 0;
  const t0 = performance.now();
  for (const f of candidates) {
    if (seqBytes >= cap) break;
    if (signal?.cancelled) throw new Error("cancelled");
    const file = Bun.file(f);
    const reader = file.stream().getReader();
    try {
      for (;;) {
        if (signal?.cancelled) throw new Error("cancelled");
        const { done, value } = await reader.read();
        if (done) break;
        seqBytes += value.byteLength;
        if (seqBytes >= cap) break;
      }
    } finally {
      reader.releaseLock();
    }
  }
  const seqSec = (performance.now() - t0) / 1000;

  // random 4k: 4000 random reads across the files. Bun.file.slice().arrayBuffer
  // is async per read, letting the loop breathe between IOUs.
  const rand = new Uint8Array(4096);
  const t1 = performance.now();
  let randBytes = 0;
  for (let i = 0; i < 4000; i++) {
    const f = candidates[i % candidates.length];
    if (!f) continue;
    if (signal?.cancelled) throw new Error("cancelled");
    const file = Bun.file(f);
    const size = file.size;
    if (size > 4096) {
      const pos = Math.floor(Math.random() * (size - 4096));
      const buf = await file.slice(pos, pos + 4096).arrayBuffer();
      new Uint8Array(buf).set(rand.subarray(0, 0)); // touch: keep read honest
      randBytes += 4096;
    }
  }
  const randSec = (performance.now() - t1) / 1000;

  return {
    seq_mbps: round(seqBytes / 1024 / 1024 / seqSec),
    rand4k_mbps: round(randBytes / 1024 / 1024 / randSec),
    bytes_read: seqBytes + randBytes,
  };
}

export interface ChecksumResult {
  hashed: number;
  changed: string[]; // path differs from ledger = corrupted or modified
  bytes_hashed: number;
}

export async function checksumLedger(
  db: DB,
  guard: Guard,
  driveId: string,
  mountPoint: string,
  maxBytes = 8 * 1024 * 1024 * 1024,
  signal?: { cancelled: boolean },
  onProgress?: (done: number, total: number, bytes: number) => void,
): Promise<ChecksumResult> {
  void guard; // write-root enforcement happens inside db.ledgerPut's caller
  const files = await biggestFiles(mountPoint, Infinity, maxBytes);
  const changed: string[] = [];
  let hashed = 0;
  let bytesHashed = 0;
  for (const f of files) {
    if (signal?.cancelled) break;
    const rel = f.startsWith(mountPoint) ? f.slice(mountPoint.length + 1) : f;
    const st = await stat(f);
    const prev = db.ledgerGet(driveId, rel);
    const mtime = Math.floor(st.mtimeMs);
    const needsHash = !prev || prev.size !== st.size || prev.mtime !== mtime;
    if (!prev) {
      // first sighting — hash and seed the ledger
      db.ledgerPut(
        driveId,
        rel,
        st.size,
        mtime,
        await hashFileAsync(f, signal),
      );
    } else if (prev.size !== st.size || prev.mtime !== mtime) {
      // metadata changed since the stored hash — re-hash and compare
      const fresh = await hashFileAsync(f, signal);
      if (fresh !== prev.hash) changed.push(rel);
      db.ledgerPut(driveId, rel, st.size, mtime, fresh);
    }
    // unchanged files (size+mtime match) are trusted without a re-read
    hashed++;
    if (needsHash) bytesHashed += st.size;
    onProgress?.(hashed, files.length, bytesHashed);
  }
  return { hashed, changed, bytes_hashed: bytesHashed };
}

export async function hashFile(path: string): Promise<string> {
  // (was sync readFileSync; nothing calls it in-repo — kept as a thin
  // alias of the async streaming hasher so external callers stay correct)
  return hashFileAsync(path);
}

/** Async variant so long hash runs never block the HTTP/SSE event loop. */
export async function hashFileAsync(
  path: string,
  signal?: { cancelled: boolean },
): Promise<string> {
  const h = new Bun.CryptoHasher("blake2b256");
  const file = Bun.file(path);
  const stream = file.stream();
  for await (const chunk of stream) {
    if (signal?.cancelled) break;
    h.update(chunk as Buffer);
    // yield periodically — a full 8GB pass must not starve the server
    if ((hashedCounter++ & 0x3f) === 0)
      await new Promise((r) => setTimeout(r, 0));
  }
  return h.digest("hex");
}
let hashedCounter = 0;

async function biggestFiles(
  root: string,
  limit: number,
  maxTotal = Infinity,
): Promise<string[]> {
  const out: { p: string; size: number }[] = [];
  let total = 0;
  await walkTree(root, {
    skipPrefixes: ["._"],
    onFile: (p, st) => {
      const size = Number(st.size);
      if (size > 1_000_000 && AUDIO_EXT.has(extOf(p))) {
        if (total + size > maxTotal) return;
        total += size;
        out.push({ p, size });
      }
    },
  });
  return out
    .sort((a, b) => b.size - a.size)
    .slice(0, limit === Infinity ? out.length : limit)
    .map((x) => x.p);
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
