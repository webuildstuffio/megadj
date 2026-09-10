// booth_fix_text.ts — the booth-text gate's fixer half (from booth-fix.ts):
// given one file's text verdict, build the rename and/or tag-repair row and
// apply it when asked. Rename runs FIRST (paths), then tag text, so the DB
// path update lands against the final name.
import { basename, dirname, join } from "node:path";
import { existsSync, renameSync } from "node:fs";
import {
  cp1252Bytes,
  writePatchSync,
  type TextCompatResult,
} from "../../fulltags/src/exports";
import type { BoothFixRow } from "./booth_fix_types";

/** One applied fix (counter + log line for the run summary). */
export interface ApplySink {
  apply: boolean;
  applied: number;
  log: (m: string) => void;
}

/** Result of the text-gate pass over one file. */
export interface TextFixOutcome {
  /** The row to report (rename row, tag row, or a combined row). */
  row: BoothFixRow | null;
  /** Final path after any applied rename (DB follow reads this). */
  workFile: string;
  /** True when a rename actually happened (drives the DB path update). */
  renamed: boolean;
}

/** Transliteration for the Latin-extended repertoire booth displays
 * actually render fine — we keep those. This map is only for
 * fix-forcing scripts users ask to transliterate; the default sanitizer
 * STRIPS what the fleet can't show and keeps everything else. */
const SANITIZE_MAP: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u2013": "-",
  "\u2014": "-",
  "\u2026": "...",
  "\u00A0": " ",
  "\u200B": "",
};

/** Sanitize one display string to the fleet-safe repertoire: strip
 * emoji/pictograph/private-use characters and control bytes, map common
 * typographic punctuation to ASCII equivalents, keep accents (the
 * players render Latin-extended fine). NFC input assumed. */
export function sanitizeDisplayText(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    const cp = ch.codePointAt(0)!;
    // typographic punctuation with ASCII equivalents
    if (SANITIZE_MAP[ch] !== undefined) {
      out += SANITIZE_MAP[ch];
      continue;
    }
    // strip: emoji blocks, pictographs, dingbats, variation selectors,
    // ZWJ, keycap, private-use, unassigned BMP symbol areas, control
    if (
      (cp >= 0x1f000 && cp <= 0x1faff) ||
      (cp >= 0x2600 && cp <= 0x27bf) ||
      (cp >= 0x2b00 && cp <= 0x2bff) ||
      cp === 0xfe0f ||
      cp === 0x200d ||
      cp === 0x20e3 ||
      (cp >= 0xe000 && cp <= 0xf8ff) ||
      (cp >= 0x2190 && cp <= 0x21ff) ||
      (cp >= 0x2300 && cp <= 0x23ff) ||
      cp < 0x20 ||
      cp === 0x7f
    ) {
      continue;
    }
    out += ch;
  }
  return out.replace(/ {2,}/g, " ").trim();
}

/** Sanitize a filename: same repertoire as display text plus the path
 * separators and rekordbox's illegal set. */
export function sanitizeFilename(name: string): string {
  const cleaned = sanitizeDisplayText(name)
    .replace(/;/g, ",")
    .replace(/[/\\]/g, "-")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[. ]+\./g, ".") // trailing dots/spaces before the extension
    .trim();
  return cleaned.length > 0 ? cleaned : "untitled";
}

/** Mojibake repair: decode the string's bytes back through the suspected
 * source encoding. Only used when boothTextCompat flagged mojibake.
 * Byte mapping comes from fulltags booth-text's CP1252 SSOT (cp1252Bytes)
 * — the twin table that used to live in booth-fix.ts was a jscpd-flagged
 * clone. */
export function repairMojibake(text: string): string | null {
  const bytes = cp1252Bytes(text);
  if (bytes === null) return null;
  try {
    const u8 = new TextDecoder("utf-8", { fatal: true });
    const repaired = u8.decode(new Uint8Array(bytes));
    if ([...repaired].some((c) => c.codePointAt(0)! > 0x7f)) return repaired;
    return null;
  } catch {
    return null;
  }
}

/** Build + optionally apply the rename fix for path-illegal names. */
function planRename(
  p: string,
  name: string,
  reasons: string[],
): { row: BoothFixRow; to: string } {
  const to = join(dirname(p), sanitizeFilename(name));
  return {
    to,
    row: {
      file: p,
      gate: "booth-text",
      reasons: [...reasons],
      action: "rename",
      plan:
        to !== p ? `rename → ${basename(to)}` : "rename (name already safe?)",
      rename: { from: p, to },
    },
  };
}

/** Apply a rename unless the target already exists (never clobber). */
function applyRename(
  from: string,
  to: string,
  sink: ApplySink,
): { workFile: string; renamed: boolean } {
  if (!sink.apply || to === from || existsSync(to))
    return { workFile: from, renamed: false };
  renameSync(from, to);
  sink.applied++;
  sink.log(`  [renamed] ${basename(from)} → ${basename(to)}`);
  return { workFile: to, renamed: true };
}

/** Build + optionally apply the tag rewrite for mojibake / non-fleet text. */
function planTags(
  workFile: string,
  reasons: string[],
  tags: Record<string, string | null>,
  mojibake: boolean,
  sink: ApplySink,
): BoothFixRow {
  const patch: Record<string, string> = {};
  for (const [field, value] of Object.entries(tags)) {
    if (!value) continue;
    let next = mojibake ? repairMojibake(value) : null;
    if (next === null) next = sanitizeDisplayText(value);
    if (next !== value) patch[field] = next;
  }
  const hasPatch = Object.keys(patch).length > 0;
  const row: BoothFixRow = {
    file: workFile,
    gate: "booth-text",
    reasons: [...reasons],
    action: hasPatch ? (mojibake ? "repair-tags" : "sanitize-tags") : "none",
    plan: hasPatch
      ? `rewrite tags: ${Object.keys(patch).join(", ")}`
      : "no safe auto-fix — fix tags by hand (mutagen/MP3Tag)",
  };
  if (sink.apply && hasPatch) {
    writePatchSync(workFile, patch);
    sink.applied++;
    sink.log(
      `  [tags] ${basename(workFile)}: ${Object.keys(patch).join(", ")}`,
    );
  }
  return row;
}

/** Merge a tag row into an existing rename row (one row per file, plan
 *  strings joined) — rename + tag work can hit the same file. */
function mergeRows(row: BoothFixRow, tagRow: BoothFixRow): BoothFixRow {
  row.reasons = [...new Set([...row.reasons, ...tagRow.reasons])];
  if (tagRow.action !== "none") row.plan = `${row.plan}; ${tagRow.plan}`;
  return row;
}

/** The text-gate fixer: verdict in, applied fixes + report row out. */
export function fixBoothText(
  p: string,
  text: TextCompatResult,
  tags: Record<string, string | null>,
  sink: ApplySink,
): TextFixOutcome {
  if (text.ok) return { row: null, workFile: p, renamed: false };

  const needsRename = text.reasons.some(
    (r) => r === "path-illegal-character" || r === "path-trailing-dot-or-space",
  );
  const mojibake = text.reasons.includes("mojibake");
  const emoji = text.reasons.includes("non-fleet-characters");

  let workFile = p;
  let renamed = false;
  let row: BoothFixRow | null = null;

  if (needsRename) {
    const planned = planRename(p, basename(p), text.reasons);
    row = planned.row;
    const appliedRename = applyRename(p, planned.to, sink);
    workFile = appliedRename.workFile;
    renamed = appliedRename.renamed;
  }

  if (mojibake || emoji) {
    const tagRow = planTags(workFile, text.reasons, tags, mojibake, sink);
    row = row ? mergeRows(row, tagRow) : tagRow;
  }
  return { row, workFile, renamed };
}
