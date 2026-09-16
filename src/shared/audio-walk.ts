/**
 * audio-walk.ts — the audio collect pass (issue #142), now a thin
 * ext-gated wrapper over THE walker (#69, src/shared/walk-tree.ts).
 *
 * Four walkers used to re-roll the same traversal with live drift
 * (Sep 15 audit): ingest-probe's local copy skipped dotfiles but not
 * AppleDouble `._` files and its private extension set missed
 * ogg/opus/aac/alac; fulltags writer's walker shipped the stale
 * six-format set into fetch/audit; rb-fix-paths re-rolled both. A file
 * one walker saw and another didn't means dedupe/fix/index disagree
 * about what exists — the #69 drift class, one level up.
 *
 * The rule: ONE traversal (walk-tree.ts); this module adds only the
 * audio filter (AUDIO_EXTS SSOT) and the list-of-paths shape its
 * callers speak. Sync on purpose: callers are short CLI passes; for
 * server/event-loop contexts use cratedeck's async walkTree instead.
 */
import { AUDIO_EXTS } from "./audio-exts";
import { walkTree, type WalkTreeOptions } from "./walk-tree";

/** Options this module forwards to the walker: everything except the
 * audio extension filter, which is the SSOT enforced HERE. */
export type WalkAudioOptions = Omit<WalkTreeOptions, "exts">;

export function walkAudioDir(
  dir: string,
  out: string[] = [],
  opts?: WalkAudioOptions,
): string[] {
  const res = walkTree(dir, { ...opts, exts: AUDIO_EXTS });
  for (const u of res.unreadable) {
    // keep the one visible stderr note the missing-intake-folder path
    // printed (ingest's `megadj ingest <typoed-path>` must fail soft,
    // not silently): the boundary surfaces once per unreadable dir.
    console.error(`walk: directory not found: ${u}`);
  }
  for (const e of res.entries) out.push(e.abs);
  return out;
}
