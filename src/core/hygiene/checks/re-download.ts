/**
 * Check: re-download (#37 slice 4) — content the DB says exists (a real
 * master-DB row) whose file is GONE from the shelf AND whose fingerprint
 * matches nothing on disk. Unlike stale-pointer (the content moved —
 * relink), this is the "gone for good" class: the plan's recovery is a
 * ready `yt-dlp` command (the #11 "Eat Me Better" case), surfaced with
 * a copy-able query. The finding is `review`, `info` action — nothing
 * downloads without a person.
 *
 * Gate (ALL must hold):
 *   1. DB rows available (no seam → nothing is re-downloadable — an
 *      honest gap, never noise);
 *   2. the row's FolderPath is not in the walk (path dead);
 *   3. the row's fingerprint (via `fpOfRow`) is null OR matches no
 *      walked file — a fingerprint match means it MOVED (stale-pointer's
 *      beat), not that it vanished;
 *   4. the row's title is non-empty — the yt-dlp query is built from
 *      the DB's own assertion (artist/title when parsable), never a
 *      filename guess.
 *
 * Dedup vs the repo's acquisition rules: the finding PROPOSES a query;
 * it never spawns yt-dlp, and it records the ledger decision ("gone")
 * untouched — `megadj sync` stays the only downloader.
 */
import {
  baseFinding,
  type CheckCtx,
  type CheckDef,
  type DbContentRow,
  type Finding,
  type ShelfFile,
} from "../types";

/** The name key: NFC + lowercase (the ONE comparison form for shelf
 *  paths — src/shared/name-key.ts's rule, inlined to keep this module
 *  leaf-of-leaf like its sibling checks). */
function nameKey(p: string): string {
  return p.normalize("NFC").toLowerCase();
}

export const reDownload: CheckDef = {
  kind: "re-download",
  defaultSeverity: "review",
  detect(files: ShelfFile[], ctx: CheckCtx): Finding[] {
    if (ctx.dbRows === undefined) return [];
    const rows = ctx.dbRows();
    if (rows.length === 0) return [];
    const walkedKeys = new Set(files.map((f) => nameKey(f.path)));
    const walkedFps = new Set(
      files
        .map((f) => ctx.fp(f.path, f.bytes))
        .filter((fp): fp is string => fp !== null),
    );

    // Scope gate: a row whose FolderPath lives OUTSIDE this walk's volume
    // (the playing USB, another mounted drive) is not "gone" — it was never
    // on the walked shelf. Flagging it re-downloadable would be a false
    // positive the ledger can never satisfy. Only rows under the walk
    // volume participate.
    const volumePrefix = `${ctx.volume}/`;
    const out: Finding[] = [];
    for (const row of rows) {
      if (!row.folderPath || !row.title) continue;
      if (!row.folderPath.startsWith(volumePrefix)) continue; // other drive
      if (walkedKeys.has(nameKey(row.folderPath))) continue; // file alive
      const rowFp = ctx.fpOfRow?.(row) ?? null;
      if (rowFp !== null && walkedFps.has(rowFp)) continue; // moved, not gone
      out.push(buildFinding(ctx, row));
    }
    return out;
  },
};

function buildFinding(ctx: CheckCtx, row: DbContentRow): Finding {
  return {
    ...baseFinding(ctx, "re-download", "review", false),
    paths: [row.folderPath],
    bytes: [0], // the row's content is off-disk — zero walked bytes by definition
    md5s: [null],
    fps: [ctx.fpOfRow?.(row) ?? null],
    evidence: {
      dbRowId: row.id,
      dbTitle: row.title,
      dbPath: row.folderPath,
      query: row.title,
      via: "db-row-gone",
    },
    proposedAction: { type: "re-download", query: row.title },
    keeperPath: null,
  };
}
