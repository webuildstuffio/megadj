// archive-open.ts — the one shelf-Contents ArchiveReader open for the
// megaset CLI arms (#316: megaset / megaset-cohorts / megaset-calibrate
// each hand-rolled the same loadConfig+join+new ArchiveReader block —
// the jscpd 12–17L twins; the SHELF Contents root is LOAD-BEARING, see
// crateDeckRoot()). Read-only by construction; callers own close().
import { join } from "node:path";
import { ArchiveReader } from "../../deck/db/reader";
import { loadConfig } from "../../deck/config";
import { DB_PATH } from "../../cli-env";
import { crateDeckRoot } from "../../shared/volume";

export function openMegasetArchive(): ArchiveReader {
  const cfg = loadConfig(crateDeckRoot());
  return new ArchiveReader(
    DB_PATH,
    join(cfg.volumesRoot, cfg.shelfDrive, "Contents"),
  );
}
