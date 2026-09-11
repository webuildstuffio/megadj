/**
 * shelf-dedupe — the twin-resolution pass for the shelf master.
 *
 * The archive sweeps preserve divergent same-name rips as
 * "<stem> [<volume>]<ext>" twins beside the shelf original. Twins exist so
 * nothing is lost; this command resolves them in three cheapest-first
 * stages, NEVER deleting without the two-step gate:
 *
 *   1. byte stage     — MD5 twin vs original; identical bytes = pure dupe.
 *   2. fingerprint    — chromaprint (fpcalc -length 120) both files;
 *                       same fingerprint => same recording, keep the higher
 *                       quality side; different => genuinely different audio
 *                       (edits/remasters), keep BOTH.
 *   3. human gate     -- `--report` prints the keep-list; `--apply` moves
 *                       losers into a quarantine folder on the shelf
 *                       (never in-place delete). A later, explicit
 *                       emptying of quarantine is the only destructive step.
 *
 * Default (no flags): report mode. `--apply` requires `--yes` so the
 * destructive step can never fire by accident.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { DedupeResult } from "./shelf-dedupe-types";
import { judgePair, applyPairs } from "./shelf-dedupe-verdict";

// DedupePair/DedupeResult are DEFINED in shelf-dedupe-types.ts (the leaf
// seam shared with shelf-dedupe-verdict.ts — a split-out module must never
// import its parent's types back: madge counts a type-only back-edge as a
// cycle).
export interface ShelfDedupeOptions {
  shelfVolume?: string;
  apply?: boolean;
  yes?: boolean;
  json?: boolean;
  log?: (s: string) => void;
  /** test seam: skip fpcalc (byte stage only) */
  skipFingerprint?: boolean;
}

const AUDIO_EXTS = new Set([".mp3", ".wav", ".aif", ".aiff", ".m4a", ".flac"]);

/** Walk the shelf Contents/, return every twin + its deduced original. */
export function findTwinPairs(shelfVolume: string): {
  original: string;
  twin: string;
  bytesOriginal: number;
  bytesTwin: number;
}[] {
  const contents = join(shelfVolume, "Contents");
  if (!existsSync(contents)) return [];
  const pairs: {
    original: string;
    twin: string;
    bytesOriginal: number;
    bytesTwin: number;
  }[] = [];
  const twinRe = /^(.*) \[([^\]]+)\](\.[A-Za-z0-9]+)$/;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith("._") || entry.name.startsWith(".")) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      const m = entry.name.match(twinRe);
      if (!m) continue;
      const stem = m[1] ?? "";
      const volTag = m[2] ?? "";
      const ext = m[3] ?? "";
      void volTag;
      if (!ext || !AUDIO_EXTS.has(ext.toLowerCase())) continue;
      // the original is "<stem><ext>" beside the twin (or any same-stem sibling)
      const sibling = readdirSync(dir).find(
        (n) =>
          n !== entry.name &&
          !n.startsWith("._") &&
          (n === `${stem}${ext}` ||
            (n.startsWith(`${stem} [`) === false && n === `${stem}${ext}`)),
      );
      const orig = sibling ? join(dir, sibling) : join(dir, `${stem}${ext}`);
      if (!existsSync(orig)) continue;
      pairs.push({
        original: orig,
        twin: abs,
        bytesOriginal: statSync(orig).size,
        bytesTwin: statSync(abs).size,
      });
    }
  };
  walk(contents);
  return pairs;
}

export async function shelfDedupe(
  opts: ShelfDedupeOptions = {},
): Promise<DedupeResult> {
  const {
    shelfVolume = process.env.MEGADJ_SHELF ?? "/Volumes/SHELF1",
    apply = false,
    yes = false,
    json = false,
    log = (s) => console.log(s),
    skipFingerprint = false,
  } = opts;

  const quarantine = join(shelfVolume, "Contents", ".dedupe-quarantine");
  const raw = findTwinPairs(shelfVolume);
  const errors: string[] = [];
  const tally = { byteDupes: 0, fingerprintDupes: 0, keepBoth: 0 };

  // Stage 1+2: judge every twin pair (md5 → fingerprint → keep-both).
  const pairs = raw.map((p) => judgePair(p, skipFingerprint, tally));
  const { byteDupes, fingerprintDupes, keepBoth } = tally;

  // Stage 3 (human gate already happened at the CLI): quarantine moves.
  const applied = apply && yes;
  let moved = 0;
  let upgraded = 0;
  if (applied) {
    const r = applyPairs(pairs, quarantine, errors);
    moved = r.moved;
    upgraded = r.upgraded;
  }

  const ok = errors.length === 0;
  const result: DedupeResult = {
    shelfVolume,
    quarantine,
    pairs,
    scanned: raw.length,
    byteDupes,
    fingerprintDupes,
    keepBoth,
    applied,
    moved,
    upgraded,
    errors,
    ok,
  };
  if (json) {
    console.log(
      JSON.stringify(
        {
          command: "shelf-dedupe",
          shelf: shelfVolume,
          quarantine,
          scanned: raw.length,
          byteDupes,
          fingerprintDupes,
          keepBoth,
          applied,
          moved,
          upgraded,
          errors,
          ok,
          pairs: pairs.map((p) => ({
            original: p.original,
            twin: p.twin,
            verdict: p.verdict,
            method: p.method,
            reason: p.reason,
          })),
        },
        null,
        2,
      ),
    );
    if (!ok) process.exitCode = 1;
    return result;
  }

  log(`shelf-dedupe on ${shelfVolume}: ${raw.length} twin pairs`);
  log(
    `  byte-identical: ${byteDupes} · same recording (fingerprint): ${fingerprintDupes} · different audio: ${keepBoth}`,
  );
  for (const p of pairs) {
    const tag =
      p.verdict === "keep-both"
        ? "KEEP BOTH"
        : `DELETE ${basename(p.loser ?? "")}`;
    log(`  [${p.method}] ${tag} — ${p.reason}`);
    log(`      ${p.original}`);
    if (p.verdict !== "keep-both") log(`      vs ${p.twin}`);
  }
  if (applied) {
    log(
      `applied: ${moved} file(s) handled — ${upgraded} upgrades (twin content took the original path), rest moved to ${quarantine}`,
    );
  } else if (apply && !yes) {
    log("apply requested but --yes missing — report only (safety gate)");
  } else {
    log("report only — re-run with --apply --yes to move losers to quarantine");
  }
  if (!ok) {
    log(`ERRORS: ${errors.length} (first: ${errors[0]})`);
    process.exitCode = 1;
  }
  return result;
}
