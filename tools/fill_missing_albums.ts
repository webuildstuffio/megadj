/**
 * tools/fill_missing_albums.ts — give every downloaded track a sensible
 * album tag so no field is empty:
 *   - remixes/edits → "<Remixer> remixes / flips / edits" (already done by
 *     ingest) — this pass catches any leftovers
 *   - everything else → "<Artist> — Singles"
 * Idempotent: only fills NULL/empty album, never overwrites.
 */
import { Database } from "bun:sqlite";
import { $ } from "bun";
import { existsSync, renameSync } from "node:fs";

const home = process.env.HOME!;
const db = new Database(`${home}/.local/state/megadj/archive.db`);

const rows = db
  .query(
    "SELECT video_id, title, artist, album, file_path FROM tracks WHERE status='downloaded' AND (album IS NULL OR album = '')",
  )
  .all() as Array<{
  video_id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  file_path: string | null;
}>;

console.log(`tracks with empty album: ${rows.length}`);
let dbOnly = 0;
let tagged = 0;
let skippedNoFile = 0;

for (const r of rows) {
  const artist = r.artist ?? "Unknown";
  // Contextual bucket: reuse the remix/flip/edit wording if the title has it.
  const t = (r.title ?? "").toLowerCase();
  let album: string;
  if (/\bflip\b/.test(t)) album = `${artist} flips`;
  else if (/\bremix\b/.test(t)) album = `${artist} remixes`;
  else if (/\b(edit|rework|re-rub|vip|mashup|bootleg)\b/.test(t)) album = `${artist} edits`;
  else if (/\b(extended mix|radio edit|instrumental)\b/.test(t)) album = `${artist} — Singles`;
  else album = `${artist} — Singles`;

  db.query("UPDATE tracks SET album = ? WHERE video_id = ?").run(album, r.video_id);
  dbOnly++;

  // Also write into the file when it exists on disk (cheap remux).
  const p = r.file_path;
  if (p && existsSync(p)) {
    const tmp = p.replace(/(\.[^.]+)$/, ".alb$1");
    const pr =
      await $`ffmpeg -y -hide_banner -loglevel error -i ${p} -c copy -map 0 -vn -metadata album=${album} ${tmp}`
        .quiet()
        .nothrow();
    if (pr.exitCode === 0) {
      renameSync(tmp, p);
      tagged++;
    } else {
      console.log(`  ffmpeg failed for ${r.title ?? p}: ${(pr.stderr as Buffer).toString().slice(0, 140)}`);
      try {
        const { unlinkSync } = await import("node:fs");
        unlinkSync(tmp);
      } catch {}
    }
  } else {
    skippedNoFile++;
  }
}
console.log(
  `DB updated: ${dbOnly} | files retagged: ${tagged} | file missing (DB-only): ${skippedNoFile}`,
);
db.close();
