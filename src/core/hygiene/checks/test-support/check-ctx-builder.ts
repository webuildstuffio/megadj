/**
 * Shared test fixture builder for slice-4 hygiene check tests (#37).
 * Deduplicates the ctx/file/row scaffolding across orphan-audio,
 * re-download, and stale-pointer tests.
 *
 * jscpd #223 — extracted to cut 2 test-internal clones (36L each).
 */
import type { CheckCtx, DbContentRow, ShelfFile } from "../../types";

const WALK_TOKEN = "tok-slice4";
const NOW = () => "2026-09-21T00:00:00.000Z";

export function checkCtx(
  rows: DbContentRow[],
  opts: {
    fpFor?: (path: string) => string | null;
    fpForRow?: (row: DbContentRow) => string | null;
  } = {},
): CheckCtx {
  const fpFor = opts.fpFor ?? ((p: string) => `fp:${p.normalize("NFC").toLowerCase()}`);
  const fpForRow = opts.fpForRow ?? ((r: DbContentRow) => `fp:${r.title}`);
  return {
    volume: "/Volumes/SHELF1",
    walkToken: WALK_TOKEN,
    md5: () => null,
    fp: (p) => fpFor(p),
    now: NOW,
    dbRows: () => rows,
    fpOfRow: (r) => fpForRow(r),
  };
}

export function shelfFile(path: string, bytes = 100): ShelfFile {
  return { path, bytes, mtimeMs: 0 };
}

export function dbRow(title: string, folderPath: string): DbContentRow {
  return { id: `1${Math.abs(title.length)}`, title, folderPath };
}
