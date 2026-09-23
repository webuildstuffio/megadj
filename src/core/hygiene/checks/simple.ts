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
import {
  baseFinding,
  type CheckCtx,
  type CheckDef,
  type Finding,
  type ShelfFile,
} from "../types";
import { isJunkName } from "../walk";

export const zeroByte: CheckDef = {
  kind: "zero-byte" as const,
  defaultSeverity: "likely" as const,
  detect(files: ShelfFile[], ctx: CheckCtx): Finding[] {
    const out: Finding[] = [];
    for (const f of files) {
      if (f.bytes !== 0) continue;
      out.push({
        ...baseFinding(ctx, "zero-byte", "likely", false),
        paths: [f.path],
        bytes: [0],
        md5s: [null],
        evidence: { sizeBytes: 0 },
        proposedAction: { type: "delete-corrupt" },
      });
    }
    return out;
  },
};

export const appledoubleJunk: CheckDef = {
  kind: "appledouble-junk" as const,
  defaultSeverity: "safe" as const,
  detect(files: ShelfFile[], ctx: CheckCtx): Finding[] {
    const out: Finding[] = [];
    for (const f of files) {
      if (!isJunkName(f.path.split("/").pop() ?? "")) continue;
      out.push({
        ...baseFinding(ctx, "appledouble-junk", "safe", true),
        paths: [f.path],
        bytes: [f.bytes],
        md5s: [null],
        evidence: { junk: true },
        proposedAction: { type: "clean-junk" },
      });
    }
    return out;
  },
};
