/**
 * fix_years.ts — correct every track's year using the REAL upload date from
 * its SoundCloud page (`display_date` in the page's JSON), falling back to
 * yt-dlp's %(timestamp)s, then AI as last resort. Overwrites the AI guess
 * of 2023 that flash-lite defaulted to.
 *
 * usage: bun tools/fix_years.ts [--dry-run]
 */
import { Database } from "bun:sqlite";
import { setFileTags, groundTruth } from "./fetch_lib";

const home = process.env.HOME!;
const db = new Database(`${home}/.local/state/megadj/archive.db`);
const DRY = process.argv.includes("--dry-run");

interface Row {
  video_id: string;
  title: string;
  artist: string | null;
  file_path: string;
  format_id: string | null;
  year: string | null;
}

const rows = db
  .query(
    "SELECT video_id, title, artist, file_path, format_id, year FROM tracks WHERE status='downloaded' AND file_path LIKE '~/Music/DJ-Imports/%'",
  )
  .all() as Row[];

function scPageYear(url: string): number | null {
  try {
    const res = fetchSync(url);
    const m = res.match(/"display_date":"(\d{4})-\d{2}-\d{2}T/);
    if (m?.[1]) return Number(m[1]);
    const r2 = res.match(/"release_date":"(\d{4})-/);
    if (r2?.[1]) return Number(r2[1]);
    const r3 = res.match(/"created_at":"(\d{4})-\d{2}-\d{2}T/);
    if (r3?.[1]) return Number(r3[1]);
  } catch {}
  return null;
}

function fetchSync(url: string): string {
  const pr = Bun.spawnSync({
    cmd: [
      "curl",
      "-sL",
      "--max-time",
      "12",
      "-A",
      "Mozilla/5.0 (Macintosh)",
      url,
    ],
    stdout: "pipe",
  });
  return new TextDecoder().decode(pr.stdout);
}

/** yt-dlp full-metadata fetch (not flat) gives exact timestamp. */
function ytdlpYear(url: string): number | null {
  const pr = Bun.spawnSync({
    cmd: [
      "yt-dlp",
      "--no-download",
      "--print",
      "%(timestamp)s|%(upload_date)s",
      url,
    ],
    stdout: "pipe",
    stderr: "pipe",
    timeout: 45_000,
  });
  const out = new TextDecoder().decode(pr.stdout).trim();
  const ts = Number(out.split("|")[0]);
  if (Number.isFinite(ts) && ts > 946_684_800)
    return new Date(ts * 1000).getUTCFullYear();
  const ud = out.split("|")[1];
  if (ud && /^\d{8}$/.test(ud)) return Number(ud.slice(0, 4));
  return null;
}

let scPage = 0;
let ytdlp = 0;
let kept = 0;
let failed: Row[] = [];

for (const r of rows) {
  const t = groundTruth(r.file_path);
  let year: number | null = null;
  let source = "";

  // 1. permalink in format_id → real SC page date
  if (r.format_id?.startsWith("sc:")) {
    const url = r.format_id.slice(3);
    year = scPageYear(url);
    if (year) source = "sc-page";
  }
  // 2. yt-dlp full metadata (search → top hit timestamp)
  if (!year && r.format_id?.startsWith("sc:")) {
    year = ytdlpYear(r.format_id.slice(3));
    if (year) source = "yt-dlp";
  }
  // 3. keep existing non-2023 year (probably intentional)
  if (!year && r.year && r.year !== "2023") {
    kept++;
    continue;
  }
  if (!year) {
    failed.push(r);
    continue;
  }

  const current = t.year ?? r.year;
  if (current === String(year)) {
    kept++;
    continue;
  }
  if (!DRY) {
    setFileTags(r.file_path, { year });
    db.query("UPDATE tracks SET year=? WHERE video_id=?").run(
      String(year),
      r.video_id,
    );
  }
  if (source === "sc-page") scPage++;
  else ytdlp++;
  console.log(
    `  ${current ?? "?"} → ${year} (${source}) — ${r.artist ?? "?"}: ${r.title.slice(0, 45)}`,
  );
}

console.log(
  `\n${DRY ? "DRY " : ""}DONE — sc-page: ${scPage} | yt-dlp: ${ytdlp} | kept: ${kept} | unresolved: ${failed.length}`,
);
for (const f of failed) console.log(`  ? ${f.title.slice(0, 60)}`);
db.close();
