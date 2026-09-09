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

import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
} from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";

export interface DedupePair {
  original: string;
  twin: string;
  bytesOriginal: number;
  bytesTwin: number;
  /** md5 | fingerprint | different-audio */
  method: string;
  verdict: "keep-original" | "keep-twin" | "keep-both";
  /** human-readable reason for the verdict */
  reason: string;
  /** quarantine path if apply would move this file */
  loser?: string | null;
}

export interface DedupeResult {
  shelfVolume: string;
  quarantine: string;
  pairs: DedupePair[];
  scanned: number;
  byteDupes: number;
  fingerprintDupes: number;
  keepBoth: number;
  applied: boolean;
  moved: number;
  /** keep-twin pairs applied: twin content now lives at the original path */
  upgraded: number;
  errors: string[];
  ok: boolean;
}

const AUDIO_EXTS = new Set([".mp3", ".wav", ".aif", ".aiff", ".m4a", ".flac"]);
/** Quality ladder for "which rip is the keeper" (higher wins). */
function qualityRank(path: string): number {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  const extRank: Record<string, number> = {
    ".aiff": 4,
    ".aif": 4,
    ".flac": 4,
    ".wav": 3,
    ".m4a": 1,
    ".mp3": 1,
  };
  let rank = extRank[ext] ?? 0;
  // bitrate as tiebreak inside lossy formats
  const probe = spawnSync("ffprobe", [
    "-v",
    "quiet",
    "-show_entries",
    "format=bit_rate",
    "-of",
    "csv=p=0",
    path,
  ]);
  if (probe.status === 0) {
    const br = Number(probe.stdout.toString().trim());
    if (Number.isFinite(br) && br > 0) rank += br / 10_000_000; // 320k ≈ +0.032
  }
  return rank;
}

function md5(path: string): string | null {
  const r = spawnSync("md5", ["-q", path]);
  if (r.status !== 0) return null;
  const h = r.stdout.toString().trim();
  return h.length > 0 ? h : null;
}

function fingerprint(path: string): string | null {
  const r = spawnSync("fpcalc", ["-length", "120", path]);
  if (r.status !== 0) return null;
  const m = r.stdout.toString().match(/FINGERPRINT=([A-Za-z0-9=/]+)/);
  const fp = m?.[1];
  return fp ?? null;
}

/** Walk the shelf Contents/, return every twin + its deduced original. */
export function findTwinPairs(shelfVolume: string): Array<{
  original: string;
  twin: string;
  bytesOriginal: number;
  bytesTwin: number;
}> {
  const contents = join(shelfVolume, "Contents");
  if (!existsSync(contents)) return [];
  const pairs: Array<{
    original: string;
    twin: string;
    bytesOriginal: number;
    bytesTwin: number;
  }> = [];
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

export interface ShelfDedupeOptions {
  shelfVolume?: string;
  apply?: boolean;
  yes?: boolean;
  json?: boolean;
  log?: (s: string) => void;
  /** test seam: skip fpcalc (byte stage only) */
  skipFingerprint?: boolean;
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
  const pairs: DedupePair[] = [];
  let byteDupes = 0;
  let fingerprintDupes = 0;
  let keepBoth = 0;

  for (const p of raw) {
    let verdict: DedupePair["verdict"];
    let method: string;
    let reason: string;

    const hO = md5(p.original);
    const hT = hO ? md5(p.twin) : null;
    if (hO && hO === hT) {
      byteDupes++;
      verdict = "keep-original";
      method = "md5";
      reason = "byte-identical (MD5) — twin is a pure duplicate";
    } else if (skipFingerprint) {
      keepBoth++;
      verdict = "keep-both";
      method = "skipped";
      reason = "bytes differ; fingerprint stage skipped";
    } else {
      const fO = fingerprint(p.original);
      const fT = fO ? fingerprint(p.twin) : null;
      if (fO && fO === fT) {
        fingerprintDupes++;
        // same recording: higher quality wins
        const qO = qualityRank(p.original);
        const qT = qualityRank(p.twin);
        if (qT > qO) {
          verdict = "keep-twin";
          reason = `same fingerprint; twin is higher quality (${p.bytesTwin} vs ${p.bytesOriginal} bytes)`;
        } else {
          verdict = "keep-original";
          reason = `same fingerprint; original already >= twin quality (${p.bytesOriginal} vs ${p.bytesTwin} bytes)`;
        }
        method = "fingerprint";
      } else {
        keepBoth++;
        verdict = "keep-both";
        method = "fingerprint";
        reason =
          "different fingerprints — genuinely different audio, keep both";
      }
    }

    const loser: string | null =
      verdict === "keep-original"
        ? p.twin
        : verdict === "keep-twin"
          ? p.original
          : null;
    pairs.push({
      original: p.original,
      twin: p.twin,
      bytesOriginal: p.bytesOriginal,
      bytesTwin: p.bytesTwin,
      method,
      verdict,
      reason,
      loser,
    });
  }

  let moved = 0;
  let upgraded = 0;
  const applied = apply && yes;
  if (applied) {
    mkdirSync(quarantine, { recursive: true });
    for (const pair of pairs) {
      if (!pair.loser) continue;
      try {
        if (pair.verdict === "keep-twin") {
          // UPGRADE: the rekordbox DB references the ORIGINAL path, so the
          // twin's (higher-quality) content must end up AT that path.
          // Step 1: move the lower-quality original into quarantine under a
          // name that can't collide with anything (suffix with the twin's
          // volume tag already in the twin filename is ambiguous here, so
          // prefix `.superseded-`).
          const qName = `.superseded-${basename(pair.original)}`;
          const qDest = join(quarantine, qName);
          if (existsSync(qDest)) {
            errors.push(`${pair.original}: quarantine already has ${qName}`);
            continue;
          }
          renameSync(pair.original, qDest);
          // Step 2: twin takes over the canonical path.
          renameSync(pair.twin, pair.original);
          upgraded++;
          moved += 2;
        } else {
          const dest = join(quarantine, basename(pair.loser!));
          if (existsSync(dest)) {
            errors.push(
              `${pair.loser}: quarantine already has ${basename(pair.loser!)}`,
            );
            continue;
          }
          renameSync(pair.loser!, dest);
          moved++;
        }
      } catch (e) {
        errors.push(`${pair.loser}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  const ok = errors.length === 0;
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
    return {
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
  return {
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
}
