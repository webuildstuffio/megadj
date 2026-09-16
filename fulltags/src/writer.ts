/**
 * FullTags writer — ONE surface for writing tags into mp3/m4a/flac/wav/aiff.
 *
 * Split per concern (#90 diet): the mutagen half (atomic machinery +
 * ID3-in-container/MP4 statement builders) lives in writer-mutagen.ts;
 * THIS file owns the ffmpeg remux half and the public write API.
 *
 * Remaining format gotchas owned here:
 *  - mp3 needs id3v2.3 for widest hardware compatibility.
 *  - m4a uses the ipod muxer; covers re-encode to mjpeg + attached_pic.
 *  - Audio is always stream-copied (`-c:a copy`) — never re-encoded.
 *  - Every write is atomic: tmp file → rename, a crash never truncates.
 */
import { $ } from "bun";
import { extname } from "node:path";
import { existsSync, renameSync, unlinkSync } from "node:fs";
import { walkAudioDir } from "../../src/shared/audio-walk";
import type { EnrichedMetadata, TagPatch } from "./schema";
import { validatePatch } from "./schema-guards";
import { id3Open } from "./mutagen";
import {
  atomicMutagenWrite,
  atomicOps,
  type TagPair,
  type WriterAtomicOps,
  mp4Statement,
  mp4VerifyStatement,
  mutagenPatchFrame,
  tagPairs,
  tmpLike,
  uniqueTempLike,
  unlinkIfPresent,
  wavId3Statement,
  wavVerifyStatement,
} from "./writer-mutagen";

export type { WriterAtomicOps } from "./writer-mutagen";

// AUDIO_EXTS/isAudioFile delegate to the megadj SSOT (issue #69/#142):
// the package previously shipped its own six-format set, so ogg/opus and
// aac/alac were invisible to every package-side pass.
export { AUDIO_EXTS } from "../../src/shared/audio-exts";
export { isAudioFile } from "../../src/shared/audio-exts";

/** Recursively list audio files under `dir`, skipping hidden entries.
 * One shared walker for every "collect the archive" pass — fetch/audit,
 * fetch-lib's ground-truth set, adopt's intake — so skip rules and the
 * extension filter can never drift apart again. A missing/unreadable dir
 * returns [] (soft-fail: callers treat an absent music dir as empty, a
 * typoed path must not crash the pass). Sync on purpose: callers are
 * short CLI passes; for server/event-loop contexts use cratedeck's
 * async walkTree instead. */
export function walkAudioFiles(dir: string, out: string[] = []): string[] {
  return walkAudioDir(dir, out);
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
 * Shared ffmpeg arg plan for the copy-audio + preserve-art tag remux —
 * the async ($ shell) and sync (spawnSync) writePatch branches are the
 * same plan modulo the banner flags. mp3 gets id3v2.3 + copied art; the
 * tmp output KEEPS its extension (ffmpeg infers the muxer from it).
 */
function ffmpegTagPlan(
  filePath: string,
  pairs: TagPair[],
  sync = false,
): { args: string[]; tagged: string } {
  const args = sync
    ? ["-y", "-hide_banner", "-loglevel", "error", "-i", filePath]
    : ["-y", "-i", filePath];
  args.push(
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
  );
  for (const [k, v] of pairs)
    args.push("-metadata", `${FFMPEG_KEY[k]}=${String(v)}`);
  const tagged = tmpLike(filePath, ".tagged");
  if (extname(filePath).toLowerCase() === ".mp3") {
    // One -c:v decision, not two: the base plan sets mjpeg and this used to
    // append a second `-c:v copy`, which ffmpeg resolves as LAST-WINS —
    // copying whatever codec the embedded art already is (png/webp) into
    // the ID3 APIC path and intermittently failing the mp3 muxer with
    // "Invalid audio stream" (exit 234, Sep 11 intake crash). Re-encode to
    // mjpeg always: ID3v2.3 APIC wants JPEG.
    args.push("-write_id3v2", "1", "-id3v2_version", "3");
  }
  // FLAC keeps base video handling; unknown containers let ffmpeg infer
  // the muxer from the tmp extension.
  args.push(tagged);
  return { args, tagged };
}

/**
 * Merge a partial TagPatch into the file's tags. Only the provided fields
 * are written; audio stream-copied; art preserved; atomic swap at the end.
 */

/** Mutagen-container dispatch (the twin-leg seam): WAV/AIFF → the ID3-in-
 * container path, m4a/m4b → MP4 atoms, everything else → null (the caller's
 * ffmpeg branch owns those). */
function mutagenDispatch(
  filePath: string,
  patch: TagPatch,
  ops?: Partial<WriterAtomicOps>,
): boolean | null {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".aiff" || ext === ".aif" || ext === ".wav") {
    return writePatchWav(filePath, patch, ops);
  }
  if (ext === ".m4a" || ext === ".m4b") {
    return writePatchMp4(filePath, patch, ops);
  }
  return null;
}

export async function writePatch(
  filePath: string,
  patch: TagPatch,
  ops?: Partial<WriterAtomicOps>,
): Promise<void> {
  validatePatch(patch);
  const pairs = tagPairs(patch);
  if (!pairs.length) return;

  // WAV/AIFF/M4A: mutagen edits the metadata in place. ffmpeg's wav/aiff
  // muxers DROP the ID3 chunk entirely (art + TXXX stamps vanish), and the
  // ipod (m4a) muxer has no metadata mapping for bpm/energy/remixer/mbid/
  // AI-* keys — they are silently dropped, plus every remux wipes existing
  // freeform atoms. The mutagen paths exist precisely for this.
  const handled = mutagenDispatch(filePath, patch, ops);
  if (handled !== null) {
    if (!handled) throw new Error(`mutagen tag write failed for ${filePath}`);
    return;
  }

  const { args, tagged } = ffmpegTagPlan(filePath, pairs);

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
 * promise bridge. The sync API is what `megadj fetch`'s parallel
 * workers need (its setFileTags contract is sync); the nested `bun -e`
 * bridge it used before measured 6.4× slower than direct ffmpeg.
 * WAV/AIFF go through the mutagen paths (natively sync).
 */
export function writePatchSync(
  filePath: string,
  patch: TagPatch,
  ops?: Partial<WriterAtomicOps>,
): boolean {
  try {
    validatePatch(patch);
    const pairs = tagPairs(patch);
    if (!pairs.length) return true;

    const handled = mutagenDispatch(filePath, patch, ops);
    if (handled !== null) return handled;

    const { args, tagged } = ffmpegTagPlan(filePath, pairs, true);
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
  isrc: "TSRC",
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
  beatport: "BP-FIELDS",
};

/**
 * Sync tag write for ID3-in-container formats (WAV RIFF / AIFF ID3 chunk)
 * via mutagen. ffmpeg's wav/aiff muxers drop or mangle ID3 chunks, so
 * mutagen editing the chunk in place is the real path for these containers
 * (it also preserves embedded art). Sync API for the fetch-pipeline
 * workers; returns false on any failure (no throw).
 */
function writePatchWav(
  filePath: string,
  patch: TagPatch,
  ops?: Partial<WriterAtomicOps>,
): boolean {
  return mutagenPatchFrame(
    filePath,
    patch,
    {
      sets: (pairs) =>
        pairs
          .map(([k, v]) => wavId3Statement(k, v))
          .filter(Boolean)
          .join("\n"),
      verifies: (pairs) =>
        pairs.map(([k, v]) => wavVerifyStatement(k, v)).join("\n"),
      script: (tempPath, sets, verifies) => `${id3Open(tempPath)}
from mutagen.id3 import ID3, TIT2, TIT3, TPE1, TPE2, TALB, TCON, TDRC, TCOM, TIT1, TBPM, TKEY, TPUB, TXXX, TSRC, COMM
if a.tags is None: a.add_tags()
if not isinstance(a.tags, ID3): a.tags = ID3()
${sets}
a.save()
${id3Open(tempPath)}
${verifies}
print("ok")`,
    },
    ops,
  );
}

/**
 * Sync tag write for MP4 containers (m4a) via mutagen. ffmpeg's ipod
 * muxer has NO metadata mapping for bpm/energy/remixer/mbid/AI-* keys —
 * those silently vanish, and every remux also wipes existing freeform
 * (----) atoms. Mutagen edits the atoms in place: audio untouched, art
 * survives, stamps persist. Sync API matching writePatchWav; returns
 * false on any failure (no throw).
 */
function writePatchMp4(
  filePath: string,
  patch: TagPatch,
  ops?: Partial<WriterAtomicOps>,
): boolean {
  return mutagenPatchFrame(
    filePath,
    patch,
    {
      sets: (pairs) =>
        pairs
          .map(([k, v]) => mp4Statement(k, v))
          .filter(Boolean)
          .join("\n"),
      verifies: (pairs) =>
        pairs.map(([k, v]) => mp4VerifyStatement(k, v)).join("\n"),
      script: (
        tempPath,
        sets,
        verifies,
      ) => `from mutagen.mp4 import MP4, MP4FreeForm
a = MP4(${JSON.stringify(tempPath)})
if a.tags is None: a.add_tags()
${sets}
a.save()
a = MP4(${JSON.stringify(tempPath)})
${verifies}
print("ok")`,
    },
    ops,
  );
}

/**
 * Embed a JPEG as the front cover (type-3 APIC / attached_pic).
 * WAV → mutagen APIC; everything else → ffmpeg remux. Atomic.
 */
export function embedArt(
  p: string,
  bytes: Uint8Array,
  overrides?: Partial<WriterAtomicOps>,
): boolean {
  const ops = atomicOps(overrides);
  const dump = uniqueTempLike(p, "art", ".jpg");
  let remuxTemp: string | null = null;
  try {
    ops.writeFile(dump, bytes);
    // WAV and AIFF: mutagen edits the ID3 chunk in place. ffmpeg's remux
    // (below) drops/rebuilds those containers' ID3 chunks — a re-embed
    // would wipe TXXX stamps (energy etc.) written by the tag pass.
    if (p.toLowerCase().endsWith(".wav") || /\.(aiff?|aif)$/i.test(p)) {
      return atomicMutagenWrite(
        p,
        (tempPath) => `${id3Open(tempPath)}
from mutagen.id3 import ID3, APIC
if a.tags is None: a.add_tags()
if a.tags and any(k.startswith("APIC") for k in a.tags.keys()):
    a.tags.delall("APIC")
if not isinstance(a.tags, ID3):
    a.tags = ID3()
a.tags.add(APIC(encoding=3, mime="image/jpeg", type=3, desc="Cover", data=open(${JSON.stringify(dump)}, "rb").read()))
a.save()
${id3Open(tempPath)}
expected_art = open(${JSON.stringify(dump)}, "rb").read()
if not any(bytes(frame.data) == expected_art for frame in a.tags.getall("APIC")):
    raise RuntimeError("art readback failed")
print("ok")`,
        overrides,
      );
    }
    remuxTemp = uniqueTempLike(p, "art-media");
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
        remuxTemp,
      ],
      stdout: "pipe",
    });
    const ok = pr.exitCode === 0;
    if (ok) {
      ops.fsyncFile(remuxTemp);
      ops.rename(remuxTemp, p);
    }
    return ok;
  } catch {
    return false;
  } finally {
    unlinkIfPresent(dump);
    if (remuxTemp !== null) unlinkIfPresent(remuxTemp);
  }
}
