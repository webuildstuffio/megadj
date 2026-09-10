/**
 * Check: acoustic-twin (§4.2) — same chromaprint fingerprint, different
 * bytes. fp-equal is STRONG evidence of the same recording but NOT of the
 * same file (long-mix collisions §3.2, re-encodes) — so severity is
 * "likely", autoSafe is false, and the human gate is mandatory: the UI
 * shows a quality compare and the user picks the keeper.
 *
 * Priority: runs AFTER byte-twin; a loser already claimed as a byte-twin
 * is not re-reported here (claimed-set short-circuit at the call site).
 */
import { basename } from "node:path";
import type { CheckCtx, Finding, ShelfFile } from "../types";
import { newFindingId } from "../types";
import { nameSimilarity } from "./similarity";

/** Long-mix collision guard: fp-equal + wildly different durations are a
 *  different recording that happened to collide — reported at "review"
 *  severity with a note instead of "likely". Duration ≈ bytes/bitrate,
 *  so a same-bytes group never trips this; only genuinely different
 *  lengths (>15% delta) do. */
function durationDelta(a: ShelfFile, b: ShelfFile): number {
  const lo = Math.min(a.bytes, b.bytes);
  const hi = Math.max(a.bytes, b.bytes);
  return hi === 0 ? 0 : (hi - lo) / hi;
}

export const acousticTwin = {
  kind: "acoustic-twin" as const,
  defaultSeverity: "likely" as const,
  detect(files: ShelfFile[], ctx: CheckCtx): Finding[] {
    const byFp = new Map<string, ShelfFile[]>();
    for (const f of files) {
      const fp = ctx.fp(f.path, f.bytes);
      if (!fp) continue; // fpcalc failed/missing → never reported
      const arr = byFp.get(fp);
      if (arr) arr.push(f);
      else byFp.set(fp, [f]);
    }
    const out: Finding[] = [];
    const now = ctx.now();
    for (const [fp, group] of byFp) {
      if (group.length < 2) continue;
      // keeper = biggest (lossless-leaning proxy inside one recording)
      group.sort((a, b) => b.bytes - a.bytes);
      const keeper = group[0]!;
      for (const loser of group.slice(1)) {
        const sim = nameSimilarity(basename(keeper.path), basename(loser.path));
        const bigDelta = durationDelta(keeper, loser) > 0.15;
        out.push({
          id: newFindingId(),
          kind: "acoustic-twin",
          severity: bigDelta ? "review" : "likely",
          status: "open",
          paths: [keeper.path, loser.path],
          bytes: [keeper.bytes, loser.bytes],
          md5s: [null, null], // different bytes by definition of this class
          fps: [fp, fp],
          evidence: {
            nameSimilarity: sim,
            sizeDeltaBytes: keeper.bytes - loser.bytes,
            ...(bigDelta
              ? { note: "size delta >15% — possible fp collision" }
              : {}),
          },
          proposedAction: { type: "quarantine-loser" },
          keeperPath: keeper.path,
          walkToken: ctx.walkToken,
          autoSafe: false, // ALWAYS human-gated (§4.2: required review)
          createdAt: now,
          decidedAt: null,
          appliedAt: null,
          validation: null,
        });
      }
    }
    return out;
  },
};
