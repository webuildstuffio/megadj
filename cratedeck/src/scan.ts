// scan.ts — light scan of a mounted volume: manifest, sizes, folder
// composition, junk detection (zero-byte, case collisions, ._* forks),
// space analysis (free bytes, per-extension, largest files, age histogram).
// READ-ONLY on the drive: never writes, never renames, never deletes.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SnapshotData } from "../shared/types";

const AUDIO_EXT = new Set([
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

export function freeBytes(mountPoint: string): number | null {
  const p = Bun.spawnSync(["df", "-k", mountPoint], { stdout: "pipe" });
  if (p.exitCode !== 0) return null;
  const lines = p.stdout.toString().trim().split("\n");
  const last = lines.at(-1);
  if (!last) return null;
  const cols = last.split(/\s+/);
  // macOS df -k: filesystem, 512-blocks... actually: Filesystem 1024-blocks Used Available Capacity iurls ...
  const availK = cols[3];
  const n = availK ? parseInt(availK, 10) : NaN;
  return Number.isFinite(n) ? n * 1024 : null;
}

export function scanVolume(mountPoint: string): SnapshotData {
  const folders = new Map<string, { files: number; bytes: number }>();
  const byExt = new Map<string, { files: number; bytes: number }>();
  const largest: { path: string; bytes: number }[] = [];
  const root = join(mountPoint, "Contents");
  const zeroByte: string[] = [];
  const byFolded = new Map<string, string[]>();
  const age: AgeBuckets = { fresh: 0, recent: 0, old: 0, ancient: 0 };
  let fileCount = 0;
  let totalBytes = 0;
  let orphanForks = 0;

  const walk = (dir: string, topFolder: string | null, rel: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e === ".Trash" || e === "System Volume Information") continue;
      const p = join(dir, e);
      const relPath = rel ? `${rel}/${e}` : e;
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(p, topFolder ?? (e.startsWith(".") ? null : e), relPath);
      } else if (st.isFile()) {
        if (e.startsWith("._")) {
          orphanForks++;
          continue;
        }
        fileCount++;
        totalBytes += st.size;
        if (topFolder) {
          const f = folders.get(topFolder) ?? { files: 0, bytes: 0 };
          f.files++;
          f.bytes += st.size;
          folders.set(topFolder, f);
        }
        const ext = extOf(e);
        const b = byExt.get(ext) ?? { files: 0, bytes: 0 };
        b.files++;
        b.bytes += st.size;
        byExt.set(ext, b);
        if (st.size > 0) {
          largest.push({ path: relPath, bytes: st.size });
          if (AUDIO_EXT.has(ext)) {
            age[ageBucket(st.mtimeMs)]++;
            const key = nfcCasefold(relPath);
            byFolded.set(key, [...(byFolded.get(key) ?? []), relPath]);
          }
        } else {
          zeroByte.push(relPath);
        }
      }
    }
  };

  // Prefer Contents/ when present (rekordbox layout); fall back to the root
  // so non-rekordbox sticks still scan.
  let base = mountPoint;
  let relBase = "";
  try {
    readdirSync(root);
    base = root;
    relBase = "Contents";
  } catch {}
  walk(base, null, relBase);

  largest.sort((a, b) => b.bytes - a.bytes);
  const caseCollisions = [...byFolded.values()]
    .filter((paths) => paths.length > 1)
    .flatMap((paths) => paths)
    .slice(0, 100);

  const snap: SnapshotData = {
    kind: "light",
    taken_at: Date.now(),
    file_count: fileCount,
    total_bytes: totalBytes,
    free_bytes: freeBytes(mountPoint),
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
    junk: {
      zero_byte: zeroByte.slice(0, 100),
      case_collisions: caseCollisions,
      orphan_resource_forks: orphanForks,
    },
  };
  return snap;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "(none)";
}
