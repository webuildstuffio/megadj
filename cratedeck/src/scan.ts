// scan.ts — light scan of a mounted volume: manifest, sizes, folder
// composition, junk detection (zero-byte, case collisions, ._* forks),
// space analysis (free bytes, per-extension, largest files, age histogram).
// READ-ONLY on the drive: never writes, never renames, never deletes.
// One walkTree pass collects everything (the old code walked + statSync'd
// per concern; now it's a single traversal).
//
// Async end-to-end (fs/promises + `df` via Bun.spawn): scanVolume runs on
// the server's event loop — the sync version blocked it for the whole walk,
// starving the SSE heartbeat (Bun kills silent streams ~10s) and stalling
// every API request (see AGENTS.md invariants — keep scans async).
import type { SnapshotData } from "../shared/types";
import { walkTree, extOf } from "./walk";

export const AUDIO_EXT = new Set([
  ".mp3",
  ".m4a",
  ".aac",
  ".wav",
  ".aiff",
  ".aif",
  ".flac",
]);

export function nfcCasefold(s: string): string {
  return s.normalize("NFC").toLowerCase();
}

export interface AgeBuckets {
  fresh: number; // < 30 days
  recent: number; // 30–180 days
  old: number; // 180d–2y
  ancient: number; // > 2y
}

export function ageBucket(mtimeMs: number, now = Date.now()): keyof AgeBuckets {
  const days = (now - mtimeMs) / 86_400_000;
  if (days < 30) return "fresh";
  if (days < 180) return "recent";
  if (days < 730) return "old";
  return "ancient";
}

/** Free bytes on the volume holding `mountPoint`, via `df -k` (async). */
export async function freeBytes(mountPoint: string): Promise<number | null> {
  const proc = Bun.spawn(["df", "-k", mountPoint], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const exitedTimer = proc.exited;
  const out = await new Response(proc.stdout).text();
  await exitedTimer;
  if (proc.exitCode !== 0) return null;
  const last = out.trim().split("\n").at(-1);
  if (!last) return null;
  const cols = last.split(/\s+/);
  // macOS df -k: Filesystem 1024-blocks Used Available Capacity ...
  const n = parseInt(cols[3] ?? "", 10);
  return Number.isFinite(n) ? n * 1024 : null;
}

export async function scanVolume(mountPoint: string): Promise<SnapshotData> {
  const folders = new Map<string, { files: number; bytes: number }>();
  const byExt = new Map<string, { files: number; bytes: number }>();
  const largest: { path: string; bytes: number }[] = [];
  const zeroByte: string[] = [];
  const byFolded = new Map<string, string[]>();
  const manifest: NonNullable<SnapshotData["manifest"]> = [];
  const age: AgeBuckets = { fresh: 0, recent: 0, old: 0, ancient: 0 };
  let fileCount = 0;
  let totalBytes = 0;
  let orphanForks = 0;

  await walkTree(mountPoint, {
    onlySubdir: "Contents", // prefer rekordbox layout; falls back to root
    onFile: (_p, st, relPath) => {
      const base = relPath.split("/").at(-1) ?? "";
      if (base.startsWith("._")) {
        orphanForks++;
        return;
      }
      fileCount++;
      totalBytes += st.size;
      // top folder = first real dir component; when walking Contents/, the
      // playlist folder is the second component (parity with old walker)
      const parts = relPath.split("/");
      const top =
        parts[0] === "Contents"
          ? parts.length > 2
            ? parts[1]!
            : null
          : parts.length > 1
            ? parts[0]!
            : null;
      if (top) {
        const f = folders.get(top) ?? { files: 0, bytes: 0 };
        f.files++;
        f.bytes += st.size;
        folders.set(top, f);
      }
      const ext = extOf(base);
      const b = byExt.get(ext) ?? { files: 0, bytes: 0 };
      b.files++;
      b.bytes += st.size;
      byExt.set(ext, b);
      if (st.size > 0) {
        largest.push({ path: relPath, bytes: st.size });
        if (AUDIO_EXT.has(ext)) {
          age[ageBucket(st.mtimeMs)]++;
          const key = nfcCasefold(relPath);
          // PERF: build the folded group in place — the old
          // `[...spread, x]` re-copied the array on every audio file
          // (O(n²) over a library).
          const group = byFolded.get(key);
          if (group) group.push(relPath);
          else byFolded.set(key, [relPath]);
          // fleet manifest: audio byte-truth for §B8 fleet diff. Contents/
          // stripped + folded to match fleet track identity. Strip BEFORE the
          // casefold — nfcCasefold lowercases, so /^Contents\// would never
          // match afterwards and every manifest path would keep the prefix,
          // making all diff() byte lookups miss. Capped at 20k rows as a
          // runaway-fs guard (real libraries are ~3-10k).
          if (manifest.length < 20_000) {
            manifest.push({
              path: nfcCasefold(relPath.replace(/^Contents\//, "")),
              bytes: st.size,
              mtime_ms: Math.round(st.mtimeMs),
            });
          }
        }
      } else {
        zeroByte.push(relPath);
      }
    },
  });

  largest.sort((a, b) => b.bytes - a.bytes);
  const caseCollisions = [...byFolded.values()]
    .filter((paths) => paths.length > 1)
    .flatMap((paths) => paths)
    .slice(0, 100);

  return {
    kind: "light",
    taken_at: Date.now(),
    file_count: fileCount,
    total_bytes: totalBytes,
    free_bytes: await freeBytes(mountPoint),
    folders: [...folders.entries()]
      .map(([name, f]) => ({ name, ...f }))
      .sort((a, b) => b.files - a.files)
      .slice(0, 100),
    by_ext: [...byExt.entries()]
      .map(([ext, f]) => ({ ext, ...f }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 20),
    largest: largest.slice(0, 15),
    age,
    manifest,
    junk: {
      zero_byte: zeroByte.slice(0, 100),
      case_collisions: caseCollisions,
      orphan_resource_forks: orphanForks,
    },
  };
}
