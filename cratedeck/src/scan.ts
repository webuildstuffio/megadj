// scan.ts — light scan of a mounted volume: manifest, sizes, folder
// composition, junk detection (zero-byte, case collisions, ._* forks).
// READ-ONLY on the drive: never writes, never renames, never deletes.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SnapshotData } from "../shared/types";

export function nfcCasefold(s: string): string {
  return s.normalize("NFC").toLowerCase();
}

export function scanVolume(mountPoint: string): SnapshotData {
  const folders = new Map<string, { files: number; bytes: number }>();
  const root = join(mountPoint, "Contents");
  const zeroByte: string[] = [];
  const byFolded = new Map<string, string[]>();
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
        if (st.size === 0) zeroByte.push(relPath);
        const key = nfcCasefold(relPath);
        byFolded.set(key, [...(byFolded.get(key) ?? []), relPath]);
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

  const caseCollisions = [...byFolded.values()]
    .filter((paths) => paths.length > 1)
    .flatMap((paths) => paths)
    .slice(0, 100);

  const snap: SnapshotData = {
    kind: "light",
    taken_at: Date.now(),
    file_count: fileCount,
    total_bytes: totalBytes,
    folders: [...folders.entries()]
      .map(([name, f]) => ({ name, ...f }))
      .sort((a, b) => b.files - a.files)
      .slice(0, 100),
    junk: {
      zero_byte: zeroByte.slice(0, 100),
      case_collisions: caseCollisions,
      orphan_resource_forks: orphanForks,
    },
  };
  return snap;
}
