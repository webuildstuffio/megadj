/** sync_genres.ts — production: push DB genre into file tags for any archive file
 * whose embedded genre is missing/stale. Ground-truth read via ffprobe/mutagen;
 * WAV via mutagen (keeps APIC), mp3 via fresh-file rewrite, m4a via ffmpeg copy.
 */
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const home = process.env.HOME!;
const ARCH = `${home}/Music/DJ-Imports`;
const db = new Database(`${home}/.local/state/megadj/archive.db`);

interface Row { video_id: string; title: string; genre: string | null; file_path: string }
const rows = db
  .query("SELECT video_id, title, genre, file_path FROM tracks WHERE status='downloaded' AND file_path LIKE '~/Music/DJ-Imports/%'")
  .all() as Row[];
const files = new Set(readdirSync(ARCH).filter((f) => !f.startsWith(".") && /\.(wav|mp3|m4a|flac|aiff)$/i.test(f)));

function currentGenre(p: string): string | null {
  const pr = Bun.spawnSync({
    cmd: ["ffprobe", "-v", "error", "-show_entries", "format_tags=genre", "-of", "json", p],
    stdout: "pipe",
  });
  try {
    return JSON.parse(new TextDecoder().decode(pr.stdout)).format?.tags?.genre ?? null;
  } catch {
    return null;
  }
}

const tagWav = (p: string, genre: string) => {
  const s = `
from mutagen.wave import WAVE
from mutagen.id3 import TCON
a = WAVE(${JSON.stringify(p)})
if not a.tags: a.add_tags()
a.tags.add(TCON(encoding=3, text=${JSON.stringify(genre)}))
a.save()
print("ok")`;
  const pr = Bun.spawnSync({ cmd: ["uv", "run", "--with", "mutagen", "python", "-c", s], stdout: "pipe" });
  return new TextDecoder().decode(pr.stdout).trim() === "ok";
};
const tagFresh = (p: string, genre: string) => {
  const tmp = join(ARCH, `.sg${Date.now()}${p.slice(-4)}`);
  const pr = Bun.spawnSync({
    cmd: ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", p, "-map", "0", "-c", "copy",
      "-metadata", `genre=${genre}`, tmp],
    stdout: "pipe",
  });
  if (pr.exitCode === 0 && existsSync(tmp)) { unlinkSync(p); renameSync(tmp, p); return true; }
  if (existsSync(tmp)) unlinkSync(tmp);
  return false;
};

let fixed = 0;
for (const r of rows) {
  const fname = r.file_path.split("/").pop() ?? "";
  if (!files.has(fname) || !existsSync(r.file_path)) continue;
  if (!r.genre || r.genre === "Music") continue;
  const cur = currentGenre(r.file_path);
  if (cur === r.genre) continue;
  const isWav = r.file_path.toLowerCase().endsWith(".wav");
  const ok = isWav ? tagWav(r.file_path, r.genre) : tagFresh(r.file_path, r.genre);
  console.log(`${ok ? "✓" : "✗"} ${r.genre}: ${fname.slice(0, 55)}`);
  if (ok) fixed++;
}
console.log(`\nsynced: ${fixed}`);
db.close();
