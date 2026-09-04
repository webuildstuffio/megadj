/**
 * sc_art_direct.ts — for art-less tracks: resolve SoundCloud track pages via
 * yt-dlp (full metadata, not flat) and pull the artwork directly. More
 * reliable than flat-playlist thumbnails for tracks whose avatar was
 * substituted. Writes APIC into WAVs / mjpeg into mp3s.
 */
import { Database } from "bun:sqlite";
import { readdirSync, writeFileSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

const home = process.env.HOME!;
const ARCH = `${home}/Music/DJ-Imports`;
const db = new Database(`${home}/.local/state/megadj/archive.db`);
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126.0 Safari/537.36" };

interface Row { video_id: string; title: string; artist: string | null; file_path: string }
const rows = db
  .query("SELECT video_id, title, artist, file_path FROM tracks WHERE status='downloaded' AND file_path LIKE '~/Music/DJ-Imports/%'")
  .all() as Row[];
const files = new Set(readdirSync(ARCH).filter((f) => !f.startsWith(".") && /\.(wav|mp3|m4a)$/i.test(f)));
const todo = rows.filter((r) => files.has(r.file_path.split("/").pop() ?? "") && existsSync(r.file_path));

function hasArtWav(p: string): boolean {
  const s = `from mutagen.wave import WAVE
a = WAVE(${JSON.stringify(p)})
print("1" if a.tags and any(k.startswith("APIC") for k in a.tags.keys()) else "0")`;
  const pr = Bun.spawnSync({ cmd: ["uv", "run", "--with", "mutagen", "python", "-c", s], stdout: "pipe" });
  return new TextDecoder().decode(pr.stdout).trim() === "1";
}
function needArt(r: Row): boolean {
  const ext = r.file_path.toLowerCase().slice(-4);
  if (ext === ".wav") return !hasArtWav(r.file_path);
  const pr = Bun.spawnSync({
    cmd: ["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=index", "-of", "csv=p=0", r.file_path],
  });
  return !(pr.exitCode === 0 && pr.stdout.toString().trim().length > 0);
}

function cleanQuery(r: Row): string {
  const artist0 = (r.artist ?? "").split(/[,&]/)[0].trim();
  const t = r.title
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(final|mstr|master|vip|full|cdq|extended|radio edit|feat\.?|ft\.?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${artist0} ${t}`.split(" ").filter(Boolean).slice(0, 8).join(" ");
}

async function fetchArtFromScPage(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const html = await res.text();
    const og = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/)?.[1];
    if (!og) return null;
    const big = og.replace(/-(large|t\d+x\d+)\.jpg/, "-t500x500.jpg");
    for (const u of [big, og]) {
      try {
        const img = await fetch(u, { headers: UA, signal: AbortSignal.timeout(12000) });
        if (!img.ok) continue;
        const b = new Uint8Array(await img.arrayBuffer());
        if (b.length > 3000) return b;
      } catch {}
    }
  } catch {}
  return null;
}

const targets = todo.filter(needArt);
console.log(`art-less tracks: ${targets.length}`);

let got = 0;
const JOBS = 6;
let idx = 0;
async function worker() {
  while (true) {
    const i = idx++;
    if (i >= targets.length) break;
    const r = targets[i]!;
    const q = cleanQuery(r);
    const pr = Bun.spawnSync({
      cmd: ["yt-dlp", "--flat-playlist", "--print", "U|%(webpage_url)s|%(title).60s", `scsearch4:${q}`],
      stdout: "pipe", stderr: "pipe", timeout: 45_000,
    });
    const out = new TextDecoder().decode(pr.stdout);
    const tWords = r.title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
    for (const line of out.split("\n")) {
      if (!line.startsWith("U|")) continue;
      const [url, t] = line.slice(2).split("|");
      if (!url?.includes("soundcloud.com")) continue;
      const hWords = (t ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
      const overlap = tWords.filter((w) => hWords.includes(w)).length;
      if (overlap < 1) continue;
      const bytes = await fetchArtFromScPage(url);
      if (!bytes) continue;
      // embed
      const dump = r.file_path + ".d.jpg";
      writeFileSync(dump, bytes);
      let ok = false;
      if (r.file_path.toLowerCase().endsWith(".wav")) {
        const s = `
from mutagen.wave import WAVE
from mutagen.id3 import ID3, APIC
a = WAVE(${JSON.stringify(r.file_path)})
try:
    a.add_tags()
except Exception:
    pass
if not isinstance(a.tags, ID3):
    a.tags = ID3()
a.tags.add(APIC(encoding=3, mime="image/jpeg", type=3, desc="Cover", data=open(${JSON.stringify(dump)}, "rb").read()))
a.save()
print("ok")`;
        const p2 = Bun.spawnSync({ cmd: ["uv", "run", "--with", "mutagen", "python", "-c", s], stdout: "pipe" });
        ok = new TextDecoder().decode(p2.stdout).trim() === "ok";
      } else {
        const tmp = r.file_path + ".na";
        const p2 = Bun.spawnSync({
          cmd: ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", r.file_path, "-i", dump,
            "-map", "0:a", "-map", "1:v", "-c:a", "copy", "-c:v", "mjpeg", "-disposition:v:0", "attached_pic", tmp],
          stdout: "pipe",
        });
        ok = p2.exitCode === 0;
        if (ok) renameSync(tmp, r.file_path);
        else if (existsSync(tmp)) unlinkSync(tmp);
      }
      unlinkSync(dump);
      if (ok) {
        got++;
        db.query("UPDATE tracks SET artwork_status='embedded:sc-page', format_id=? WHERE video_id=?").run(`sc:${url}`, r.video_id);
        console.log(`  [${i + 1}/${targets.length}] ✓ ${r.title.slice(0, 55)}`);
      }
      break; // first matching hit only
    }
    if (!out.split("\n").some((l) => l.startsWith("U|"))) {
      console.log(`  [${i + 1}/${targets.length}] no SC hit: ${r.title.slice(0, 50)}`);
    }
  }
}
await Promise.all(Array.from({ length: JOBS }, () => worker()));
console.log(`\nembedded: ${got}/${targets.length}`);
db.close();
