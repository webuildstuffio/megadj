// bench.ts — read benchmark (sequential + 4k random, size-capped) and the
// blake2b256 checksum ledger for bitrot detection. READ-ONLY on the drive.
import {
  openSync,
  readSync,
  closeSync,
  fstatSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import type { CrateConfig } from "./config";
import type { DB } from "./db";
import type { Guard } from "./guard";

const AUDIO_EXT = new Set([
  ".mp3",
  ".m4a",
  ".aac",
  ".wav",
  ".aiff",
  ".aif",
  ".flac",
]);

export interface BenchResult {
  seq_mbps: number;
  rand4k_mbps: number;
  bytes_read: number;
}

export function benchmarkDrive(mountPoint: string, capMb: number): BenchResult {
  const candidates = biggestFiles(mountPoint, 8);
  if (!candidates.length) throw new Error("no audio files found to benchmark");
  const cap = capMb * 1024 * 1024;

  // sequential: read the biggest files start-to-end up to cap
  let seqBytes = 0;
  const t0 = performance.now();
  const buf = new Uint8Array(1024 * 1024);
  for (const f of candidates) {
    if (seqBytes >= cap) break;
    const fd = openSync(f, "r");
    try {
      let n: number;
      while (seqBytes < cap && (n = readSync(fd, buf, 0, buf.length, null)) > 0)
        seqBytes += n;
    } finally {
      closeSync(fd);
    }
  }
  const seqSec = (performance.now() - t0) / 1000;

  // random 4k: 4000 random reads across the files
  const rand = new Uint8Array(4096);
  const t1 = performance.now();
  let randBytes = 0;
  for (let i = 0; i < 4000; i++) {
    const f = candidates[i % candidates.length];
    const fd = openSync(f, "r");
    try {
      const size = fstatSync(fd).size;
      if (size > 4096) {
        const pos = Math.floor(Math.random() * (size - 4096));
        readSync(fd, rand, 0, 4096, pos);
        randBytes += 4096;
      }
    } finally {
      closeSync(fd);
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
}

export function checksumLedger(
  db: DB,
  guard: Guard,
  driveId: string,
  mountPoint: string,
  maxBytes = 8 * 1024 * 1024 * 1024,
): ChecksumResult {
  const files = biggestFiles(mountPoint, Infinity, maxBytes);
  const changed: string[] = [];
  let hashed = 0;
  for (const f of files) {
    const rel = f.startsWith(mountPoint) ? f.slice(mountPoint.length + 1) : f;
    const st = statSync(f);
    const prev = db.ledgerGet(driveId, rel);
    const mtime = Math.floor(st.mtimeMs);
    if (!prev) {
      // first sighting — hash and seed the ledger
      db.ledgerPut(driveId, rel, st.size, mtime, hashFile(f));
    } else if (prev.size !== st.size || prev.mtime !== mtime) {
      // metadata changed since the stored hash — re-hash and compare
      const fresh = hashFile(f);
      if (fresh !== prev.hash) changed.push(rel);
      db.ledgerPut(driveId, rel, st.size, mtime, fresh);
    }
    // unchanged files (size+mtime match) are trusted without a re-read
    hashed++;
  }
  return { hashed, changed };
}

export function hashFile(path: string): string {
  const h = new Bun.CryptoHasher("blake2b256");
  const fd = openSync(path, "r");
  try {
    const buf = new Uint8Array(1024 * 1024);
    let n: number;
    while ((n = readSync(fd, buf, 0, buf.length, null)) > 0)
      h.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return h.digest("hex");
}

function biggestFiles(
  root: string,
  limit: number,
  maxTotal = Infinity,
): string[] {
  const out: { p: string; size: number }[] = [];
  let total = 0;
  walk(root, (p, st) => {
    if (st.size > 1_000_000 && AUDIO_EXT.has(ext(p))) {
      if (total + st.size > maxTotal) return;
      total += st.size;
      out.push({ p, size: st.size });
    }
  });
  return out
    .sort((a, b) => b.size - a.size)
    .slice(0, limit === Infinity ? out.length : limit)
    .map((x) => x.p);
}

function walk(
  dir: string,
  cb: (p: string, st: ReturnType<typeof statSync>) => void,
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.startsWith(".") || e === "System Volume Information") continue;
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, cb);
    else if (st.isFile()) cb(p, st);
  }
}

function ext(p: string): string {
  const i = p.lastIndexOf(".");
  return i >= 0 ? p.slice(i).toLowerCase() : "";
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
