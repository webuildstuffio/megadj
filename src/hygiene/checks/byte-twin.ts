/**
 * Check: byte-twin (§4.2) — same size + same md5 = the same file twice.
 * The ONLY severity-"safe" duplicate class: the loser has a byte-proven
 * twin, so quarantining it loses nothing (955 of the Sep 9 session's
 * 1,271 findings were this class). md5 runs at DETECT time on same-size
 * groups only — cheap and decisive, exactly the shelf-dupescan rule.
 */
import { basename } from "node:path";
import type { CheckCtx, CheckDef, Finding, ShelfFile } from "../types";
import { newFindingId } from "../types";
import { nameSimilarity } from "./similarity";

export const byteTwin: CheckDef = {
  kind: "byte-twin" as const,
  defaultSeverity: "safe" as const,
  detect(files: ShelfFile[], ctx: CheckCtx): Finding[] {
    const bySize = new Map<number, ShelfFile[]>();
    for (const f of files) {
      const arr = bySize.get(f.bytes);
      if (arr) arr.push(f);
      else bySize.set(f.bytes, [f]);
    }
    const out: Finding[] = [];
    const now = ctx.now();
    for (const group of bySize.values()) {
      if (group.length < 2) continue;
      const md5 = new Map<string, string | null>();
      const buckets = new Map<string, ShelfFile[]>();
      for (const f of group) {
        let h = md5.get(f.path);
        if (h === undefined) {
          h = ctx.md5(f.path);
          md5.set(f.path, h);
        }
        if (!h) continue; // unhashable → zero-byte check's territory
        const arr = buckets.get(h);
        if (arr) arr.push(f);
        else buckets.set(h, [f]);
      }
      for (const twins of buckets.values()) {
        if (twins.length < 2) continue;
        // keeper: shortest path wins ties (the "original" over the " (1)")
        twins.sort(
          (a, b) =>
            a.path.length - b.path.length || a.path.localeCompare(b.path),
        );
        const keeper = twins[0]!;
        for (const loser of twins.slice(1)) {
          out.push({
            id: newFindingId(),
            kind: "byte-twin",
            severity: "safe",
            status: "open",
            paths: [keeper.path, loser.path],
            bytes: [keeper.bytes, loser.bytes],
            md5s: [md5.get(keeper.path) ?? null, md5.get(loser.path) ?? null],
            fps: [],
            evidence: {
              nameSimilarity: nameSimilarity(
                basename(keeper.path),
                basename(loser.path),
              ),
            },
            proposedAction: { type: "quarantine-loser" },
            keeperPath: keeper.path,
            walkToken: ctx.walkToken,
            autoSafe: true,
            createdAt: now,
            decidedAt: null,
            appliedAt: null,
            validation: null,
          });
        }
      }
    }
    return out;
  },
};
