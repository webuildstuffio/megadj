/**
 * tools/review_shorts.ts — move TikTok/YouTube shorts, podcasts, and other
 * sub-60s or non-DJ clips OUT of the archive root into a review folder
 * (~/Music/DJ-Imports-review/). NOT deleted — user reviews later.
 * Uses the DB duration + filename heuristics (#shorts, Reel, etc).
 */
import { Database } from "bun:sqlite";
import { readdirSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const home = process.env.HOME!;
const ARCH = `${home}/Music/DJ-Imports`;
const REVIEW = `${home}/Music/DJ-Imports-review`;
mkdirSync(REVIEW, { recursive: true });
const db = new Database(`${home}/.local/state/megadj/archive.db`);

const SHORTS = /#shorts|#reel|tiktok|live at|live set|mix[ -]?(202\d)|set ⧸|podcast|mixtape|nonstop|min(ute)?s?( )?(mix|set)|%|#dj|full album|documentary|reaction|freestyle|how |when |why |pov|things|guess|react|tutorial|essay|ranking|top \d+/i;

const files = readdirSync(ARCH).filter(
  (f) =>
    !f.startsWith(".") &&
    /\.(m4a|mp3|wav|aiff|flac)$/i.test(f),
);
let moved = 0;
let kept = 0;

for (const f of files) {
  const from = join(ARCH, f);
  const row = db
    .query("SELECT duration_s, title FROM tracks WHERE file_path = ?")
    .get(from) as { duration_s: number | null; title: string | null } | undefined;
  const dur = row?.duration_s ?? null;
  const looksShort = SHORTS.test(f);
  const tooShort = dur !== null && dur < 90; // <90s is not DJ material

  if (looksShort || tooShort) {
    const to = join(REVIEW, f);
    if (!existsSync(to)) {
      renameSync(from, to);
      db.query("UPDATE tracks SET file_path = ? WHERE file_path = ?").run(to, from);
      moved++;
      if (looksShort && !tooShort) continue; // logged below only if moved
    }
  } else {
    kept++;
  }
}
console.log(`moved ${moved} shorts/clips to ~/Music/DJ-Imports-review/`);
db.close();
