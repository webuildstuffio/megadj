/**
 * atomic-file.ts — THE temp-sibling atomic-replacement seam (issue #162).
 *
 * "Atomic temp-file replacement" is an AGENTS invariant for writers
 * ("a crash never truncates"), but temp-name + swap was hand-rolled with
 * diverging collision/cleanup rules: the playlist-twin re-derived
 * pid+uuid naming, upgrade.ts re-derived extension-keeping hidden slots,
 * and an interrupted write left unswept `.tmp-*` residue beside DB/XML
 * artifacts. One seam, one rule:
 *
 * - the temp sibling lives in the TARGET's directory (same-filesystem
 *   rename guarantee — never cross-device);
 * - the name is collision-proof (pid + uuid), hidden (leading dot);
 * - success renames tmp→target (rename(2) is atomic, never copy);
 * - ANY failure path unlinks the tmp — crash residue cannot accumulate.
 *
 * `withTempSibling` covers write-buffer flows (compute into tmp, swap in
 * on success). `tempSiblingPath` is the explicit staging form for
 * gate-flows (upgrade.ts) where the tmp is PRE-rename staging that must
 * survive across an arbitrary validation sequence.
 *
 * Non-goal by rule: `fulltags/src/writer.ts` `atomicOps` stays
 * AGENTS-sacred (ID3v2.3/mutagen/AIFF format-specific muxers).
 */

import {
  existsSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, extname, join } from "node:path";

/** Collision-proof hidden temp-sibling path beside `target`. Keeps the
 * extension when `keepExt` (muxers infer format from filenames). */
export function tempSiblingPath(
  target: string,
  opts?: { keepExt?: boolean },
): string {
  const dir = dirname(target);
  const base = basename(target);
  const ext = opts?.keepExt ? extname(target) : "";
  return join(dir, `.${base}.tmp-${process.pid}-${randomUUID()}${ext}`);
}

/** Synchronously run `fn` with a temp-sibling path beside `target`, then
 * atomically rename it over `target`. `fn` may skip the write (e.g. a
 * no-op detection) — a missing tmp makes the rename a no-op. Any throw
 * unlinks the tmp; a crash leaves at most one hidden residue file whose
 * mtime dates the interruption. Returns `fn`'s value. */
export function withTempSiblingSync<T>(
  target: string,
  fn: (tmpPath: string) => T,
  opts?: { keepExt?: boolean },
): T {
  const tmp = tempSiblingPath(target, opts);
  try {
    const result = fn(tmp);
    if (existsSync(tmp)) renameSync(tmp, target);
    return result;
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Write `content` to a temp sibling and atomically rename it over
 * `target` (mode preserved from the incumbent, 0644 for a fresh file).
 * The common form of the seam. */
export function atomicReplace(
  target: string,
  content: string | Uint8Array,
): void {
  withTempSiblingSync(target, (tmp) => {
    const mode = existsSync(target) ? statSync(target).mode : 0o644;
    writeFileSync(tmp, content, { mode });
  });
}
