/**
 * tools/fix_dupes_and_tags.ts — repair pass after crash-interrupted ingests:
 *   1. Inverted dupes: archive holds "name (1).ext" while quarantine holds
 *      the clean-named twin → swap back; if no twin exists, rename in place.
 *   2. Partial-tag files (missing artist): infer artist/remixer from the
 *      filename, fill album bucket + genre, rewrite tags in place.
 *   3. Remove stray debug-tagged files (artist='Test Artist').
 * Idempotent: running twice is a no-op.
 */
import { Database } from "bun:sqlite";
import { renameSync, existsSync } from "node:fs";
import { $ } from "bun";

const home = process.env.HOME!;
const Q = `${home}/Downloads/ingest-duplicates`;
const ARCH = `${home}/Music/DJ-Imports`;
const db = new Database(`${home}/.local/state/megadj/archive.db`);

interface Row {
  video_id: string;
  title: string | null;
  artist: string | null;
  file_path: string;
}

// ---- 0. Remove debug leftovers ---------------------------------------
const testRows = db
  .query("SELECT video_id, file_path FROM tracks WHERE artist = 'Test Artist'")
  .all() as Array<{ video_id: string; file_path: string }>;
for (const t of testRows) {
  db.query(
    "UPDATE tracks SET artist = NULL, album = NULL WHERE video_id = ?",
  ).run(t.video_id);
  console.log("cleared debug artist on:", t.file_path?.split("/").pop());
}

// ---- 1. Fix inverted (1)-dupes --------------------------------------
const bad = db
  .query(
    "SELECT video_id, title, file_path FROM tracks WHERE status='downloaded' AND source='ingest' AND file_path LIKE '% (1)%'",
  )
  .all() as Row[];

for (const r of bad) {
  const clean = r.file_path.replace(/(?: \(\d+\))+(\.[^.]+)$/, "$1");
  const base = r.file_path.split("/").pop()!;
  const cleanInQ = `${Q}/${clean.split("/").pop()}`;
  if (existsSync(cleanInQ)) {
    renameSync(r.file_path, `${Q}/${base}`);
    renameSync(cleanInQ, clean);
    db.query("UPDATE tracks SET file_path = ? WHERE video_id = ?").run(
      clean,
      r.video_id,
    );
    console.log("swapped back:", clean.split("/").pop());
  } else {
    // same-named twin already in quarantine — just rename in place
    renameSync(r.file_path, clean);
    db.query("UPDATE tracks SET file_path = ? WHERE video_id = ?").run(
      clean,
      r.video_id,
    );
    console.log("renamed in place:", clean.split("/").pop());
  }
}

// ---- 2. Partial-tag files: infer artist ------------------------------
const rows = db
  .query(
    "SELECT video_id, title, artist, file_path FROM tracks WHERE status='downloaded' AND source='ingest' AND (artist IS NULL OR artist = '' OR artist = 'Unknown')",
  )
  .all() as Row[];

// Manual overrides for no-pattern files (researched by hand).
const MANUAL: Record<string, { artist: string; genre: string }> = {
  "WHERE IS MY HUBAND “MARIO” Extended Mix.wav": {
    artist: "Mario",
    genre: "Hip-Hop",
  },
  "Xue Hue out of Great Heights v1 (EXTENDED).wav": {
    artist: "Xue Hue",
    genre: "House",
  },
  "Hynotize.wav": { artist: "RAYMA", genre: "House" },
  "LANDR-Out of Place II-Balanced-Medium.wav": {
    artist: "LANDR",
    genre: "House",
  },
  "MASTER SNOOP G SAM PROGRESSIVE AFRO HOUSE 124 PUNCHY MIX UP DROP .mp3": {
    artist: "Snoop G Sam",
    genre: "Afro House",
  },
  "D2D Low (flo rida) Flip; final.wav": {
    artist: "D2D",
    genre: "Edits / Bootlegs",
  },
};

let fixed = 0;
for (const r of rows) {
  if (!r.file_path || !existsSync(r.file_path)) continue;
  const fname = r.file_path.split("/").pop()!;
  const stem = fname.replace(/\.[^.]+$/, "");

  let artist: string | null = null;
  let album: string;
  let genre = "Edits / Bootlegs";

  const manual = MANUAL[fname];
  const flipStyle =
    /^([A-Za-z0-9 .&']{2,30}?)\s+(?:\(([^)]+)\)\s*)?(?:flip|remix|edit)\b/i.exec(
      stem,
    );
  const parenStyle =
    /\(([^()]{3,50}?)\s+(?:x\s+[^()]*?)?(?:final|remix|edit|flip)\s*\)/i.exec(
      stem,
    );

  if (manual) {
    artist = manual.artist;
    genre = manual.genre;
    album = `${artist} edits`;
  } else if (flipStyle?.[1]) {
    artist = flipStyle[1].trim();
    album = stem.toLowerCase().includes("flip")
      ? `${artist} flips`
      : `${artist} remixes`;
  } else if (parenStyle?.[1]) {
    artist = parenStyle[1].trim().replace(/\s+x\s+/i, " & ");
    album = stem.toLowerCase().includes("flip")
      ? `${artist} flips`
      : `${artist} remixes`;
  } else {
    console.log("needs human:", fname);
    continue;
  }

  // Interpolations are single args for Bun $ — never inline spaced literals.
  const g = genre;
  const tmp = r.file_path.replace(/(\.[^.]+)$/, ".fix$1");
  const pr =
    await $`ffmpeg -y -hide_banner -loglevel error -i ${r.file_path} -c copy -map 0 -vn -metadata artist=${artist} -metadata album=${album} -metadata genre=${g} ${tmp}`
      .quiet()
      .nothrow();
  if (pr.exitCode !== 0) {
    console.log(
      "tag FAILED:",
      fname,
      (pr.stderr as Buffer).toString().slice(0, 120),
    );
    continue;
  }
  renameSync(tmp, r.file_path);
  db.query(
    "UPDATE tracks SET artist = ?, album = ?, genre = ? WHERE video_id = ?",
  ).run(artist, album, genre, r.video_id);
  console.log(
    `tagged: ${fname} → artist ${artist}, album ${album}, genre ${genre}`,
  );
  fixed++;
}
console.log("partial-tag files fixed:", fixed);
db.close();
