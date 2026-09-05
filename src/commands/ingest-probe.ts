/**
 * Ingest probe/parse helpers — thin shims over FullTags (fulltags/src/probes.ts).
 * What stays here is ingest-specific orchestration that FullTags doesn't own:
 * quarantine (dupe handling) and walkAudio (intake-folder traversal).
 */
import { basename, join } from "node:path";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rename } from "node:fs/promises";

export {
  parseFilename,
  probeFile,
  qualityScore,
  firstTag,
  mbRecording,
} from "../../fulltags/src/exports";
import type { ParsedName, Probe } from "../../fulltags/src/exports";
export type { ParsedName, Probe };

/** One intake candidate: file + probe + parse + dedupe keys. */
export interface Record_ {
  file: string;
  size: number;
  probe: Probe;
  parsed: ParsedName;
  identity: string;
  score: number;
}

/** Move a duplicate out of the intake folder (never deletes audio). */
export async function quarantine(
  file: string,
  quarantineDir: string,
  dryRun: boolean | undefined,
  log: (m: string) => void,
): Promise<void> {
  if (dryRun) {
    log(`  [dupe] would quarantine: ${basename(file)}`);
    return;
  }
  await mkdir(quarantineDir, { recursive: true });
  const dest = join(quarantineDir, basename(file));
  if (!existsSync(file)) {
    log(`  [dupe] already gone (handled earlier): ${basename(file)}`);
    return;
  }
  try {
    await rename(file, dest);
  } catch {
    await copyFile(file, dest); // cross-device fallback; original left in place
  }
}

/** Recursively list audio files under `dir`, skipping hidden entries. */
export async function walkAudio(
  dir: string,
  out: string[] = [],
  skip?: string[],
): Promise<string[]> {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (skip?.some((s) => full === s || full.startsWith(s + "/"))) continue;
      await walkAudio(full, out, skip);
    } else if (AUDIO_EXTS.has(ent.name.replace(/^.*\./, ".").toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

const AUDIO_EXTS = new Set([".m4a", ".mp3", ".wav", ".flac", ".aiff", ".aif"]);
