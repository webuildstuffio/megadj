/**
 * One-time migration: the archive used to be flat (everything at
 * `~/Music/DJ-Imports/<file>`); per-dump intake folders are the layout now.
 * Each pre-batch file moves into a dated folder by its mtime
 * (`YYYY-MM-DD batch import`), DB file_path values follow.
 *
 * Kept as a reversible, re-runnable script: it only moves ROOT-level audio
 * files (subfolders already conform), records every move, and verifies the
 * DB update count matches. Run: `bun tools/migrate-intake-folders.ts`
 * (docs/skill updated to describe the layout; no command surface needed —
 * this transition happens exactly once).
 */
import { readdirSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";

const ARCHIVE =
  process.env.MEGADJ_MUSIC_DIR ?? `${process.env.HOME}/Music/DJ-Imports`;
const DB =
  process.env.MEGADJ_DB ?? `${process.env.HOME}/.local/state/megadj/archive.db`;

const AudioRe = /\.(mp3|m4a|wav|aiff?|flac)$/i;

function folderFor(mtime: Date): string {
  const y = mtime.getFullYear();
  const m = String(mtime.getMonth() + 1).padStart(2, "0");
  const d = String(mtime.getDate()).padStart(2, "0");
  return `${y}-${m}-${d} batch import`;
}

const entries = readdirSync(ARCHIVE, { withFileTypes: true });
const rootAudio = entries
  .filter((e) => e.isFile() && AudioRe.test(e.name))
  .map((e) => join(ARCHIVE, e.name));

const subfolders = entries
  .filter((e) => e.isDirectory() && !e.name.startsWith("."))
  .map((e) => e.name);
console.log(
  `root audio files: ${rootAudio.length}; existing subfolders: ${subfolders.length ? subfolders.join(", ") : "none"}`,
);

if (rootAudio.length === 0) {
  console.log("nothing to migrate.");
  process.exit(0);
}

// Group by target folder so each folder is created once.
const groups = new Map<string, string[]>();
for (const p of rootAudio) {
  const st = statSync(p);
  const folder = folderFor(st.mtime);
  const list = groups.get(folder) ?? [];
  list.push(p);
  groups.set(folder, list);
}

let moved = 0;
const dbUpdates: Array<[string, string]> = [];
for (const [folder, files] of [...groups].sort()) {
  const destDir = join(ARCHIVE, folder);
  if (!existsSync(destDir)) {
    Bun.spawnSync(["mkdir", "-p", destDir]);
  }
  for (const src of files) {
    const dest = join(destDir, basename(src));
    if (existsSync(dest)) {
      console.error(`✗ destination exists, SKIPPED: ${dest}`);
      continue;
    }
    const r = Bun.spawnSync(["mv", src, dest]);
    if (r.exitCode !== 0) {
      console.error(`✗ move failed, SKIPPED: ${src}`);
      continue;
    }
    moved++;
    dbUpdates.push([src, dest]);
  }
  console.log(`${folder}: ${files.length} file(s)`);
}

// DB paths follow the files.
let dbUpdated = 0;
for (const [from, to] of dbUpdates) {
  const q = Bun.spawnSync({
    cmd: [
      "sqlite3",
      DB,
      `UPDATE tracks SET file_path='${to.replaceAll("'", "''")}' WHERE file_path='${from.replaceAll("'", "''")}'; SELECT changes();`,
    ],
    stdout: "pipe",
  });
  dbUpdated += Number(new TextDecoder().decode(q.stdout).trim()) || 0;
}

console.log(
  `migrated ${moved} file(s); DB rows updated: ${dbUpdated} (expected ${moved})`,
);
if (dbUpdated !== moved) {
  console.error("✗ mismatch between moved files and DB updates — investigate");
  process.exit(1);
}
