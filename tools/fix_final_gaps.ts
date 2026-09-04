/** one-off: fix final 3 file-tag gaps (Snoop artist, Anyway dupe, Dean Turnley) */
import { Database } from "bun:sqlite";
import { existsSync, renameSync, unlinkSync } from "node:fs";

const home = process.env.HOME!;
const db = new Database(`${home}/.local/state/megadj/archive.db`);

// 1. Anyway (1) mp3: real row is ext-6e14c6401883 → point it at the (1) file? No:
//    the (1) is a Safari dupe of the same song. The non-(1) file is gone; adopt (1).
const anyway = "~/Music/DJ-Imports/Anyway (Extended Mix) (1).mp3";
if (existsSync(anyway)) {
  db.query("UPDATE tracks SET file_path=? WHERE video_id='ext-6e14c6401883'").run(anyway);
  const tmp = anyway + ".f";
  const pr = Bun.spawnSync({
    cmd: ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", anyway, "-map", "0", "-c", "copy",
      "-metadata", "title=Anyway (Extended Mix)", "-metadata", "artist=Jus Ron x ABNSTH",
      "-metadata", "album=Jus Ron x ABNSTH — Singles", "-metadata", "genre=Edits / Bootlegs", tmp],
    stdout: "pipe",
  });
  if (pr.exitCode === 0) { unlinkSync(anyway); renameSync(tmp, anyway); console.log("✓ Anyway (1) adopted + tagged"); }
  else { if (existsSync(tmp)) unlinkSync(tmp); console.log("✗ Anyway tag failed"); }
}

// 2. Dean Turnley (1).wav: DB row already has full tags; the (1) filename was adopted.
const dt = "~/Music/DJ-Imports/Dean Turnley - Actin' Tough (Smoakland Remix) [MASTER] 3.23 (1).wav";
if (existsSync(dt)) {
  db.query("UPDATE tracks SET file_path=? WHERE title LIKE \"Actin' Tough (Smoakland Remix)%\" AND file_path LIKE '%Dean Turnley%' AND file_path NOT LIKE '%(1)%'").run(dt);
  const s = `
from mutagen.wave import WAVE
from mutagen.id3 import ID3, TIT2, TPE1, TALB, TCON
a = WAVE(${JSON.stringify(dt)})
if not a.tags: a.add_tags()
if not isinstance(a.tags, ID3): a.tags = ID3()
a.tags.add(TIT2(encoding=3, text="Actin' Tough (Smoakland Remix)"))
a.tags.add(TPE1(encoding=3, text="Dean Turnley"))
a.tags.add(TALB(encoding=3, text="Dean Turnley remixes"))
a.tags.add(TCON(encoding=3, text="Dubstep"))
a.save()
print("ok")`;
  const pr = Bun.spawnSync({ cmd: ["uv", "run", "--with", "mutagen", "python", "-c", s], stdout: "pipe" });
  console.log(`${new TextDecoder().decode(pr.stdout).trim() === "ok" ? "✓" : "✗"} Dean Turnley tagged`);
}

// 3. SNOOP mp3: artist tag is in DB but file lost it in an ffmpeg pass
const snoop = "~/Music/DJ-Imports/MASTER SNOOP G SAM PROGRESSIVE AFRO HOUSE 124 PUNCHY MIX UP DROP .mp3";
if (existsSync(snoop)) {
  const tmp = snoop + ".s";
  const pr = Bun.spawnSync({
    cmd: ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", snoop, "-map", "0", "-c", "copy",
      "-metadata", "artist=Snoop G Sam", tmp],
    stdout: "pipe",
  });
  if (pr.exitCode === 0) { unlinkSync(snoop); renameSync(tmp, snoop); console.log("✓ Snoop artist tag"); }
  else { if (existsSync(tmp)) unlinkSync(tmp); console.log("✗ Snoop tag failed"); }
}
db.close();
