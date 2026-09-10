/**
 * FullTags booth-text — the Pioneer DISPLAY-compatibility gate.
 *
 * Sibling of `player-compat.ts` (which answers "will it PLAY"); this
 * module answers "will the booth READ it". Four classes of text break or
 * garble on the XDJ-XZ / CDJ-3000 / CDJ-2000NXS2 / CDJ-2000 fleet:
 *
 *  1. UNSUPPORTED ENCODING. The CDJ-2000 (and every pre-NXS2 player)
 *     renders metadata from the byte tables of a fixed language setting:
 *     anything outside its LANGUAGE codepage shows as tofu/garbage — the
 *     manuals: "check that the information is not written in a language
 *     that is not supported by the unit". Emoji, CJK, Cyrillic, Hebrew,
 *     Arabic are all outside every fleet-safe set. CDJ-3000/NXS2 render
 *     real Unicode but still have NO emoji glyphs — emoji render as
 *     boxes or vanish.
 *  2. MOJIBAKE. Beatport's classic double-encode (UTF-8 bytes read as
 *     Latin-1 code points, re-encoded) and the CP1251-declared-Latin-1
 *     tagger bug produce strings whose BYTES are garbage even when the
 *     code points look plausible. Detected by re-encoding as Latin-1 /
 *     CP1252: real Latin-1 text round-trips, mojibake doesn't.
 *  3. EXPORT-KILLING FILENAME CHARACTERS. rekordbox grades some
 *     characters in a track's path "illegal" and silently skips the file
 *     at export ("One or more files were not exported") — the booth then
 *     shows the track from the DB but E-8306s on load. Known offenders:
 *     `;` and `/` (the "Awell / Ingrosso bug"), plus raw control bytes.
 *     `/` cannot survive on any filesystem, so it only appears in TAGS
 *     or in exotic filenames — both checked.
 *  4. PATH SHAPE. XDJ-XZ manual: players only browse 8 folder levels,
 *     and rekordbox/choked FAT32 paths truncate around 255 bytes.
 *
 * Verdicts follow player-compat's shape: `ok` + stable machine reasons
 * + a human detail sentence, so audit/ingest callers treat both gates
 * identically. `ok` means: displays correctly on the WHOLE fleet and
 * exports without the "files were not exported" roulette.
 */

/** Replace-with-tofu classes: outside every fleet-safe text set. Emoji
 * (incl. ZWJ sequences, skin tones, keycaps), pictographs, CJK, Hangul,
 * Hiragana/Katakana, Cyrillic, Arabic, Hebrew, plus the misc
 * symbol/arrow/dingbat blocks emoji ride in. Private-use and unassigned
 * code points render as tofu everywhere. Character classes are spelled
 * as explicit code-point escapes — literal combining sequences inside a
 * class are misleading (the linter is right) and NFC-normalizing the
 * INPUT is the correct defense (done by callers below). */
const NON_FLEET_TEXT = new RegExp(
  [
    "[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}]",
    "\\u{FE0F}\\u{200D}\\u{20E3}",
    "[\\u{2190}-\\u{21FF}\\u{2300}-\\u{2BFF}]",
    "[\\u{3040}-\\u{30FF}\\u{31F0}-\\u{31FF}]",
    "[\\u{4E00}-\\u{9FFF}\\u{3400}-\\u{4DBF}\\u{F900}-\\u{FAFF}]",
    "[\\u{AC00}-\\u{D7AF}\\u{1100}-\\u{11FF}\\u{3130}-\\u{318F}]",
    "[\\u{0590}-\\u{05FF}\\u{0600}-\\u{06FF}]",
    "[\\u{0400}-\\u{04FF}\\u{0500}-\\u{052F}]",
    "[\\u{E000}-\\u{F8FF}\\u{FF61}-\\u{FF9F}]",
  ].join("|"),
  "u",
);

/** Characters rekordbox's exporter rejects in a track path (the classic
 * export-roulette cause) plus raw control bytes. The control range is
 * the point of the check, not an accident — that's what a raw control
 * byte in a filename is. */
// eslint-disable-next-line no-control-regex
const PATH_ILLEGAL = new RegExp("[;\\u0000-\\u001F\\u007F]");

/** Text fields one file's display verdict is computed over. Comment is
 * excluded: it never shows in the booth and ingest writes stamps there. */
export const TEXT_FIELDS = ["title", "artist", "album", "genre"] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

import { boothFleetProfiles } from "./player-compat";

/** The display verdict for one file's metadata text. */
export interface TextCompatResult {
  /** Safe to display on the whole fleet AND to export. */
  ok: boolean;
  /** Stable machine reasons — tests/JSON keys. */
  reasons: string[];
  /** Human sentence naming the offending text. */
  detail: string;
  /** Field → first offending character (when the reason is char-level). */
  offenders: Partial<Record<TextField | "filename", string>>;
}

function firstMatch(text: string, re: RegExp): string | undefined {
  return re.exec(text)?.[0];
}

/** Mojibake detector. Two real failure classes:
 *  1. Beatport double-encode — UTF-8 bytes were read as CP1252 code
 *     points and re-encoded; a string that decodes back through
 *     CP1252→bytes→UTF-8 into more-plausible text is a double-encode.
 *  2. CP1251-declared-Latin-1 tagger bug — Cyrillic bytes saved with a
 *     Latin-1 encoding byte; the string is dominated by high Latin-1
 *     bytes that decode cleanly as CP1251.
 * Real Latin text (Beyoncé, Mø, Rós) fails both probes: accents are
 * isolated single high bytes next to ASCII, never a dominant run. */
export function isMojibake(text: string): boolean {
  if (text.length < 3) return false;
  // Map the string through CP1252 into bytes (high 0x80–0x9F ride the
  // CP1252 table: œ = 0x9C is the classic Beatport artifact char).
  const CP1252_HIGH = new Map([
    [0x80, 0x20ac],
    [0x82, 0x201a],
    [0x83, 0x192],
    [0x84, 0x201e],
    [0x85, 0x2026],
    [0x86, 0x2020],
    [0x87, 0x2021],
    [0x88, 0x2c6],
    [0x89, 0x2030],
    [0x8a, 0x160],
    [0x8b, 0x2039],
    [0x8c, 0x152],
    [0x8e, 0x17d],
    [0x91, 0x2018],
    [0x92, 0x2019],
    [0x93, 0x201c],
    [0x94, 0x201d],
    [0x95, 0x2022],
    [0x96, 0x2013],
    [0x97, 0x2014],
    [0x98, 0x2dc],
    [0x99, 0x2122],
    [0x9a, 0x161],
    [0x9b, 0x203a],
    [0x9c, 0x153],
    [0x9e, 0x17e],
    [0x9f, 0x178],
  ]);
  // Reverse map: code point → CP1252 byte.
  const TO_BYTE = new Map([...CP1252_HIGH].map(([b, cp]) => [cp, b]));
  const bytes: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const b = TO_BYTE.get(cp) ?? cp;
    if (b > 0xff) return false; // not byte-mappable → other gates apply
    bytes.push(b);
  }
  const u8 = new TextDecoder("utf-8", { fatal: true });
  // Class 1: bytes are valid UTF-8 yielding non-ASCII text (Ãœ → Ü).
  try {
    const decoded = u8.decode(new Uint8Array(bytes));
    if ([...decoded].some((c) => c.codePointAt(0)! > 0x7f)) return true;
  } catch {
    /* not the double-encode — fall through to class 2 */
  }
  // Class 2: CP1251-declared-Latin-1 Cyrillic debris — the whole string
  // rides the 0xC0–0xFF byte range (which decodes linearly to Cyrillic
  // А-я in CP1251) with essentially no ASCII letters left. Real
  // accented Latin ("Beyoncé") keeps its ASCII skeleton; the debris
  // ("Ïîõîä") has none.
  const high = bytes.filter((b) => b >= 0xc0).length;
  const asciiLetters = [...text].filter((c) => /[a-z]/i.test(c)).length;
  return high >= 3 && asciiLetters === 0;
}

/** One text verdict over a file's display fields + filename. */
export function boothTextCompat(input: {
  filename: string;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  genre?: string | null;
  /** Bytes of the track's relative path inside the export — the shape
   * the players actually browse. Optional; default derived from filename. */
  relPath?: string;
}): TextCompatResult {
  const reasons: string[] = [];
  const offenders: TextCompatResult["offenders"] = {};

  for (const field of TEXT_FIELDS) {
    const text = input[field];
    if (!text) continue;
    const emoji = firstMatch(text, NON_FLEET_TEXT);
    if (emoji) {
      reasons.push("non-fleet-characters");
      offenders[field] = emoji;
      continue;
    }
    if (isMojibake(text)) {
      reasons.push("mojibake");
      offenders[field] = text.slice(0, 24);
    }
  }

  const relPath = input.relPath ?? input.filename;
  const bad = firstMatch(relPath, PATH_ILLEGAL);
  if (bad) {
    reasons.push("path-illegal-character");
    offenders.filename = bad;
  }
  if (Buffer.byteLength(relPath, "utf8") > 255) {
    reasons.push("path-too-long");
  }
  // Fleet-aware depth: the floor of every selected player's browsable
  // folder levels (XDJ-XZ manual table; others equal or looser).
  const fleet = boothFleetProfiles();
  const maxDepth =
    fleet.length > 0
      ? Math.min(...fleet.map((p) => p.limits.maxFolderDepth))
      : 8;
  if (relPath.split("/").length - 1 >= maxDepth) {
    reasons.push("path-too-deep"); // files below the depth can't be played
  }
  // Windows-carried hazards: a trailing dot or space before the
  // extension is stripped/mangled by Windows tools that later touch the
  // export (rekordbox runs on Windows too) — the file silently renames
  // and the booth's saved path dead-ends (E-8306 class).
  const stem = relPath.replace(/\.[^.]+$/, "");
  if (/[. ]$/.test(stem) && stem.length > 0) {
    reasons.push("path-trailing-dot-or-space");
    offenders.filename = stem.slice(-1);
  }

  return {
    ok: reasons.length === 0,
    reasons: [...new Set(reasons)],
    detail: reasons.length
      ? Object.entries(offenders)
          .map(([f, ch]) => `${f}: …${JSON.stringify(ch)}…`)
          .join(", ")
      : "text safe on all four players",
    offenders,
  };
}
