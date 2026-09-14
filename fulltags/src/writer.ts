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
import { randomUUID } from "node:crypto";
import { basename, dirname, extname, join } from "node:path";
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { Dirent } from "node:fs";
import type { EnrichedMetadata, TagPatch } from "./schema";
import { validatePatch } from "./schema-guards";
import { id3Open, mutagenOk } from "./mutagen";

export interface WriterAtomicOps {
  copyFile(from: string, to: string): void;
  writeFile(path: string, data: Uint8Array): void;
  rename(from: string, to: string): void;
  mutagenOk(script: string): boolean;
  fsyncFile(path: string): void;
}

function fsyncFile(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

const DEFAULT_ATOMIC_OPS: WriterAtomicOps = {
  copyFile: copyFileSync,
  writeFile: writeFileSync,
  rename: renameSync,
  mutagenOk,
  fsyncFile,
};

function atomicOps(overrides?: Partial<WriterAtomicOps>): WriterAtomicOps {
  return { ...DEFAULT_ATOMIC_OPS, ...overrides };
}

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

/** A unique same-directory lease whose final suffix remains the media type,
 * so mutagen/ffmpeg infer the same container as the source. */
function uniqueTempLike(p: string, purpose: string, extension = extname(p)) {
  const ext = extension.toLowerCase();
  const stem = basename(p, extname(p));
  return join(dirname(p), `.${stem}.fulltags-${purpose}-${randomUUID()}${ext}`);
}

function unlinkIfPresent(path: string): void {
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch (error) {
    console.error(`fulltags temp cleanup failed for ${path}`, error);
  }
}

function hasValidContainerHeader(path: string): boolean {
  const ext = extname(path).toLowerCase();
  const header = Buffer.alloc(12);
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    if (readSync(fd, header, 0, header.length, 0) < header.length) return false;
  } catch (error) {
    void error;
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }
  const fourcc = (at: number): string => header.toString("ascii", at, at + 4);
  if (ext === ".wav")
    return ["RIFF", "RF64"].includes(fourcc(0)) && fourcc(8) === "WAVE";
  if (ext === ".aiff" || ext === ".aif")
    return fourcc(0) === "FORM" && ["AIFF", "AIFC"].includes(fourcc(8));
  if (ext === ".m4a" || ext === ".m4b") return fourcc(4) === "ftyp";
  return false;
}

function atomicMutagenWrite(
  filePath: string,
  scriptFor: (tempPath: string) => string,
  overrides?: Partial<WriterAtomicOps>,
): boolean {
  const ops = atomicOps(overrides);
  const temp = uniqueTempLike(filePath, "media");
  try {
    ops.copyFile(filePath, temp);
    if (!ops.mutagenOk(scriptFor(temp))) return false;
    if (!hasValidContainerHeader(temp)) return false;
    ops.fsyncFile(temp);
    ops.rename(temp, filePath);
    return true;
  } catch (error) {
    void error;
    return false;
  } finally {
    unlinkIfPresent(temp);
  }
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

/** Recursively list audio files under `dir`, skipping hidden entries.
 * One shared walker for every "collect the archive" pass — fetch/audit,
 * fetch-lib's ground-truth set, adopt's intake — so skip rules and the
 * extension filter can never drift apart again. A missing/unreadable dir
 * returns [] (soft-fail: callers treat an absent music dir as empty, a
 * typoed path must not crash the pass). Sync on purpose: callers are
 * short CLI passes; for server/event-loop contexts use cratedeck's
 * async walkTree instead. */
export function walkAudioFiles(dir: string, out: string[] = []): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) walkAudioFiles(full, out);
    else if (ent.isFile() && isAudioFile(ent.name)) out.push(full);
  }
  return out;
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
  const ext = extname(filePath).toLowerCase();
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
  if (ext === ".mp3") {
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
export async function writePatch(
  filePath: string,
  patch: TagPatch,
  ops?: Partial<WriterAtomicOps>,
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
    if (!writePatchWav(filePath, patch, ops)) {
      throw new Error(`mutagen tag write failed for ${filePath}`);
    }
    return;
  }
  if (ext === ".m4a" || ext === ".m4b") {
    if (!writePatchMp4(filePath, patch, ops)) {
      throw new Error(`mutagen tag write failed for ${filePath}`);
    }
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
 * promise bridge. The sync API is what tools/fetch-all.ts's parallel
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

    const ext = extname(filePath).toLowerCase();
    if (ext === ".aiff" || ext === ".aif" || ext === ".wav") {
      return writePatchWav(filePath, patch, ops); // mutagen ID3-in-container
    }
    if (ext === ".m4a" || ext === ".m4b") {
      return writePatchMp4(filePath, patch, ops); // mutagen MP4 atoms
    }
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

/** One ID3 frame per known key (WAV/AIFF path). Unknown keys are skipped
 *  (empty statement) — the filter drops them. */
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

const WAV_ID3_READ: Record<keyof TagPatch, string> = {
  title: "TIT2",
  artist: "TPE1",
  albumArtist: "TPE2",
  album: "TALB",
  genre: "TCON",
  year: "TDRC",
  composer: "TCOM",
  grouping: "TIT1",
  remixer: "TXXX:version",
  comment: "COMM::eng",
  mbid: "TXXX:MusicBrainz Track Id",
  isrc: "TSRC",
  bpm: "TBPM",
  energy: "TXXX:ENERGY",
  aiGenre: "TXXX:AI-GENRE",
  aiYear: "TXXX:AI-YEAR",
  key: "TKEY",
  camelot: "TXXX:CAMELOT",
  label: "TPUB",
  mixName: "TIT3",
  fingerprint: "TXXX:ACOUSTID",
  mood: "TXXX:MOOD",
  beatport: "TXXX:BP-FIELDS",
};

function wavId3Statement(k: keyof TagPatch, v: unknown): string {
  const t = JSON.stringify(String(v));
  switch (k) {
    case "year":
      return `a.tags.add(TDRC(encoding=3, text="${String(v)}"))`;
    case "bpm":
      return `a.tags.add(TBPM(encoding=3, text="${String(v)}"))`;
    case "comment":
      return `a.tags.add(COMM(encoding=3, lang="eng", desc="", text=${t}))`;
    case "mbid":
      return `a.tags.add(TXXX(encoding=3, desc="MusicBrainz Track Id", text=${t}))`;
    case "isrc":
      return `a.tags.add(TSRC(encoding=3, text=${t}))`;
    case "energy":
      return `a.tags.add(TXXX(encoding=3, desc="ENERGY", text=${t}))`;
    case "fingerprint":
      return `a.tags.add(TXXX(encoding=3, desc="ACOUSTID", text=${t}))`;
    case "mood":
      return `a.tags.add(TXXX(encoding=3, desc="MOOD", text=${t}))`;
    case "beatport":
      return `a.tags.add(TXXX(encoding=3, desc="BP-FIELDS", text=${t}))`;
    case "camelot":
      return `a.tags.add(TXXX(encoding=3, desc="CAMELOT", text=${t}))`;
    case "aiGenre":
      return `a.tags.add(TXXX(encoding=3, desc="AI-GENRE", text=${t}))`;
    case "aiYear":
      return `a.tags.add(TXXX(encoding=3, desc="AI-YEAR", text=${t}))`;
    case "remixer":
      return `a.tags.add(TXXX(encoding=3, desc="version", text=${t}))`;
    case "albumArtist":
      return `a.tags.add(TPE2(encoding=3, text=${t}))`;
    case "grouping":
      return `a.tags.add(TIT1(encoding=3, text=${t}))`;
  }
  const frame = WAV_ID3[k];
  return frame ? `a.tags.add(${frame}(encoding=3, text=${t}))` : "";
}

function wavVerifyStatement(k: keyof TagPatch, v: unknown): string {
  const key = WAV_ID3_READ[k];
  const expected = JSON.stringify(String(v));
  return `if str(a.tags.get(${JSON.stringify(key)}, "")) != ${expected}: raise RuntimeError(${JSON.stringify(`tag readback failed: ${String(k)}`)})`;
}

/** MP4 freeform atom statement (----:com.apple.iTunes:<name>). */
function mp4Freeform(name: string, v: unknown): string {
  return `a["----:com.apple.iTunes:${name}"] = [MP4FreeForm(${JSON.stringify(String(v))}.encode("utf-8"), 3)]`;
}

/** Fixed text atoms: key → iTunes atom code (bracket-quoted values). */
const MP4_ATOMS: Partial<Record<keyof TagPatch, string>> = {
  title: "\xa9nam",
  artist: "\xa9ART",
  albumArtist: "aART",
  album: "\xa9alb",
  genre: "\xa9gen",
  year: "\xa9day",
  composer: "\xa9wrt",
  grouping: "\xa9grp",
  comment: "\xa9cmt",
};

/** Freeform atoms: key → ----:com.apple.iTunes:<name> suffix. */
const MP4_FREEFORM: Partial<Record<keyof TagPatch, string>> = {
  remixer: "REMIXER",
  mbid: "MusicBrainz Track Id",
  isrc: "ISRC",
  energy: "ENERGY",
  fingerprint: "ACOUSTID",
  mood: "MOOD",
  key: "initialkey",
  camelot: "CAMELOT",
  label: "LABEL",
  mixName: "MIXNAME",
  aiGenre: "AI-GENRE",
  aiYear: "AI-YEAR",
  beatport: "BP-FIELDS",
};

/** One mutagen MP4 statement per known key. Unknown keys return "" and are
 *  dropped by the filter — same skip semantics as before. */
function mp4Statement(k: keyof TagPatch, v: unknown): string {
  if (k === "bpm") return `a["tmpo"] = [${Math.round(Number(v))}]`;
  const ff = MP4_FREEFORM[k];
  if (ff) return mp4Freeform(ff, v);
  const atom = MP4_ATOMS[k];
  if (atom) return `a["${atom}"] = [${JSON.stringify(String(v))}]`;
  return "";
}

function mp4VerifyStatement(k: keyof TagPatch, v: unknown): string {
  if (k === "bpm") {
    return `if int(a["tmpo"][0]) != ${Math.round(Number(v))}: raise RuntimeError("tag readback failed: bpm")`;
  }
  const ff = MP4_FREEFORM[k];
  if (ff) {
    const atom = `----:com.apple.iTunes:${ff}`;
    return `if bytes(a[${JSON.stringify(atom)}][0]).decode("utf-8") != ${JSON.stringify(String(v))}: raise RuntimeError(${JSON.stringify(`tag readback failed: ${String(k)}`)})`;
  }
  const atom = MP4_ATOMS[k];
  return `if str(a[${JSON.stringify(atom)}][0]) != ${JSON.stringify(String(v))}: raise RuntimeError(${JSON.stringify(`tag readback failed: ${String(k)}`)})`;
}

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
  try {
    validatePatch(patch);
    const pairs = tagPairs(patch);
    if (!pairs.length) return true;
    const sets = pairs
      .map(([k, v]) => wavId3Statement(k, v))
      .filter(Boolean)
      .join("\n");
    const verifies = pairs.map(([k, v]) => wavVerifyStatement(k, v)).join("\n");
    return atomicMutagenWrite(
      filePath,
      (tempPath) => `${id3Open(tempPath)}
from mutagen.id3 import ID3, TIT2, TIT3, TPE1, TPE2, TALB, TCON, TDRC, TCOM, TIT1, TBPM, TKEY, TPUB, TXXX, TSRC, COMM
if a.tags is None: a.add_tags()
if not isinstance(a.tags, ID3): a.tags = ID3()
${sets}
a.save()
${id3Open(tempPath)}
${verifies}
print("ok")`,
      ops,
    );
  } catch (error) {
    void error;
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
function writePatchMp4(
  filePath: string,
  patch: TagPatch,
  ops?: Partial<WriterAtomicOps>,
): boolean {
  try {
    validatePatch(patch);
    const pairs = tagPairs(patch);
    if (!pairs.length) return true;
    const sets = pairs
      .map(([k, v]) => mp4Statement(k, v))
      .filter(Boolean)
      .join("\n");
    const verifies = pairs.map(([k, v]) => mp4VerifyStatement(k, v)).join("\n");
    return atomicMutagenWrite(
      filePath,
      (tempPath) => `from mutagen.mp4 import MP4, MP4FreeForm
a = MP4(${JSON.stringify(tempPath)})
if a.tags is None: a.add_tags()
${sets}
a.save()
a = MP4(${JSON.stringify(tempPath)})
${verifies}
print("ok")`,
      ops,
    );
  } catch (error) {
    void error;
    return false;
  }
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
  } catch (error) {
    void error;
    return false;
  } finally {
    unlinkIfPresent(dump);
    if (remuxTemp) unlinkIfPresent(remuxTemp);
  }
}
