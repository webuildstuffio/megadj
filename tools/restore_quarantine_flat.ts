/**
 * tools/restore_quarantine_flat.ts — undo the over-aggressive quarantine:
 * move all UNIQUE songs from ~/Downloads/ingest-duplicates back into the
 * archive ROOT (flat, no genre folders — genre lives in ID3 tags).
 * True " (1)" Safari duplicates stay in quarantine for manual review.
 * DB file_path is repointed for each restored file.
 */
import { Database } from "bun:sqlite";
import { readdirSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";

const home = process.env.HOME!;
const Q = `${home}/Downloads/ingest-duplicates`;
const ARCH = `${home}/Music/DJ-Imports`;
const db = new Database(`${home}/.local/state/megadj/archive.db`);

const files = readdirSync(Q).filter((f) => !f.startsWith("."));
let restored = 0;
let skippedDupes = 0;

for (const f of files) {
  if (/ \(\d+\)\./.test(f)) {
    // Also handle double dupes like "name (1) (1).wav"
    skippedDupes++;
    continue;
  }
  const from = join(Q, f);
  const to = join(ARCH, f);
  if (existsSync(to)) {
    console.log("!! target exists in archive, skipping:", f);
    continue;
  }
  renameSync(from, to);
  // Repoint DB row(s) matching the quarantined path
  const rows = db
    .query("SELECT video_id FROM tracks WHERE file_path LIKE ?")
    .all(`%ingest-duplicates/${f}`) as Array<{ video_id: string }>;
  for (const r of rows) {
    db.query("UPDATE tracks SET file_path = ? WHERE video_id = ?").run(to, r.video_id);
  }
  restored++;
}

console.log(`restored ${restored} unique songs to archive root (flat)`);
console.log(`left ${skippedDupes} true (1)-dupes in quarantine`);
db.close();
