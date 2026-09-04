/**
 * sc_genres.ts — fetch genre for archive tracks from SoundCloud via yt-dlp.
 * SC tags (#house etc.) are the source of truth for where a track came from.
 * Only writes when yt-dlp returns a real genre and the DB genre is missing/Music.
 */
import { Database } from "bun:sqlite";

const home = process.env.HOME!;
const db = new Database(`${home}/.local/state/megadj/archive.db`);
const JOBS = 6;

interface Row { video_id: string; title: string; artist: string | null; genre: string | null; file_path: string }
const rows = db
  .query("SELECT video_id, title, artist, genre, file_path FROM tracks WHERE status='downloaded' AND file_path LIKE '~/Music/DJ-Imports/%'")
  .all() as Row[];
const todo = rows.filter((r) => !r.genre || r.genre === "Music");
console.log(`tracks needing genre: ${todo.length}`);

function cleanQuery(r: Row): string {
  const artist0 = (r.artist ?? "unknown").split(/[,&]/)[0].trim();
  const t = r.title
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(final|mstr|master|vip|full|cdq|extended|remix|flip|edit|mash|rework)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${artist0} ${t}`.split(" ").filter(Boolean).slice(0, 8).join(" ");
}

function scGenre(r: Row): string | null {
  const q = cleanQuery(r);
  const pr = Bun.spawnSync({
    cmd: ["yt-dlp", "--flat-playlist", "--print", "G|%(title).60s|%(uploader)s|%(genre)s|%(thumbnails).400s", `scsearch4:${q}`],
    stdout: "pipe", stderr: "pipe", timeout: 45_000,
  });
  const out = new TextDecoder().decode(pr.stdout);
  const tWords = r.title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  for (const line of out.split("\n")) {
    if (!line.startsWith("G|")) continue;
    const [t, uploader, genre] = line.slice(2).split("|");
    if (!genre || genre === "NA" || !t) continue;
    const hWords = t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
    const overlap = tWords.filter((w) => hWords.includes(w)).length;
    if (overlap < 1) continue;
    // SC genres look like "#house" or "Hip-hop & Rap"
    const g = genre.replace(/^#/, "").trim();
    if (!g) continue;
    return g.charAt(0).toUpperCase() + g.slice(1);
  }
  return null;
}

let idx = 0;
let got = 0;
async function worker() {
  while (true) {
    const i = idx++;
    if (i >= todo.length) break;
    const r = todo[i]!;
    const g = scGenre(r);
    if (g) {
      db.query("UPDATE tracks SET genre=? WHERE video_id=?").run(g, r.video_id);
      got++;
      console.log(`  [${i + 1}/${todo.length}] ${g}: ${r.title.slice(0, 50)}`);
    } else {
      console.log(`  [${i + 1}/${todo.length}] -: ${r.title.slice(0, 50)}`);
    }
  }
}
await Promise.all(Array.from({ length: JOBS }, () => worker()));
console.log(`\ngenre set: ${got}/${todo.length}`);
db.close();
