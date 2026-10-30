/**
 * artwork-repair — extract embedded artwork from audio files to PIONEER/Artwork/.
 *
 * Runs as a post-step after rb-import and any rb-* write that may have
 * left artwork files missing. Safe to run while rekordbox is open — no
 * DB writes, only disk writes (artwork JPEGs).
 *
 * Root cause (Oct 29 2026): 66 tracks had ImagePath set in master.db
 * pointing to non-existent artwork directories. The embedded cover art
 * existed in the audio files but was never extracted to RB's directory
 * structure. This happened during the SHELF1→GREY FIKWOK drive rename.
 *
 * RB needs THREE files per artwork directory (pilot-verified 2026-09-04):
 *   artwork.jpg   — full-size
 *   artwork_m.jpg — 250px thumbnail
 *   artwork_s.jpg — 125px thumbnail
 * A directory with only the full-size artwork.jpg silently shows blank art.
 */

import { spawnSync } from "node:child_process";
import { parseJsonBoundary } from "./rb-command-kit.js";
import { PYRK_TAG } from "./rb-playlist-scripts.js";
import { pyUvFileArgv } from "./rb-python-file.js";

interface ArtworkRepairResult {
  total_missing: number;
  extracted: number;
  no_embed: number;
  no_audio: number;
  failed: number;
  apply: boolean;
  ok?: boolean;
}

/**
 * Scan master.db for tracks whose ImagePath points to a missing file,
 * then extract embedded artwork from the audio file and write it to the
 * RB artwork directory with all three sizes.
 *
 * Returns the repair result. Never throws — failures are counted, not fatal.
 */
export function repairArtwork(dbPath: string, mount: string): ArtworkRepairResult {
  const mountPoint = mount.startsWith("/Volumes/") ? mount : `/Volumes/${mount}`;
  const argv = pyUvFileArgv({
    file: "artwork-extract.kit.py",
    args: [dbPath, mountPoint, "apply"],
    withPkg: `${PYRK_TAG} mutagen Pillow`,
  });

  const result = spawnSync("uv", argv, { stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim() ?? "";
    console.error(`artwork-repair: kit exited ${result.status}${stderr ? `: ${stderr}` : ""}`);
    return { total_missing: 0, extracted: 0, no_embed: 0, no_audio: 0, failed: 1, apply: true };
  }

  try {
    return parseJsonBoundary(result.stdout.toString(), "artwork-extract") as ArtworkRepairResult;
  } catch {
    return {
      total_missing: 0,
      extracted: 0,
      no_embed: 0,
      no_audio: 0,
      failed: 1,
      apply: true,
      ok: false as const,
    };
  }
}
