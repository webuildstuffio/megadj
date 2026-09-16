/**
 * audio-walk.ts — THE sync audio-directory walker (issue #142).
 *
 * Four walkers re-rolled the same traversal with live drift (Sep 15
 * audit): ingest-probe's local copy skipped dotfiles but not
 * AppleDouble `._` files and its private extension set missed
 * ogg/opus/aac/alac; fulltags writer's walker shipped the stale
 * six-format set into fetch/audit; rb-fix-paths re-rolled both. A file
 * one walker saw and another didn't means dedupe/fix/index disagree
 * about what exists — the #69 drift class, one level up.
 *
 * The rule: ONE walker for every "collect the audio under a directory"
 * pass. Soft-fails on unreadable/missing dirs (callers treat an absent
 * music dir as empty — a typoed path must not crash the pass), skips
 * dotfiles and AppleDouble `._` junk, filters through the AUDIO_EXTS
 * SSOT. Sync on purpose: callers are short CLI passes; for server /
 * event-loop contexts use cratedeck's async walkTree instead.
 */

import { readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { AUDIO_EXTS, audioExt } from "./audio-exts";

export function walkAudioDir(dir: string, out: string[] = []): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue; // dotfiles + `._` AppleDouble
    const full = join(dir, ent.name);
    if (ent.isDirectory()) walkAudioDir(full, out);
    else if (AUDIO_EXTS.has(audioExt(ent.name))) out.push(full);
  }
  return out;
}
