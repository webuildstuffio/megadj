/**
 * Check: stale-pointer (#37 slice 4) — a master-DB content row whose
 * FolderPath is GONE from the disk walk while a same-fingerprint file
 * exists ELSEWHERE on the shelf (moved/renamed outside rekordbox). The
 * finding surfaces both paths so the human can relink in rekordbox (or
 * confirm the move); it never rewrites anything itself (`review`, no
 * executor in applyFinding).
 *
 * Gate (ALL must hold):
 *   1. the row's FolderPath is not in the walk (its path is dead);
 *   2. a walked file matches by fingerprint (fp equality — never name
 *      alone; AGENTS.md: twins are judged by fingerprint, not name);
 *   3. that file is not already claimed by an earlier finding (claimed
 *      set bookkeeping happens at the runChecks layer; here we only
 *      emit one proposal per dead row).
 *
 * When no fingerprint is available for a candidate file (fp cache cold
 * and fpcalc failed) the check stays silent for that pair — an honest
 * gap, never a name-based guess.
 *
 * DB rows arrive through the injectable `dbRows` ctx hook (the
 * pyrekordbox seam in shelf-hygiene supplies the real one; tests inject
 * rows directly) — the check stays pure and offline-testable. Without
 * `dbRows` OR an `fpOfRow` hook it detects nothing (an honest gap).
 *
 * The row side has no on-disk file to fingerprint, so row fingerprints
 * come from the injectable `fpOfRow` ctx hook (shelf-hygiene joins the
 * rb-adopt mirror's stored fingerprint; tests inject). Absent hook →
 * the check detects nothing.
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

export const stalePointer: CheckDef = {
  kind: "stale-pointer",
  defaultSeverity: "review",
  detect: (files: ShelfFile[], ctx: CheckCtx): Finding[] => {
    if (ctx.dbRows === undefined || ctx.fpOfRow === undefined) return [];
    const rows = ctx.dbRows();
    if (rows.length === 0 || files.length === 0) return [];

    // walked paths by nameKey → the disk truth
    const walkedByKey = new Map<string, ShelfFile>();
    for (const f of files) walkedByKey.set(nameKey(f.path), f);

    // fingerprint → walked files (fp equality is the ONLY match rule)
    const byFp = new Map<string, ShelfFile>();
    for (const f of files) {
      const fp = ctx.fp(f.path, f.bytes);
      if (fp === null) continue;
      const existing = byFp.get(fp);
      if (existing === undefined) byFp.set(fp, f);
    }
    if (byFp.size === 0) return [];

    // Scope gate (mirrors re-download): a row whose FolderPath lives on
    // another drive was never a shelf tenant — its "moved elsewhere" story
    // is unknowable from this walk. Out-of-volume rows are out of scope.
    const volumePrefix = `${ctx.volume}/`;
    const out: Finding[] = [];
    const seenFiles = new Set<string>();
    for (const row of rows) {
      if (!row.folderPath) continue;
      if (!row.folderPath.startsWith(volumePrefix)) continue; // other drive
      if (walkedByKey.has(nameKey(row.folderPath))) continue; // path alive
      const rowFp = ctx.fpOfRow(row);
      if (rowFp === null) continue; // honest gap: no fp, no match
      const match = byFp.get(rowFp);
      if (match === undefined) continue; // genuinely gone (re-download's beat)
      if (seenFiles.has(match.path)) continue; // one proposal per file
      seenFiles.add(match.path);
      out.push(buildFinding(ctx, row, match));
    }
    return out;
  },
};

function buildFinding(
  ctx: CheckCtx,
  row: DbContentRow,
  match: ShelfFile,
): Finding {
  return {
    ...baseFinding(ctx, "stale-pointer", "review", false),
    paths: [match.path],
    bytes: [match.bytes],
    md5s: [null],
    fps: [ctx.fp(match.path, match.bytes)],
    evidence: {
      dbRowId: row.id,
      dbTitle: row.title,
      dbPath: row.folderPath,
      foundAt: match.path,
      via: "fingerprint",
    },
    proposedAction: { type: "info" },
    keeperPath: null,
  };
}
