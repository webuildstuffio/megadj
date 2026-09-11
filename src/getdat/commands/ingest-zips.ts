/**
 * zips.ts — zip expansion for `megadj ingest`.
 *
 * Extracts every *.zip in the folder (ditto, handles __MACOSX junk),
 * stages audio files next to the zip, and tracks which zip each staged
 * file came from. The zip is deleted only after EVERY file staged from it
 * has left the source folder (i.e. was moved into the archive or
 * quarantined as a dupe) — nothing is deleted on partial failure.
 */
import { $ } from "bun";
import { readdir, stat, mkdir, rename, copyFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, basename, extname } from "node:path";

/** zip path → basenames staged from it. */
export const pendingZipDeletes = new Map<string, string[]>();

async function md5File(path: string): Promise<string> {
  const hash = createHash("md5");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function expandZips(
  folder: string,
  dryRun: boolean | undefined,
  walkAudio: (dir: string) => Promise<string[]>,
  log: (m: string) => void,
): Promise<void> {
  let zips: string[] = [];
  try {
    zips = (await readdir(folder, { withFileTypes: true }))
      .filter(
        (e) =>
          e.isFile() &&
          !e.name.startsWith(".") &&
          extname(e.name).toLowerCase() === ".zip",
      )
      .map((e) => join(folder, e.name));
  } catch {
    return;
  }
  for (const zip of zips) {
    const stage = join(
      folder,
      `.megadj-zip-${basename(zip, ".zip")}-${Date.now()}`,
    );
    log(`zip: ${basename(zip)}`);
    if (dryRun) {
      log(`  [zip] would extract + ingest (delete zip on success)`);
      continue;
    }
    try {
      await mkdir(stage, { recursive: true });
      const un = await $`ditto -x -k ${zip} ${stage}`.quiet().nothrow();
      if (un.exitCode !== 0) {
        log(`  ✗ zip extract failed — left in place: ${basename(zip)}`);
        continue;
      }
      const inner = await walkAudio(stage);
      log(`  ${inner.length} audio file(s) inside`);
      if (inner.length === 0) {
        log(`  ~ no audio in zip — left in place`);
        continue;
      }
      // move audio up next to the zip so the normal pipeline picks it up.
      // Collision-safe: same-basename files (multi-CD rips: "CD1/01 - x.mp3",
      // "CD2/01 - x.mp3") must BOTH survive — silently overwriting or
      // dropping one, then deleting the zip, is permanent content loss.
      const stagedNames: string[] = [];
      for (const f of inner) {
        let dest = join(folder, basename(f));
        if (existsSync(dest)) {
          const a = await stat(f);
          const b = await stat(dest);
          if (
            a.size === b.size &&
            (await md5File(f)) === (await md5File(dest))
          ) {
            log(`  ~ identical dupe, dropped: ${basename(f)}`);
            continue; // identical dupe — drop
          }
          // different content, same name: never overwrite — disambiguate
          const ext = extname(dest);
          const stem = basename(dest, ext);
          let n = 1;
          do {
            dest = join(folder, `${stem} [zip-${n++}]${ext}`);
          } while (existsSync(dest));
          log(`  ~ name collision, staging as: ${basename(dest)}`);
        }
        try {
          await rename(f, dest);
        } catch {
          await copyFile(f, dest);
        }
        stagedNames.push(basename(dest));
      }
      await $`rm -rf ${stage}`.quiet().nothrow();
      pendingZipDeletes.set(zip, stagedNames);
    } catch {
      log(`  ✗ zip error, left in place: ${basename(zip)}`);
      await $`rm -rf ${stage}`.quiet().nothrow();
    }
  }
}

/**
 * Delete zips whose every staged file has left the source folder
 * (moved into the archive — any batch subfolder, or the root — or
 * quarantined). Returns log lines.
 */
export async function deleteFullyIngestedZips(
  folder: string,
  musicDir: string,
  quarantineDir: string,
  log: (m: string) => void,
): Promise<void> {
  // Batch subfolders (`<YYYY-MM-DD slug>/`) are where ingest lands files
  // now; a zip is only fully ingested when its staged files are SOMEWHERE
  // under the archive (or quarantined) — not just at the archive root.
  const archiveBatches = existsSync(musicDir)
    ? (await readdir(musicDir, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => join(musicDir, e.name))
        .concat(musicDir)
    : [musicDir];
  for (const [zip, staged] of pendingZipDeletes) {
    // A zip that staged NOTHING is not "fully ingested" — it means staging
    // collapsed to dupes or was skipped; deletion here would be vacuous
    // ([].every === true). Keep the zip; the human can decide.
    if (staged.length === 0) {
      log(`zip kept (no files were staged from it): ${basename(zip)}`);
      continue;
    }
    const allHandled = staged.every(
      (name) =>
        !existsSync(join(folder, name)) &&
        (archiveBatches.some((dir) => existsSync(join(dir, name))) ||
          existsSync(join(quarantineDir, name))),
    );
    if (allHandled) {
      const del = await $`rm -f ${zip}`.quiet().nothrow();
      log(
        del.exitCode === 0
          ? `zip ✓ fully ingested — removed: ${basename(zip)}`
          : `zip ✓ fully ingested (zip delete failed): ${basename(zip)}`,
      );
    } else {
      log(`zip kept (some files not fully ingested): ${basename(zip)}`);
    }
  }
  pendingZipDeletes.clear();
}
