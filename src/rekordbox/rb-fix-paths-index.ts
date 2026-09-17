// rb-fix-paths-index.ts — the live-audio index + matching ladder for
// rb-fix-paths (#42 item 2 split, out of rb-fix-paths.ts). Shared with
// rb-unmatched: one walker, one index shape, two consumers.
//
// The ladder (in order — first confident match wins):
//   exact → NFC+casefold → unique basename → strip repeated -N copy
//   suffixes → 20-char prefix (exFAT truncation) → largest twin
import { existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { nameKey } from "../shared/name-key";
import { walkAudioDir } from "../shared/audio-walk";
import type { LiveIndex, RbFixRow } from "./rb-fix-paths-types";

/** The unique-path index: every audio file under <mount>/Contents (and
 *  PIONEER REC, the walked roots), keyed by the ladder's match keys. */

/** One empty LiveIndex — was duplicated in buildIndex and the test seam. */
export function emptyIndex(): LiveIndex {
  return {
    byNorm: new Map(),
    byBasename: new Map(),
    byStripped: new Map(),
    byPrefix20: new Map(),
  };
}

function nfkc(s: string): string {
  return nameKey(s);
}

/** "track - 1.mp3", "track - 1 2.mp3" → "track.mp3" — auto-relocate
 *  renumbers copies; merges scatter them. Strip trailing " - N"/" N"
 *  before the extension, REPEATEDLY (until stable): a single pass left
 *  "track - 1 2.mp3" as "track - 1.mp3", so double-renumbered copies
 *  missed the byStripped ladder rung and their DB rows stayed dead
 *  (fixed 2026-09-17, pinned in rb-fix-paths.test.ts). Guarded against
 *  the pathological all-digits name ("2.mp3" → "" stem → kept as-is). */
export function stripCopySuffix(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let out = stem;
  for (;;) {
    const stripped = out.replace(/(\s*-\s*|\s+)\d+$/u, "").trimEnd();
    // An empty stem means the WHOLE name was digits ("2.mp3") — that is
    // a real (junk) name, not a copy suffix; keep it rather than "".
    if (stripped === "" || stripped === out) return stripped + ext;
    out = stripped;
  }
}

function walkAudio(root: string, out: string[]): void {
  // shared walker (#142): soft-fail, dotfile/`._` skip, AUDIO_EXTS SSOT
  out.push(...walkAudioDir(root));
}

/** Shared with rb-unmatched: the live-audio index (same roots, same junk
 *  rules) and the pyrekordbox row reader. Exported, not duplicated — one
 *  walker, one DB reader, two consumers. */
export function buildIndex(mount: string): LiveIndex {
  const files: string[] = [];
  const contents = join(mount, "Contents");
  if (existsSync(contents)) walkAudio(contents, files);
  // PIONEER REC is walked per coverage rules; PIONEER/ device DBs never
  const rec = join(mount, "PIONEER REC");
  if (existsSync(rec)) walkAudio(rec, files);
  const idx: LiveIndex = emptyIndex();
  for (const f of files) {
    const n = nfkc(f);
    idx.byNorm.set(n, f);
    const b = basename(f).toLowerCase();
    idx.byBasename.set(b, [...(idx.byBasename.get(b) ?? []), f]);
    const s = stripCopySuffix(basename(f)).toLowerCase();
    idx.byStripped.set(s, [...(idx.byStripped.get(s) ?? []), f]);
    const p = n.slice(0, 20);
    idx.byPrefix20.set(p, [...(idx.byPrefix20.get(p) ?? []), f]);
  }
  return idx;
}

/** Quality bias for ambiguous matches: biggest file wins (higher bitrate
 *  is the safer default; quarantine holds the small twins). */
function largest(paths: string[]): string {
  let best = paths[0];
  if (best === undefined) return "";
  let bestSize = -1;
  for (const p of paths) {
    try {
      const sz = statSync(p).size;
      if (sz > bestSize) {
        bestSize = sz;
        best = p;
      }
    } catch {
      continue;
    }
  }
  return best;
}

export function matchLadder(broken: string, idx: LiveIndex): RbFixRow {
  const base: RbFixRow = {
    id: "",
    brokenPath: broken,
    fixPath: null,
    via: "unresolved",
  };
  // 1 — exact
  if (existsSync(broken)) return { ...base, via: "exists???" }; // not broken
  // 2 — NFC+casefold
  const norm = idx.byNorm.get(nfkc(broken));
  if (norm) return { ...base, fixPath: norm, via: "nfc-casefold" };
  // 3 — unique basename
  const bns = idx.byBasename.get(basename(broken).toLowerCase());
  if (bns && bns.length === 1 && bns[0] !== undefined)
    return { ...base, fixPath: bns[0], via: "basename" };
  // 4 — strip repeated -N copy suffixes (unique)
  const sts = idx.byStripped.get(
    stripCopySuffix(basename(broken)).toLowerCase(),
  );
  if (sts && sts.length === 1 && sts[0] !== undefined)
    return { ...base, fixPath: sts[0], via: "copy-suffix" };
  // 5 — 20-char prefix (exFAT truncation), unique
  const pfs = idx.byPrefix20.get(nfkc(broken).slice(0, 20));
  if (pfs && pfs.length === 1 && pfs[0] !== undefined)
    return { ...base, fixPath: pfs[0], via: "prefix20" };
  // 6 — multiple stripped matches → largest twin
  if (sts && sts.length > 1)
    return { ...base, fixPath: largest(sts), via: "largest-twin" };
  if (bns && bns.length > 1)
    return { ...base, fixPath: largest(bns), via: "largest-twin" };
  return base; // genuinely dead — reported, never touched
}
