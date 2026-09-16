/**
 * FullTags writer — mutagen half (#90 diet): the atomic-write machinery
 * and the ID3-in-container / MP4 atom statement builders. Split from
 * writer.ts so the ffmpeg remux half and this half evolve separately;
 * the seam (`mutagenPatchFrame`) is the #99 jscpd fix — one
 * validate → pairs → empty-check → statements → atomic write skeleton,
 * format-specific parts supplied per container.
 *
 * Gotchas owned here (each learned the hard way):
 *  - ffmpeg's AIFF muxer DROPS the ID3 chunk → AIFF writes go through
 *    mutagen, editing the ID3 chunk in place (artwork survives).
 *  - ffmpeg's WAV muxer canNOT carry attached_pic → WAV art via mutagen APIC.
 *    (rekordbox ignores art in WAVs entirely — convert to AIFF instead,
 *    see convert/wav-to-aiff.ts. WAV tag writes are still supported.)
 *  - m4a's ipod muxer has no metadata mapping for bpm/energy/remixer/
 *    mbid/AI-* keys and every remux wipes existing freeform (----) atoms
 *    → MP4 writes go through mutagen atoms in place.
 *  - Every write is atomic: tmp file → rename, a crash never truncates;
 *    the tmp KEEPS the media extension so mutagen infers the container.
 */
import { randomUUID } from "node:crypto";
import { basename, dirname, extname, join } from "node:path";
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { TagPatch } from "./schema";
import { validatePatch } from "./schema-guards";
import { mutagenOk } from "./mutagen";

export interface WriterAtomicOps {
  copyFile: (from: string, to: string) => void;
  writeFile: (path: string, data: Uint8Array) => void;
  rename: (from: string, to: string) => void;
  mutagenOk: (script: string) => boolean;
  fsyncFile: (path: string) => void;
}

export function fsyncFile(path: string): void {
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

export function atomicOps(
  overrides?: Partial<WriterAtomicOps>,
): WriterAtomicOps {
  return { ...DEFAULT_ATOMIC_OPS, ...overrides };
}

/** Defined entries of a TagPatch — set fields only (year/bpm/energy are numeric). */
export type TagPair = [keyof TagPatch, string | number];
export function tagPairs(patch: TagPatch): TagPair[] {
  return Object.entries(patch).filter(
    (pair): pair is TagPair => pair[1] !== undefined,
  );
}

/** Keep the extension on ffmpeg tmp outputs — the muxer is inferred from
 * the filename, so `.fa` (extensionless) fails with "Unable to choose an
 * output format". Pattern: `track.m4a` → `track.m4a.fa.m4a`. */
export function tmpLike(p: string, suffix: string): string {
  return `${p}${suffix}${extname(p).toLowerCase()}`;
}

/** A unique same-directory lease whose final suffix remains the media type,
 * so mutagen/ffmpeg infer the same container as the source. */
export function uniqueTempLike(
  p: string,
  purpose: string,
  extension = extname(p),
) {
  const ext = extension.toLowerCase();
  const stem = basename(p, extname(p));
  return join(dirname(p), `.${stem}.fulltags-${purpose}-${randomUUID()}${ext}`);
}

export function unlinkIfPresent(path: string): void {
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch (error) {
    console.error(`fulltags temp cleanup failed for ${path}`, error);
  }
}

export function hasValidContainerHeader(path: string): boolean {
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

export function atomicMutagenWrite(
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

/**
 * THE mutagen patch frame (jscpd, issue #99): `writePatchWav` and
 * `writePatchMp4` were the same validate → pairs → empty-check →
 * statement/verify build → atomic write → catch→false skeleton around
 * ONE format-specific part each (the statement builders + the python
 * open/save lines). The frame owns the skeleton; the caller owns the
 * format language. Script text is byte-identical to the inlined form —
 * writer.test.ts + writer-sync.test.ts pin both legs end-to-end.
 */
export function mutagenPatchFrame(
  filePath: string,
  patch: TagPatch,
  frame: {
    sets: (pairs: TagPair[]) => string;
    verifies: (pairs: TagPair[]) => string;
    script: (tempPath: string, sets: string, verifies: string) => string;
  },
  ops?: Partial<WriterAtomicOps>,
): boolean {
  try {
    validatePatch(patch);
    const pairs = tagPairs(patch);
    if (!pairs.length) return true;
    return atomicMutagenWrite(
      filePath,
      (tempPath) =>
        frame.script(tempPath, frame.sets(pairs), frame.verifies(pairs)),
      ops,
    );
  } catch (error) {
    void error;
    return false;
  }
}

// ---- WAV/AIFF (ID3-in-container) statement builders -----------------------

/** TXXX-desc→TagPatch-key map shared by the write + verify statement
 *  builders — one table instead of a case per stamp key. Typed as a
 *  Partial lookup over the full key set so `WAV_TXXX_DESC[k]` narrows
 *  cleanly for an arbitrary TagPatch key. */
export const WAV_TXXX_DESC: Partial<Record<keyof TagPatch, string>> = {
  energy: "ENERGY",
  fingerprint: "ACOUSTID",
  mood: "MOOD",
  beatport: "BP-FIELDS",
  camelot: "CAMELOT",
  aiGenre: "AI-GENRE",
  aiYear: "AI-YEAR",
  remixer: "version",
  mbid: "MusicBrainz Track Id",
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

export const WAV_ID3_READ: Record<keyof TagPatch, string> = {
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

/** Fixed-frame statement for the keys that need a real ID3 frame class
 *  (a TXXX desc cannot express them): year/bpm/isrc/comment, the TPE2/
 *  TIT1 frames from the old switch's explicit cases, plus the WAV_ID3
 *  text frames. */
const WAV_FRAME_STATEMENT: Partial<
  Record<keyof TagPatch, (t: string, raw: string) => string>
> = {
  year: (_t, raw) => `a.tags.add(TDRC(encoding=3, text="${raw}"))`,
  bpm: (_t, raw) => `a.tags.add(TBPM(encoding=3, text="${raw}"))`,
  comment: (t) =>
    `a.tags.add(COMM(encoding=3, lang="eng", desc="", text=${t}))`,
  isrc: (t) => `a.tags.add(TSRC(encoding=3, text=${t}))`,
  albumArtist: (t) => `a.tags.add(TPE2(encoding=3, text=${t}))`,
  grouping: (t) => `a.tags.add(TIT1(encoding=3, text=${t}))`,
};

export function wavId3Statement(k: keyof TagPatch, v: unknown): string {
  const t = JSON.stringify(String(v));
  // Whole-string interpolations (year/bpm) historically used the raw
  // String(v), not the JSON-encoded form — pinned by writer-sync tests.
  const raw = String(v);
  const fixed = WAV_FRAME_STATEMENT[k];
  if (fixed) return fixed(t, raw);
  const desc = WAV_TXXX_DESC[k];
  if (desc) return `a.tags.add(TXXX(encoding=3, desc="${desc}", text=${t}))`;
  const frame = WAV_ID3[k];
  return frame ? `a.tags.add(${frame}(encoding=3, text=${t}))` : "";
}

export function wavVerifyStatement(k: keyof TagPatch, v: unknown): string {
  const key = WAV_ID3_READ[k];
  const expected = JSON.stringify(String(v));
  return `if str(a.tags.get(${JSON.stringify(key)}, "")) != ${expected}: raise RuntimeError(${JSON.stringify(`tag readback failed: ${String(k)}`)})`;
}

// ---- MP4 (iTunes atoms) statement builders --------------------------------

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
export function mp4Statement(k: keyof TagPatch, v: unknown): string {
  if (k === "bpm") return `a["tmpo"] = [${Math.round(Number(v))}]`;
  const ff = MP4_FREEFORM[k];
  if (ff) return mp4Freeform(ff, v);
  const atom = MP4_ATOMS[k];
  if (atom) return `a["${atom}"] = [${JSON.stringify(String(v))}]`;
  return "";
}

export function mp4VerifyStatement(k: keyof TagPatch, v: unknown): string {
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
