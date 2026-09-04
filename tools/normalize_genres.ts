/** one-off: normalize SC's freeform genres to the canonical DJ taxonomy + write into files */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

const home = process.env.HOME!;
const db = new Database(`${home}/.local/state/megadj/archive.db`);

const CANON: Record<string, string> = {
  "hip-hop & rap": "Hip-Hop", "hip hop": "Hip-Hop", "hip-hop/rap": "Hip-Hop",
  "rap": "Hip-Hop", "trap": "Hip-Hop",
  "dance & edm": "EDM", "dance": "EDM", "electronic": "EDM", "edm": "EDM",
  "house": "House", "deep house": "Deep House", "tech house": "Tech House",
  "bass house": "Bass House", "progressive house": "Progressive House",
  "afro house": "Afro House", "tech house bounce": "Tech House",
  "techno": "Techno", "hard techno": "Techno", "techno trance": "Trance",
  "trance": "Trance", "progressive trance": "Trance",
  "drum & bass": "Drum & Bass", "dnb": "Drum & Bass",
  "dubstep": "Dubstep", "future bass": "Future Bass",
  "r&b": "R&B", "r&b / soul": "R&B", "r&b soul": "R&B", "soul": "R&B",
  "pop": "Pop", "rock": "Rock", "alternative": "Rock",
  "garage": "Garage", "speed garage": "Garage",
  "disco": "Nu-Disco", "nu-disco": "Nu-Disco", "funk": "Nu-Disco",
  "edits / bootlegs": "Edits / Bootlegs", "ambient": "Ambient",
  "beautiful": "Ambient", "world": "World", "reggae": "World",
  "country": "World", "latin": "World",
};
const known = new Set(Object.values(CANON));

interface Row { video_id: string; title: string; genre: string | null; file_path: string }
const rows = db
  .query("SELECT video_id, title, genre, file_path FROM tracks WHERE status='downloaded' AND file_path LIKE '~/Music/DJ-Imports/%'")
  .all() as Row[];

const tagWav = (p: string, genre: string) => {
  const s = `
from mutagen.wave import WAVE
from mutagen.id3 import TCON, APIC
a = WAVE(${JSON.stringify(p)})
if not a.tags: a.add_tags()
a.tags.add(TCON(encoding=3, text=${JSON.stringify(genre)}))
a.save()
print("ok")`;
  const pr = Bun.spawnSync({ cmd: ["uv", "run", "--with", "mutagen", "python", "-c", s], stdout: "pipe" });
  return new TextDecoder().decode(pr.stdout).trim() === "ok";
};
const tagMedia = (p: string, genre: string) => {
  const tmp = p + ".g";
  const pr = Bun.spawnSync({
    cmd: ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", p, "-map", "0", "-c", "copy",
      "-metadata", `genre=${genre}`, tmp],
    stdout: "pipe",
  });
  if (pr.exitCode === 0) { require("node:fs").renameSync(tmp, p); return true; }
  if (existsSync(tmp)) require("node:fs").unlinkSync(tmp);
  return false;
};

// fresh-file rewrite for stubborn mp3s
const tagMediaFresh = (p: string, genre: string) => {
  const tmp = `${p.split("/").slice(0, -1).join("/")}/.g${Date.now()}.mp3`;
  const pr = Bun.spawnSync({
    cmd: ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", p, "-map", "0", "-c", "copy",
      "-metadata", `genre=${genre}`, tmp],
    stdout: "pipe",
  });
  if (pr.exitCode === 0 && existsSync(tmp)) {
    require("node:fs").unlinkSync(p);
    require("node:fs").renameSync(tmp, p);
    return true;
  }
  if (existsSync(tmp)) require("node:fs").unlinkSync(tmp);
  return false;
};

let fixed = 0;
let failed = 0;
for (const r of rows) {
  if (!r.genre || r.genre === "Music") continue;
  const key = r.genre.toLowerCase().trim();
  const canon = CANON[key] ?? r.genre;
  if (!known.has(canon) && canon !== "Edits / Bootlegs") continue;
  if (canon === r.genre) continue;
  db.query("UPDATE tracks SET genre=? WHERE video_id=?").run(canon, r.video_id);
  if (!existsSync(r.file_path)) continue;
  const isWav = r.file_path.toLowerCase().endsWith(".wav");
  const ok = isWav ? tagWav(r.file_path, canon)
    : r.file_path.toLowerCase().endsWith(".mp3") ? tagMedia(r.file_path, canon) || tagMediaFresh(r.file_path, canon)
    : tagMedia(r.file_path, canon);
  if (ok) fixed++;
  else { failed++; console.log(`✗ ${r.title.slice(0, 50)}`); }
}
console.log(`\ngenres normalized in files: ${fixed} (failed: ${failed})`);
db.close();
