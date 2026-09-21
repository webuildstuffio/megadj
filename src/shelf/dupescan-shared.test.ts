import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { DupFpCache } from "./dupescan-shared";

/**
 * Regression pins for the hygiene fpOfRow bridge (Sep 21 branch review):
 * the fp cache is keyed by RAW walked paths while the master DB's
 * FolderPath is a different string form (case + NFC). The bridge must
 * join through a normalized index (allRows) — a raw-key get missed on
 * virtually every path and silently starved the DB-vs-disk checks.
 */

/** The name key rule the bridge joins through (#238): NFC + lowercase. */
const nameKey = (p: string): string => p.normalize("NFC").toLowerCase();

function rawKeyJoinWouldMiss(storedPath: string, rowPath: string): boolean {
  // The OLD buggy read: cache.get(nameKeyPath(row.folderPath), size)
  // vs put-side raw `storedPath`. Pin the divergence itself.
  return nameKey(rowPath) !== storedPath;
}

describe("DupFpCache fpOfRow bridge", () => {
  test("allRows exposes raw stored paths for normalized joining", () => {
    const db = new Database(":memory:");
    const cache = new DupFpCache(db, "bridge_fingerprints");
    const walkedPath = "/Volumes/SHELF1/Music/Beyoncé - Halo.mp3";
    // Walk-side (put): raw readdir form — case-preserved, possibly NFD.
    cache.put(walkedPath, 1234, "fp-abc");
    cache.put("/Volumes/SHELF1/Music/plain.mp3", 42, "fp-def");
    // null fingerprints surface too (caller filters) — never poisoned rows
    cache.put("/Volumes/SHELF1/Music/never-computed.mp3", 7, null);

    const rows = cache.allRows();
    expect(rows.length).toBe(3);
    const byPath = new Map(rows.map((r) => [r.path, r]));
    expect(byPath.get("/Volumes/SHELF1/Music/plain.mp3")?.fingerprint).toBe(
      "fp-def",
    );
    expect(
      byPath.get("/Volumes/SHELF1/Music/never-computed.mp3")?.fingerprint,
    ).toBeNull();
  });

  test("nameKey form vs raw storage diverges — the miss the index fixes", () => {
    const db = new Database(":memory:");
    const cache = new DupFpCache(db, "bridge_fingerprints");
    const walkedPath = "/Volumes/SHELF1/Music/Beyoncé - Halo.mp3";
    cache.put(walkedPath, 1234, "fp-abc");

    // DB form: NFD (as rekordbox/macOS frequently stores) + case diff
    const rowPath = walkedPath
      .normalize("NFD")
      .replace("/Volumes/SHELF1/Music", "/Volumes/shelf1/music");
    // The OLD bridge read (normalized key against raw-keyed store) missed:
    expect(cache.get(nameKey(rowPath), 1234)).toBeUndefined();
    expect(rawKeyJoinWouldMiss(walkedPath, rowPath)).toBeTrue();

    // The NEW bridge: normalized index over allRows() hits.
    const index = new Map<string, Map<number, string>>();
    for (const r of cache.allRows()) {
      if (r.fingerprint === null) continue;
      let bySize = index.get(nameKey(r.path));
      if (bySize === undefined) {
        bySize = new Map();
        index.set(nameKey(r.path), bySize);
      }
      bySize.set(r.size, r.fingerprint);
    }
    expect(index.get(nameKey(rowPath))?.get(1234)).toBe("fp-abc");
  });
});
