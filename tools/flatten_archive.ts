/**
 * tools/flatten_archive.ts — one-shot: pull every audio file from genre
 * subfolders up into the archive root (flat), repointing DB paths.
 * Then empty subdirs are removed. Genre lives in ID3 tags, not folders.
 */
import { Database } from "bun:sqlite";
import { readdirSync, renameSync, existsSync, rmdirSync, statSync } from "node:fs";
import { join } from "node:path";

const home = process.env.HOME!;
const ARCH = `${home}/Music/DJ-Imports`;
const db = new Database(`${home}/.local/state/megadj/archive.db`);

let moved = 0;
for (const ent of readdirSync(ARCH, { withFileTypes: true })) {
  if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
  const dir = join(ARCH, ent.name);
  for (const f of readdirSync(dir)) {
    if (f.startsWith(".")) continue;
    if (!/\.(m4a|mp3|wav|aiff|flac|meta)$/i.test(f)) continue;
    const from = join(dir, f);
    let to = join(ARCH, f);
    if (existsSync(to)) {
      // name collision: keep both, suffix the mover
      to = join(ARCH, f.replace(/(\.[^.]+)$/, " (flat)$1"));
    }
    renameSync(from, to);
    db.query("UPDATE tracks SET file_path = ? WHERE file_path = ?").run(to, from);
    moved++;
  }
  // remove dir if empty (ignoring dotfiles)
  const left = readdirSync(dir).filter((x) => !x.startsWith("."));
  if (left.length === 0) {
    rmdirSync(dir);
    console.log("removed empty folder:", ent.name);
  } else {
    console.log(`folder ${ent.name} kept — ${left.length} non-audio files`);
  }
}
console.log(`flattened ${moved} files into archive root`);
db.close();
