/**
 * Checks: zero-byte + appledouble-junk (§4.2) — the walk-time flags.
 *
 * zero-byte: size 0 or unhashable. Auto-flagged, user CONFIRMS the
 * delete — they may want to re-download instead (Trap §3.5: os.remove
 * destroyed "Eat Me Better"; the fix is quarantine-first, always).
 *
 * appledouble-junk: `._` AppleDouble forks + .DS_Store that appear as
 * real files when the walk is pointed at a directory containing them
 * (walkShelf filters them; this check exists for the quarantine audit
 * path where the input is an arbitrary file list). Auto-clean severity.
 */
import type { CheckCtx, Finding, ShelfFile } from "../types";
import { newFindingId } from "../types";
import { isJunkName } from "../walk";

export const zeroByte = {
  kind: "zero-byte" as const,
  defaultSeverity: "likely" as const,
  detect(files: ShelfFile[], ctx: CheckCtx): Finding[] {
    const out: Finding[] = [];
    const now = ctx.now();
    for (const f of files) {
      if (f.bytes !== 0) continue;
      out.push({
        id: newFindingId(),
        kind: "zero-byte",
        severity: "likely",
        status: "open",
        paths: [f.path],
        bytes: [0],
        md5s: [null],
        fps: [],
        evidence: { sizeBytes: 0 },
        proposedAction: { type: "delete-corrupt" },
        keeperPath: null,
        walkToken: ctx.walkToken,
        autoSafe: false, // user confirms — may re-download instead
        createdAt: now,
        decidedAt: null,
        appliedAt: null,
        validation: null,
      });
    }
    return out;
  },
};

export const appledoubleJunk = {
  kind: "appledouble-junk" as const,
  defaultSeverity: "safe" as const,
  detect(files: ShelfFile[], ctx: CheckCtx): Finding[] {
    const out: Finding[] = [];
    const now = ctx.now();
    for (const f of files) {
      if (!isJunkName(f.path.split("/").pop() ?? "")) continue;
      out.push({
        id: newFindingId(),
        kind: "appledouble-junk",
        severity: "safe",
        status: "open",
        paths: [f.path],
        bytes: [f.bytes],
        md5s: [null],
        fps: [],
        evidence: { junk: true },
        proposedAction: { type: "clean-junk" },
        keeperPath: null,
        walkToken: ctx.walkToken,
        autoSafe: true,
        createdAt: now,
        decidedAt: null,
        appliedAt: null,
        validation: null,
      });
    }
    return out;
  },
};
