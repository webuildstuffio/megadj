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

/** Defined entries of a TagPatch — set fields only (year/bpm/energy are numeric). */
type TagPair = [keyof TagPatch, string | number];
function tagPairs(patch: TagPatch): TagPair[] {
  return Object.entries(patch).filter(
    (pair): pair is TagPair => pair[1] !== undefined,
  );
}

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
  const pairs = tagPairs(patch);
  if (!pairs.length) return;

  const ext = extname(filePath).toLowerCase();
  // WAV/AIFF/M4A: mutagen edits the metadata in place. ffmpeg's wav/aiff
  // muxers DROP the ID3 chunk entirely (art + TXXX stamps vanish), and the
  // ipod (m4a) muxer has no metadata mapping for bpm/energy/remixer/mbid/
  // AI-* keys — they are silently dropped, plus every remux wipes existing
  // freeform atoms. The mutagen paths exist precisely for this.
  if (ext === ".aiff" || ext === ".aif" || ext === ".wav") {
    if (!writePatchWav(filePath, patch)) {
      throw new Error(`mutagen tag write failed for ${filePath}`);
    }
    return;
  }
  if (ext === ".m4a" || ext === ".m4b") {
    if (!writePatchMp4(filePath, patch)) {
      throw new Error(`mutagen tag write failed for ${filePath}`);
    }
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
  const tagged = tmpLike(filePath, ".tagged");
  if (ext === ".mp3") {
    args.push("-c:v", "copy", "-write_id3v2", "1", "-id3v2_version", "3");
    args.push(tagged);
  } else if (ext === ".flac") {
    // FLAC supports embedded pictures — keep base video handling.
    args.push(tagged);
  } else {
    // Unknown container — let ffmpeg infer the muxer from the extension.
    args.push(tagged);
  }

  // Bun's $ throws ShellError on non-zero exit (even .quiet()), so the
  // cleanup must be in a catch — the old exitCode check never ran, and a
  // finally would unlink the tmp on success (breaking the mv below).
  try {
    await $`ffmpeg -hide_banner -loglevel error ${args}`.quiet();
  } catch (e) {
    // Never leak the tmp file — a failed write must leave the directory
    // exactly as it was (batch runs otherwise drop one orphan `.tagged`
    // file per corrupt input).
    if (existsSync(tagged)) unlinkSync(tagged);
    throw e;
  }
  // Atomic swap via rename — a crash can never leave a half-written original.
  await $`mv -f ${tagged} ${filePath}`.quiet();
}

/**
 * Synchronous twin of writePatch's ffmpeg branch — same behavior, no
 * promise bridge. The sync API is what tools/fetch_all.ts's parallel
 * workers need (its setFileTags contract is sync); the nested `bun -e`
 * bridge it used before measured 6.4× slower than direct ffmpeg.
 * WAV/AIFF go through the mutagen paths (natively sync).
 */
export function writePatchSync(filePath: string, patch: TagPatch): boolean {
  try {
    validatePatch(patch);
    const pairs = tagPairs(patch);
    if (!pairs.length) return true;

    const ext = extname(filePath).toLowerCase();
    if (ext === ".aiff" || ext === ".aif" || ext === ".wav") {
      return writePatchWav(filePath, patch); // mutagen ID3-in-container
    }
    if (ext === ".m4a" || ext === ".m4b") {
      return writePatchMp4(filePath, patch); // mutagen MP4 atoms
    }
    const args: string[] = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
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
    const tagged = tmpLike(filePath, ".tagged");
    if (ext === ".mp3") {
      args.push("-c:v", "copy", "-write_id3v2", "1", "-id3v2_version", "3");
      args.push(tagged);
    } else if (ext === ".flac") {
      args.push(tagged);
    } else {
      // Unknown container — let ffmpeg infer from the extension.
      args.push(tagged);
    }
    const pr = Bun.spawnSync({
      cmd: ["ffmpeg", ...args],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (pr.exitCode !== 0) {
      // Never leak the tmp file — a failed write must leave the directory
      // exactly as it was (batch runs would otherwise drop one orphan
      // `.tagged` file per corrupt input).
      if (existsSync(tagged)) unlinkSync(tagged);
      return false;
    }
    renameSync(tagged, filePath);
    return true;
  } catch {
    return false;
  }
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
  aiGenre: "AI-GENRE",
  aiYear: "AI-YEAR",
  key: "TKEY",
  camelot: "CAMELOT",
  label: "TPUB",
  mixName: "TIT3",
  fingerprint: "ACOUSTID",
  mood: "MOOD",
};

/**
 * Sync tag write for ID3-in-container formats (WAV RIFF / AIFF ID3 chunk)
 * via mutagen. ffmpeg's wav/aiff muxers drop or mangle ID3 chunks, so
 * mutagen editing the chunk in place is the real path for these containers
 * (it also preserves embedded art). Sync API for the fetch-pipeline
 * workers; returns false on any failure (no throw).
 */
export function writePatchWav(filePath: string, patch: TagPatch): boolean {
  try {
    validatePatch(patch);
    const pairs = tagPairs(patch);
    if (!pairs.length) return true;
    const isAiff = /\.(aiff|aif)$/i.test(filePath);
    const WAV_ID3: Partial<Record<keyof TagPatch, string>> = {
      title: "TIT2",
      artist: "TPE1",
      album: "TALB",
      genre: "TCON",
      composer: "TCOM",
      label: "TPUB",
      mixName: "TIT3",
      key: "TKEY",
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
        if (k === "fingerprint")
          return `a.tags.add(TXXX(encoding=3, desc="ACOUSTID", text=${JSON.stringify(String(v))}))`;
        if (k === "mood")
          return `a.tags.add(TXXX(encoding=3, desc="MOOD", text=${JSON.stringify(String(v))}))`;
        if (k === "camelot")
          return `a.tags.add(TXXX(encoding=3, desc="CAMELOT", text=${JSON.stringify(String(v))}))`;
        if (k === "aiGenre")
          return `a.tags.add(TXXX(encoding=3, desc="AI-GENRE", text=${JSON.stringify(String(v))}))`;
        if (k === "aiYear")
          return `a.tags.add(TXXX(encoding=3, desc="AI-YEAR", text=${JSON.stringify(String(v))}))`;
        if (k === "remixer")
          return `a.tags.add(TXXX(encoding=3, desc="version", text=${JSON.stringify(String(v))}))`;
        if (k === "bpm") return `a.tags.add(TBPM(encoding=3, text="${v}"))`;
        if (k === "albumArtist")
          return `a.tags.add(TPE2(encoding=3, text=${JSON.stringify(String(v))}))`;
        if (k === "grouping")
          return `a.tags.add(TIT1(encoding=3, text=${JSON.stringify(String(v))}))`;
        const frame = WAV_ID3[k];
        return frame
          ? `a.tags.add(${frame}(encoding=3, text=${JSON.stringify(String(v))}))`
          : "";
      })
      .filter(Boolean)
      .join("\n");
    const open = isAiff
      ? `from mutagen.aiff import AIFF\na = AIFF(${JSON.stringify(filePath)})`
      : `from mutagen.wave import WAVE\na = WAVE(${JSON.stringify(filePath)})`;
    const script = `${open}
from mutagen.id3 import ID3, TIT2, TIT3, TPE1, TPE2, TALB, TCON, TDRC, TCOM, TIT1, TBPM, TKEY, TPUB, TXXX, COMM
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
  } catch {
    return false;
  }
}

/**
 * Sync tag write for MP4 containers (m4a) via mutagen. ffmpeg's ipod
 * muxer has NO metadata mapping for bpm/energy/remixer/mbid/AI-* keys —
 * those silently vanish, and every remux also wipes existing freeform
 * (----) atoms. Mutagen edits the atoms in place: audio untouched, art
 * survives, stamps persist. Sync API matching writePatchWav; returns
 * false on any failure (no throw).
 */
export function writePatchMp4(filePath: string, patch: TagPatch): boolean {
  try {
    validatePatch(patch);
    const pairs = tagPairs(patch);
    if (!pairs.length) return true;
    const sets = pairs
      .map(([k, v]) => {
        if (k === "title")
          return `a["\\xa9nam"] = [${JSON.stringify(String(v))}]`;
        if (k === "artist")
          return `a["\\xa9ART"] = [${JSON.stringify(String(v))}]`;
        if (k === "albumArtist")
          return `a["aART"] = [${JSON.stringify(String(v))}]`;
        if (k === "album")
          return `a["\\xa9alb"] = [${JSON.stringify(String(v))}]`;
        if (k === "genre")
          return `a["\\xa9gen"] = [${JSON.stringify(String(v))}]`;
        if (k === "year")
          return `a["\\xa9day"] = [${JSON.stringify(String(v))}]`;
        if (k === "composer")
          return `a["\\xa9wrt"] = [${JSON.stringify(String(v))}]`;
        if (k === "grouping")
          return `a["\\xa9grp"] = [${JSON.stringify(String(v))}]`;
        if (k === "comment")
          return `a["\\xa9cmt"] = [${JSON.stringify(String(v))}]`;
        if (k === "bpm") return `a["tmpo"] = [${Math.round(Number(v))}]`;
        if (k === "remixer")
          return `a["----:com.apple.iTunes:REMIXER"] = [MP4FreeForm(${JSON.stringify(String(v))}.encode("utf-8"), 3)]`;
        if (k === "mbid")
          return `a["----:com.apple.iTunes:MusicBrainz Track Id"] = [MP4FreeForm(${JSON.stringify(String(v))}.encode("utf-8"), 3)]`;
        if (k === "energy")
          return `a["----:com.apple.iTunes:ENERGY"] = [MP4FreeForm(${JSON.stringify(String(v))}.encode("utf-8"), 3)]`;
        if (k === "fingerprint")
          return `a["----:com.apple.iTunes:ACOUSTID"] = [MP4FreeForm(${JSON.stringify(String(v))}.encode("utf-8"), 3)]`;
        if (k === "mood")
          return `a["----:com.apple.iTunes:MOOD"] = [MP4FreeForm(${JSON.stringify(String(v))}.encode("utf-8"), 3)]`;
        if (k === "key")
          return `a["----:com.apple.iTunes:initialkey"] = [MP4FreeForm(${JSON.stringify(String(v))}.encode("utf-8"), 3)]`;
        if (k === "camelot")
          return `a["----:com.apple.iTunes:CAMELOT"] = [MP4FreeForm(${JSON.stringify(String(v))}.encode("utf-8"), 3)]`;
        if (k === "label")
          return `a["----:com.apple.iTunes:LABEL"] = [MP4FreeForm(${JSON.stringify(String(v))}.encode("utf-8"), 3)]`;
        if (k === "mixName")
          return `a["----:com.apple.iTunes:MIXNAME"] = [MP4FreeForm(${JSON.stringify(String(v))}.encode("utf-8"), 3)]`;
        if (k === "aiGenre")
          return `a["----:com.apple.iTunes:AI-GENRE"] = [MP4FreeForm(${JSON.stringify(String(v))}.encode("utf-8"), 3)]`;
        if (k === "aiYear")
          return `a["----:com.apple.iTunes:AI-YEAR"] = [MP4FreeForm(${JSON.stringify(String(v))}.encode("utf-8"), 3)]`;
        return "";
      })
      .filter(Boolean)
      .join("\n");
    const script = `from mutagen.mp4 import MP4, MP4FreeForm
a = MP4(${JSON.stringify(filePath)})
if a.tags is None: a.add_tags()
${sets}
a.save()
print("ok")`;
    const pr = Bun.spawnSync({
      cmd: ["uv", "run", "--with", "mutagen", "python", "-c", script],
      stdout: "pipe",
    });
    return new TextDecoder().decode(pr.stdout).trim() === "ok";
  } catch {
    return false;
  }
}

/**
 * Embed a JPEG as the front cover (type-3 APIC / attached_pic).
 * WAV → mutagen APIC; everything else → ffmpeg remux. Atomic.
 */
export function embedArt(p: string, bytes: Uint8Array): boolean {
  const dump = p + ".fa.jpg";
  writeFileSync(dump, bytes);
  try {
    // WAV and AIFF: mutagen edits the ID3 chunk in place. ffmpeg's remux
    // (below) drops/rebuilds those containers' ID3 chunks — a re-embed
    // would wipe TXXX stamps (energy etc.) written by the tag pass.
    if (p.toLowerCase().endsWith(".wav") || /\.(aiff?|aif)$/i.test(p)) {
      const open = /\.(aiff?|aif)$/i.test(p)
        ? `from mutagen.aiff import AIFF\na = AIFF(${JSON.stringify(p)})`
        : `from mutagen.wave import WAVE\na = WAVE(${JSON.stringify(p)})`;
      const script = `${open}
from mutagen.id3 import ID3, APIC
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
