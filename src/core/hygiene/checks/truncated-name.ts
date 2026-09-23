/**
 * Check: truncated-name (#9 / #37 slice 3) — an exFAT copy merged long
 * filenames, so the shelf holds names chopped mid-word ("...eric prydz
 * rem-3.wav") while the rekordbox master DB references the full title.
 * The finding proposes the same-directory rename that restores the
 * canonical name; the DB row's path keeps resolving through it (dirname
 * unchanged), so no relink is needed — but the human confirms, because a
 * wrong rename mislabels a real track.
 *
 * Evidence = rb-fix-paths' proven prefix20 ladder, not fingerprints: the
 * DB row's path is DEAD by definition (its file is only on disk under
 * the truncated name), so there is nothing to fpcalc on the row side.
 * The name here is not twin-reconciliation (that stays fp/ear-gated —
 * AGENTS.md) but a relabel to the title the DB itself asserts, and the
 * rename is reversible, human-gated (`review`), and has no executor in
 * applyFinding — nothing moves without a person.
 *
 * Gate (all must hold):
 *   1. the row's FolderPath is NOT in the walk (its path is dead);
 *   2. same directory (nameKey) — the rename stays same-dir, so the DB
 *      row keeps resolving through it;
 *   3. prefix20: nameKey(rowName)[:20] === nameKey(diskName)[:20] — the
 *      exact rb-fix-paths-index key that already disambiguates this
 *      truncation class on live drives;
 *   4. the row's basename is STRICTLY longer — case/extension-only
 *      differences never fire.
 *
 * DB rows arrive through the injectable `dbRows` ctx hook (the
 * pyrekordbox seam in shelf-hygiene supplies the real one; tests inject
 * rows directly) — the check itself stays pure and offline-testable.
 */
import { basename, dirname, join } from "node:path";
import {
  baseFinding,
  type CheckCtx,
  type CheckDef,
  type DbContentRow,
  type Finding,
  type ShelfFile,
} from "../types";

export type { DbContentRow } from "../types";

/** The prefix20 key length — aliased to rb-fix-paths' ladder constant
 *  (one truncation class, one key length). */
export const PREFIX20_LEN = 20;

/** The name key: NFC + lowercase (the ONE comparison form for shelf
 *  paths — src/shared/name-key.ts's rule, inlined to keep this module
 *  leaf-of-leaf like its sibling checks). */
function nameKey(p: string): string {
  return p.normalize("NFC").toLowerCase();
}

export const truncatedName: CheckDef = {
  kind: "truncated-name",
  defaultSeverity: "review",
  detect(files: ShelfFile[], ctx: CheckCtx): Finding[] {
    const rows = ctx.dbRows?.() ?? [];
    if (rows.length === 0) return []; // no DB seam → nothing to reconcile

    const walked = new Set(files.map((f) => nameKey(f.path)));
    const candidates = rows
      .filter((r) => r.folderPath && !walked.has(nameKey(r.folderPath)))
      .map((r) => ({ row: r, dir: nameKey(dirname(r.folderPath)) }));
    if (candidates.length === 0) return [];

    const out: Finding[] = [];
    for (const f of files) {
      const dir = nameKey(dirname(f.path));
      const diskNameKey = nameKey(basename(f.path));
      for (const c of candidates) {
        if (c.dir !== dir) continue; // same dir only — same-dir rename
        const rowNameKey = nameKey(basename(c.row.folderPath));
        const rowName = basename(c.row.folderPath);
        // prefix20: the rb-fix-paths ladder key (rule 3), then rule 4 —
        // the DB name must be strictly LONGER (something was cut).
        const cut =
          diskNameKey.length > PREFIX20_LEN - 1 && // short names can't cut
          rowNameKey.slice(0, PREFIX20_LEN) ===
            diskNameKey.slice(0, PREFIX20_LEN) &&
          rowName.length > basename(f.path).length;
        if (!cut) continue;
        out.push(buildFinding(ctx, f, c.row));
        break; // first confident row wins — one proposal per file
      }
    }
    return out;
  },
};

function buildFinding(ctx: CheckCtx, f: ShelfFile, row: DbContentRow): Finding {
  const ext = (basename(f.path).match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
  const to = join(dirname(f.path), `${row.title}${ext}`);
  return {
    ...baseFinding(ctx, "truncated-name", "review", false),
    paths: [f.path],
    bytes: [f.bytes],
    md5s: [null],
    fps: [],
    evidence: {
      dbRowId: row.id,
      dbTitle: row.title,
      dbPath: row.folderPath,
      truncatedName: basename(f.path),
      proposedName: basename(to),
      via: "prefix20",
    },
    proposedAction: { type: "rename", to },
    keeperPath: null,
  };
}
