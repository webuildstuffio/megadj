/**
 * FullTags writer — ONE surface for writing tags into mp3/m4a/flac/wav/aiff.
 *
 * Format gotchas consolidated here (each one was learned the hard way):
 *  - ffmpeg's AIFF muxer DROPS the ID3 chunk → AIFF writes go through
 *    mutagen, editing the ID3 chunk in place (artwork survives).
 *  - ffmpeg's WAV muxer canNOT carry attached_pic → WAV art via mutagen APIC.
 *    (rekordbox ignores art in WAVs entirely — convert to AIFF instead,
 *    see convert/wav-to-aiff.ts. WAV tag writes are still supported.)
 *  - mp3 needs id3v2.3 for widest hardware compatibility.
 *  - m4a uses the ipod muxer; covers re-encode to mjpeg + attached_pic.
 *  - Every write is atomic: tmp file → rename, a crash never truncates.
 *
 * Audio is always stream-copied (`-c:a copy`) — never re-encoded.
 */
import { $ } from "bun";
import { extname } from "node:path";
import { existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import type { EnrichedMetadata, TagPatch } from "./schema";
import { validatePatch } from "./schema-guards";

/** Keep the extension on ffmpeg tmp outputs — the muxer is inferred from
 * the filename, so `.fa` (extensionless) fails with "Unable to choose an
 * output format". Pattern: `track.m4a` → `track.m4a.fa.m4a`. */
function tmpLike(p: string, suffix: string): string {
  return `${p}${suffix}${extname(p).toLowerCase()}`;
}

export const AUDIO_EXTS = new Set([
  ".m4a",
  ".mp3",
  ".wav",
  ".flac",
  ".aiff",
  ".aif",
]);

export function isAudioFile(p: string): boolean {
  return AUDIO_EXTS.has(extname(p).toLowerCase());
}

export function isLossless(p: string): boolean {
  return [".wav", ".flac", ".aiff", ".aif"].includes(extname(p).toLowerCase());
}

/**
 * Write a legacy EnrichedMetadata (full-record replace semantics).
 * Thin wrapper kept for megadj ingest/sync compat.
 */
export async function applyTags(
  filePath: string,
  meta: EnrichedMetadata,
): Promise<void> {
  const patch: TagPatch = {
    title: meta.title ?? undefined,
    artist: meta.artist ?? undefined,
    albumArtist: meta.albumArtist ?? undefined,
    album: meta.album ?? undefined,
    genre: meta.genre ?? undefined,
    year: meta.date
      ? Number(meta.date.match(/\d{4}/)?.[0]) || undefined
      : undefined,
    composer: meta.composer ?? undefined,
    grouping: meta.grouping ?? undefined,
    remixer: meta.remixer ?? undefined,
    comment: meta.comment ?? undefined,
    mbid: meta.mbid ?? undefined,
  };
  await writePatch(filePath, patch);
}

/**
 * Merge a partial TagPatch into the file's tags. Only the provided fields
 * are written; audio stream-copied; art preserved; atomic swap at the end.
 */
export async function writePatch(
  filePath: string,
  patch: TagPatch,
): Promise<void> {
  validatePatch(patch);
  const pairs = Object.entries(patch).filter(([, v]) => v !== undefined) as [
    keyof TagPatch,
    string | number,
  ][];
  if (!pairs.length) return;

  const ext = extname(filePath).toLowerCase();
  if (ext === ".aiff" || ext === ".aif") {
    await writePatchAiff(filePath, pairs);
    return;
  }

  const args: string[] = [
    "-y",
    "-i",
    filePath,
    "-map",
    "0:a",
    "-map",
    "0:v?",
    "-c:a",
    "copy",
    "-c:v",
    "mjpeg",
    "-disposition:v:0",
    "attached_pic",
  ];
  for (const [k, v] of pairs) args.push("-metadata", `${FFMPEG_KEY[k]}=${v}`);
  const tagged = filePath.replace(/(\.[^.]+)$/, ".tagged$1");
  if (ext === ".mp3") {
    args.push("-c:v", "copy", "-write_id3v2", "1", "-id3v2_version", "3");
    args.push(tagged);
  } else if (ext === ".flac") {
    // FLAC supports embedded pictures — keep base video handling.
    args.push(tagged);
  } else if (ext === ".wav") {
    // WAV muxer rejects video streams — drop any attached pic. ffmpeg writes
    // RIFF INFO (players largely ignore it); mutagen path covers real ID3.
    args.push("-vn", "-f", "wav", tagged);
  } else {
    args.push("-f", "ipod", tagged);
  }

  const proc = await $`ffmpeg -hide_banner -loglevel error ${args}`.quiet();
  if (proc.exitCode !== 0) {
    throw new Error(`ffmpeg tag write failed for ${filePath}`);
  }
  // Atomic swap via rename — a crash can never leave a half-written original.
  await $`mv -f ${tagged} ${filePath}`.quiet();
}

const FFMPEG_KEY: Record<keyof TagPatch, string> = {
  title: "title",
  artist: "artist",
  albumArtist: "album_artist",
  album: "album",
  genre: "genre",
  year: "date",
  composer: "composer",
  grouping: "grouping",
  remixer: "version",
  comment: "comment",
  mbid: "musicbrainz_trackid",
  bpm: "TBPM",
  energy: "ENERGY",
};

/**
 * AIFF: mutagen in-place ID3 chunk edit (ffmpeg would drop the chunk).
 * Frame map: title→TIT2 artist→TPE1 albumArtist→TPE2 album→TALB genre→TCON
 * date→TDRC composer→TCOM grouping→TIT1 remixer→TXXX:version bpm→TBPM
 * energy→TXXX:ENERGY comment→COMM mbid→TXXX:MusicBrainz Track Id
 */
async function writePatchAiff(
  filePath: string,
  pairs: [keyof TagPatch, string | number][],
): Promise<void> {
  const frames: string[] = [];
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const set = (frame: string, value: string) =>
    frames.push(`t = ${frame}(encoding=3, text=["${esc(value)}"]); id3.add(t)`);
  const txxx = (desc: string, value: string) =>
    frames.push(
      `t = TXXX(encoding=3, desc="${desc}", text=["${esc(value)}"]); id3.add(t)`,
    );
  for (const [k, v] of pairs) {
    const s = String(v);
    switch (k) {
      case "title":
        set("TIT2", s);
        break;
      case "artist":
        set("TPE1", s);
        break;
      case "albumArtist":
        set("TPE2", s);
        break;
      case "album":
        set("TALB", s);
        break;
      case "genre":
        set("TCON", s);
        break;
      case "year":
        set("TDRC", s);
        break;
      case "composer":
        set("TCOM", s);
        break;
      case "grouping":
        set("TIT1", s);
        break;
      case "remixer":
        txxx("version", s);
        break;
      case "bpm":
        set("TBPM", s);
        break;
      case "energy":
        txxx("ENERGY", s);
        break;
      case "comment":
        frames.push(
          `t = COMM(encoding=3, lang="eng", desc="", text=["${esc(s)}"]); id3.add(t)`,
        );
        break;
      case "mbid":
        txxx("MusicBrainz Track Id", s);
        break;
    }
  }
  const script = `
from mutagen.aiff import AIFF
from mutagen.id3 import ID3, TIT2, TPE1, TPE2, TALB, TCON, TDRC, TCOM, TIT1, TBPM, TXXX, COMM
a = AIFF(${JSON.stringify(filePath)})
if a.tags is None:
    a.add_tags()
id3 = a.tags
${frames.join("\n")}
a.save()
print("ok")`;
  const proc = await $`uv run --with mutagen python -c ${script}`
    .quiet()
    .nothrow();
  if (proc.exitCode !== 0 || !proc.stdout.toString().trim().includes("ok")) {
    throw new Error(
      `mutagen AIFF tag write failed for ${filePath}: ${proc.stderr.toString().slice(0, 200)}`,
    );
  }
}

/**
 * WAV tag write via mutagen (ID3 chunk inside the RIFF). ffmpeg's wav muxer
 * accepts arbitrary -metadata but players ignore it — mutagen is the real
 * path for WAV.
 */
export function writePatchWav(filePath: string, patch: TagPatch): boolean {
  validatePatch(patch);
  const pairs = Object.entries(patch).filter(([, v]) => v !== undefined) as [
    keyof TagPatch,
    string | number,
  ][];
  if (!pairs.length) return true;
  const WAV_ID3: Partial<Record<keyof TagPatch, string>> = {
    title: "TIT2",
    artist: "TPE1",
    album: "TALB",
    genre: "TCON",
    composer: "TCOM",
  };
  const sets = pairs
    .map(([k, v]) => {
      if (k === "year") return `a.tags.add(TDRC(encoding=3, text="${v}"))`;
      if (k === "comment")
        return `a.tags.add(COMM(encoding=3, lang="eng", desc="", text=${JSON.stringify(String(v))}))`;
      if (k === "mbid")
        return `a.tags.add(TXXX(encoding=3, desc="MusicBrainz Track Id", text=${JSON.stringify(String(v))}))`;
      if (k === "energy")
        return `a.tags.add(TXXX(encoding=3, desc="ENERGY", text=${JSON.stringify(String(v))}))`;
      if (k === "remixer")
        return `a.tags.add(TXXX(encoding=3, desc="version", text=${JSON.stringify(String(v))}))`;
      if (k === "bpm") return `a.tags.add(TBPM(encoding=3, text="${v}"))`;
      const frame = WAV_ID3[k];
      return frame
        ? `a.tags.add(${frame}(encoding=3, text=${JSON.stringify(String(v))}))`
        : "";
    })
    .filter(Boolean)
    .join("\n");
  const script = `from mutagen.wave import WAVE
from mutagen.id3 import ID3, TIT2, TPE1, TALB, TCON, TDRC, TCOM, TBPM, TXXX, COMM
a = WAVE(${JSON.stringify(filePath)})
if not a.tags: a.add_tags()
if not isinstance(a.tags, ID3): a.tags = ID3()
${sets}
a.save()
print("ok")`;
  const pr = Bun.spawnSync({
    cmd: ["uv", "run", "--with", "mutagen", "python", "-c", script],
    stdout: "pipe",
  });
  return new TextDecoder().decode(pr.stdout).trim() === "ok";
}

/**
 * Embed a JPEG as the front cover (type-3 APIC / attached_pic).
 * WAV → mutagen APIC; everything else → ffmpeg remux. Atomic.
 */
export function embedArt(p: string, bytes: Uint8Array): boolean {
  const dump = p + ".fa.jpg";
  writeFileSync(dump, bytes);
  try {
    if (p.toLowerCase().endsWith(".wav")) {
      const script = `from mutagen.wave import WAVE
from mutagen.id3 import ID3, APIC
a = WAVE(${JSON.stringify(p)})
if a.tags and any(k.startswith("APIC") for k in a.tags.keys()):
    a.tags.delall("APIC")
try:
    a.add_tags()
except Exception:
    pass
if not isinstance(a.tags, ID3):
    a.tags = ID3()
a.tags.add(APIC(encoding=3, mime="image/jpeg", type=3, desc="Cover", data=open(${JSON.stringify(dump)}, "rb").read()))
a.save()
print("ok")`;
      const pr = Bun.spawnSync({
        cmd: ["uv", "run", "--with", "mutagen", "python", "-c", script],
        stdout: "pipe",
      });
      return new TextDecoder().decode(pr.stdout).trim() === "ok";
    }
    const tmp = tmpLike(p, ".fa");
    const pr = Bun.spawnSync({
      cmd: [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        p,
        "-i",
        dump,
        "-map",
        "0:a",
        "-map",
        "1:v",
        "-c:a",
        "copy",
        "-c:v",
        "mjpeg",
        "-disposition:v:0",
        "attached_pic",
        tmp,
      ],
      stdout: "pipe",
    });
    const ok = pr.exitCode === 0;
    if (ok) renameSync(tmp, p);
    else if (existsSync(tmp)) unlinkSync(tmp);
    return ok;
  } finally {
    unlinkSync(dump);
  }
}
