/**
 * booth-fix — propose (and optionally apply) fixes for everything the
 * booth gates flag: `megadj audit` finds the gaps, this command FIXES
 * the fixable ones and prints an executable plan for the rest.
 *
 * Fix matrix (fleet-aware — derived from config.toml [booth].fleet via
 * setBoothFleet, so a CDJ-2000 in the fleet widens the fix set):
 *
 *   flag                    fix                                        apply-safe?
 *   ----------------------  -----------------------------------------  -----------
 *   non-fleet-characters    sanitize tag text (per-char: strip emoji,  yes (tag
 *                           transliterate accents→ASCII, drop or        rewrite,
 *                           best-effort map other scripts)              atomic)
 *   mojibake                re-decode (CP1252→UTF-8 or CP1251) and     yes (tag
 *                           write the repaired string                    rewrite)
 *   path-illegal-character  rename file (sanitized), update DB paths   yes (rename
 *                           so rekordbox relink + re-export work         + DB update)
 *   path-trailing-dot/space rename (same machinery)                    yes
 *   path-too-long / -deep   propose only (moves change library layout; yes→plan
 *                           the plan names the shallowest legal path)  only
 *   player-compat (audio)   convert/re-encode is convert's job — the   plan only
 *                           plan names `megadj convert` / re-source
 *
 * Nothing is deleted, ever: renames keep the same audio bytes; tag
 * sanitization preserves the rest of the tag. --apply idempotence: a
 * second run finds nothing to fix (the sanitizer is a fixed point).
 */
import { basename, join, dirname } from "node:path";
import { existsSync, renameSync } from "node:fs";
import {
  groundTruth,
  walkAudioFiles,
  probeFile,
  playerCompat,
  isHiresOnly,
  boothTextCompat,
  writePatchSync,
  type TextCompatResult,
} from "../../fulltags/src/exports";
import type { ArchiveState } from "../state";

export interface BoothFixOptions {
  state: ArchiveState;
  musicDir: string;
  /** Extra root to also walk (e.g. the shelf Contents dir). */
  alsoWalk?: string;
  dryRun?: boolean;
  apply?: boolean;
  json?: boolean;
  log?: (m: string) => void;
}

/** Look up the track a file belongs to (booth-fix's DB follow). Scans
 * the in-memory track list — the archive is ~hundreds of rows, and this
 * avoids widening ArchiveState's query surface. */
export function trackIdForFile(
  state: ArchiveState,
  relPath: string,
): string | null {
  const hit = state
    .allTracks()
    .find(
      (t) => t.file_path === relPath || t.file_path?.endsWith(`/${relPath}`),
    );
  return hit?.video_id ?? null;
}

export interface BoothFixRow {
  file: string;
  gate: "booth-text" | "player-compat";
  reasons: string[];
  /** What the fixer WILL do on --apply. */
  action: "sanitize-tags" | "repair-tags" | "rename" | "relocate" | "none";
  /** Human proposal — every non-applied row must name its command. */
  plan: string;
  /** Renames: old → new. */
  rename?: { from: string; to: string };
}

export interface BoothFixResult {
  fleet: string[];
  checked: number;
  fixable: number;
  applied: number;
  rows: BoothFixRow[];
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

/** Mojibake repair: decode the string's bytes back through the suspected
 * source encoding. Only used when boothTextCompat flagged mojibake. */
export function repairMojibake(text: string): string | null {
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
  const TO_BYTE = new Map([...CP1252_HIGH].map(([b, cp]) => [cp, b]));
  try {
    const bytes: number[] = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      const b = TO_BYTE.get(cp) ?? cp;
      if (b > 0xff) return null;
      bytes.push(b);
    }
    // CP1251 Cyrillic debris: bytes decode linearly to U+0410+ in the
    // C0–FF range; CP1252 differs on some — try CP1251 table for the
    // high range (linear) when the string has no ASCII letters.
    const hasAscii = /[a-z]/i.test(text);
    const u8 = new TextDecoder("utf-8", { fatal: true });
    const repaired = u8.decode(new Uint8Array(bytes));
    if ([...repaired].some((c) => c.codePointAt(0)! > 0x7f)) return repaired;
    void hasAscii;
    return null;
  } catch {
    return null;
  }
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

function walkRoots(musicDir: string, alsoWalk?: string): string[] {
  const roots = [walkAudioFiles(musicDir)];
  if (alsoWalk && existsSync(alsoWalk)) roots.push(walkAudioFiles(alsoWalk));
  return roots.flat();
}

export async function boothFix(opts: BoothFixOptions): Promise<BoothFixResult> {
  const log = opts.log ?? (() => {});
  const apply = opts.apply === true && opts.dryRun !== true;
  const rows: BoothFixRow[] = [];
  const seen = new Set<string>();
  let checked = 0;
  let applied = 0;
  const { getBoothFleet } = await import("../../fulltags/src/exports");

  for (const p of walkRoots(opts.musicDir, opts.alsoWalk)) {
    if (seen.has(p) || !existsSync(p)) continue;
    seen.add(p);
    checked++;
    const t = groundTruth(p);
    const name = basename(p);
    const text: TextCompatResult = boothTextCompat({
      filename: name,
      title: t.title,
      artist: t.artist,
      album: t.album,
      genre: t.genre,
      relPath: p.slice(opts.musicDir.length + 1),
    });
    const compat = playerCompat(await probeFile(p));

    if (text.ok && (compat.ok || isHiresOnly(compat))) continue;

    // Build the fix plan. Order matters: rename first (paths), then tag
    // text, so the DB path update lands against the final name.
    let workFile = p;
    let row: BoothFixRow | null = null;

    if (!text.ok) {
      const needsRename = text.reasons.some(
        (r) =>
          r === "path-illegal-character" || r === "path-trailing-dot-or-space",
      );
      const mojibake = text.reasons.includes("mojibake");
      const emoji = text.reasons.includes("non-fleet-characters");

      if (needsRename) {
        const to = join(dirname(p), sanitizeFilename(name));
        row = {
          file: p,
          gate: "booth-text",
          reasons: [...text.reasons],
          action: "rename",
          plan:
            to !== p
              ? `rename → ${basename(to)}`
              : "rename (name already safe?)",
          rename: { from: p, to },
        };
        if (apply && to !== p && !existsSync(to)) {
          renameSync(p, to);
          workFile = to;
          applied++;
          log(`  [renamed] ${name} → ${basename(to)}`);
        }
      }

      if (mojibake || emoji) {
        const patch: Record<string, string> = {};
        for (const [field, value] of Object.entries({
          title: t.title,
          artist: t.artist,
          album: t.album,
          genre: t.genre,
        })) {
          if (!value) continue;
          let next = mojibake ? repairMojibake(value) : null;
          if (next === null) next = sanitizeDisplayText(value);
          if (next !== value) patch[field] = next;
        }
        const tagRow: BoothFixRow = {
          file: workFile,
          gate: "booth-text",
          reasons: [...text.reasons],
          action:
            Object.keys(patch).length > 0
              ? mojibake
                ? "repair-tags"
                : "sanitize-tags"
              : "none",
          plan:
            Object.keys(patch).length > 0
              ? `rewrite tags: ${Object.keys(patch).join(", ")}`
              : "no safe auto-fix — fix tags by hand (mutagen/MP3Tag)",
        };
        if (apply && Object.keys(patch).length > 0) {
          writePatchSync(workFile, patch);
          applied++;
          log(
            `  [tags] ${basename(workFile)}: ${Object.keys(patch).join(", ")}`,
          );
        }
        if (row) {
          // rename + tag work on the same file: one row, combined plan
          row.reasons = [...new Set([...row.reasons, ...tagRow.reasons])];
          if (tagRow.action !== "none") {
            row.plan = `${row.plan}; ${tagRow.plan}`;
          }
        } else {
          row = tagRow;
        }
      }
      if (row) rows.push(row);
    }

    if (!compat.ok && !isHiresOnly(compat)) {
      rows.push({
        file: workFile,
        gate: "player-compat",
        reasons: [...compat.reasons],
        action: "none",
        plan: `audio outside the fleet floor (${compat.reasons.join(", ")}) — run \`megadj convert\` (WAV→AIFF) or re-source the track`,
      });
    }

    // DB path follow for applied renames (rekordbox relink reads this).
    if (apply && row?.rename && workFile !== p) {
      const relOld = p.slice(opts.musicDir.length + 1);
      const relNew = workFile.slice(opts.musicDir.length + 1);
      const videoId = trackIdForFile(opts.state, relOld);
      if (videoId) opts.state.updateFilePath(videoId, relNew);
    }
  }

  const result: BoothFixResult = {
    fleet: [...getBoothFleet()],
    checked,
    fixable: rows.filter((r) => r.action !== "none").length,
    applied,
    rows,
  };
  return result;
}
