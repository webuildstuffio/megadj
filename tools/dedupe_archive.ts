/**
 * tools/dedupe_archive.ts — idempotent archive dedupe pass.
 * Keeps the highest-quality copy per identity, deletes loser DB rows,
 * quarantines loser files into ~/Downloads/ingest-duplicates.
 * Also removes non-audio test rows and Safari " (1)" leftovers.
 */
import { Database } from "bun:sqlite";
import { renameSync, existsSync } from "node:fs";

const home = process.env.HOME!;
const db = new Database(`${home}/.local/state/megadj/archive.db`);
const norm = (s: string | null) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[(\[].*?[)\]]/g, " ")
    .replace(/\s\(\d+\)/g, " ")
    .replace(/\b(final|master|mstr|v\d+)\b/g, " ")
    .replace(/_/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// 0. Drop test fixture rows (never real tracks).
const testIds = db
  .query(
    "SELECT video_id, file_path FROM tracks WHERE title LIKE '%Test Track%' OR title LIKE '%Renamed Title%' OR title LIKE '%No Tag%' OR title LIKE '%Strip Test%'",
  )
  .all() as Array<{ video_id: string; file_path: string | null }>;
for (const t of testIds) {
  db.query("DELETE FROM tracks WHERE video_id = ?").run(t.video_id);
  if (t.file_path && existsSync(t.file_path)) {
    try {
      renameSync(t.file_path, `/tmp/usb-sync/removed_${t.file_path.split("/").pop()}`);
    } catch {}
  }
}
console.log("test fixture rows removed:", testIds.length);

// 0b. Rows whose FILENAME still carries a Safari " (1)" marker are dupes
// by definition — the clean-named copy is the keeper.
const safari = db
  .query(
    "SELECT video_id, file_path FROM tracks WHERE status='downloaded' AND source='ingest' AND file_path LIKE '% (1).%'",
  )
  .all() as Array<{ video_id: string; file_path: string }>;
let safariRemoved = 0;
for (const s of safari) {
  const cleanPath = s.file_path.replace(/ \(1\)(\.[^.]+)$/, "$1");
  if (existsSync(cleanPath)) {
    db.query("DELETE FROM tracks WHERE video_id = ?").run(s.video_id);
    try {
      renameSync(s.file_path, `${home}/Downloads/ingest-duplicates/${s.file_path.split("/").pop()}`);
      safariRemoved++;
    } catch {}
    console.log("safari-dupe removed:", s.file_path.split("/").pop());
  }
}
console.log("safari dupes removed:", safariRemoved);

// 1. Dedupe downloaded+ingest by identity.
const rows = db
  .query(
    "SELECT video_id, title, artist, file_path, bitrate_kbps, file_size_bytes FROM tracks WHERE status='downloaded' AND source='ingest'",
  )
  .all() as Array<{
  video_id: string;
  title: string | null;
  artist: string | null;
  file_path: string | null;
  bitrate_kbps: number | null;
  file_size_bytes: number | null;
}>;
const byId = new Map<string, typeof rows>();
for (const r of rows) {
  const key = `${norm(r.artist)}|${norm(r.title)}`;
  if (!byId.has(key)) byId.set(key, []);
  byId.get(key)!.push(r);
}
let removedDb = 0;
let moved = 0;
for (const group of Array.from(byId.values())) {
  if (group.length < 2) continue;
  group.sort(
    (a, b) =>
      (b.bitrate_kbps ?? 0) - (a.bitrate_kbps ?? 0) ||
      (b.file_size_bytes ?? 0) - (a.file_size_bytes ?? 0),
  );
  const winner = group[0]!;
  for (const loser of group.slice(1)) {
    db.query("DELETE FROM tracks WHERE video_id = ?").run(loser.video_id);
    removedDb++;
    const p = loser.file_path;
    if (p && existsSync(p) && p !== winner.file_path && p.includes("YTMusic-Liked")) {
      try {
        renameSync(p, `${home}/Downloads/ingest-duplicates/${p.split("/").pop()}`);
        moved++;
      } catch {}
    }
  }
  console.log("kept:", winner.file_path?.split("/").pop());
}
console.log("dupes: removed", removedDb, "DB rows,", moved, "files quarantined");
db.close();
