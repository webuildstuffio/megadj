/**
 * Check: orphan-audio (#37 slice 4) — a walked AUDIO file no master-DB
 * content row references, by exact pathKey OR by fingerprint (a moved
 * file the DB still knows under another path is stale-pointer's beat,
 * not an orphan — the claimed-set ordering at runChecks gives
 * stale-pointer first claim).
 *
 * This is an `info`-severity report, never an action: rekordbox is SSOT
 * for the collection, and the plan's rule for unreferenced audio is
 * fingerprint-proven import-or-ignore — a HUMAN decision. The finding
 * carries the fingerprint so the report can show "this file, this
 * hash, no row anywhere".
 *
 * Gate (ALL must hold):
 *   1. DB rows are available (no seam → nothing is an orphan — an
 *      honest gap, never a false positive storm);
 *   2. the file's pathKey matches NO row's FolderPath;
 *   3. the file's fingerprint matches NO row fingerprint (via the
 *      `fpOfRow` hook); when the file's own fingerprint is unavailable
 *      it is only reported if pathKey also missed — fp-unavailable +
 *      path-miss reports as orphan but flags `via: "path-only"` so the
 *      reader knows the proof is weaker.
 */
import { basename } from "node:path";
import {
  baseFinding,
  type CheckCtx,
  type CheckDef,
  type Finding,
  type ShelfFile,
} from "../types";

/** The name key: NFC + lowercase (the ONE comparison form for shelf
 *  paths — src/shared/name-key.ts's rule, inlined to keep this module
 *  leaf-of-leaf like its sibling checks). */
function nameKey(p: string): string {
  return p.normalize("NFC").toLowerCase();
}

export const orphanAudio: CheckDef = {
  kind: "orphan-audio",
  defaultSeverity: "info",
  detect(files: ShelfFile[], ctx: CheckCtx): Finding[] {
    if (ctx.dbRows === undefined) return [];
    const rows = ctx.dbRows();
    if (rows.length === 0) return []; // no seam → no orphans (honest gap)

    const rowPathKeys = new Set<string>(
      rows.filter((r) => r.folderPath).map((r) => nameKey(r.folderPath)),
    );
    const rowFps = new Set<string>(
      rows
        .map((r) => ctx.fpOfRow?.(r) ?? null)
        .filter((fp): fp is string => fp !== null),
    );

    const out: Finding[] = [];
    for (const f of files) {
      if (rowPathKeys.has(nameKey(f.path))) continue; // row references it
      const fp = ctx.fp(f.path, f.bytes);
      if (fp !== null && rowFps.has(fp)) continue; // known content, moved
      out.push(buildFinding(ctx, f, fp, fp === null));
    }
    return out;
  },
};

function buildFinding(
  ctx: CheckCtx,
  f: ShelfFile,
  fp: string | null,
  pathOnly: boolean,
): Finding {
  return {
    ...baseFinding(ctx, "orphan-audio", "info", false),
    paths: [f.path],
    bytes: [f.bytes],
    md5s: [null],
    fps: [fp],
    evidence: {
      fileName: basename(f.path),
      via: pathOnly ? "path-only" : "path+fp",
      note: pathOnly
        ? "no master-DB row references this path; fingerprint unavailable — weaker proof"
        : "no master-DB row references this path or its fingerprint",
    },
    proposedAction: { type: "info" },
    keeperPath: null,
  };
}
