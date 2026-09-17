/** Phase B seam for tests (ingest-pair.test.ts), moved to its own leaf
 *  (#211 — test-only export out of the command body): probe a folder's
 *  files and run the within-folder dedupe passes — no DB, no archive
 *  check. ingest.ts re-exports so the existing test import doesn't move. */
import { walkAudio, type Record_ } from "./ingest-probe";
import { probeAllFiles } from "./ingest-probe-files";
import { dedupeWithinFolder } from "./ingest-dedupe";

export async function dedupeWithinFolderForTest(
  folder: string,
  quarantineDir: string,
  dryRun: boolean | undefined,
  log: (msg: string) => void,
): Promise<{ survivors: Record_[]; dupes: number }> {
  const files = await walkAudio(folder, [], [quarantineDir]);
  const { records } = await probeAllFiles(files, log);
  const { survivors, folderDupes } = await dedupeWithinFolder(
    records,
    quarantineDir,
    dryRun,
    log,
  );
  return { survivors, dupes: folderDupes };
}
