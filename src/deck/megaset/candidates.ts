// megaset/candidates.ts — S14 (#288): N-candidates compare mode.
//
// Runs the engine N times with different seeds (opener rotation +
// strategy alternation). Each candidate is a full MegasetResult labeled
// with its seed + a human-readable label. Same seed always reproduces
// the same chain (determinism law, v3 §9).
//
// Pure function: no I/O, no ledger reads — the callers (API route, CLI)
// own the pool query and pass the same candidates array to each build.
import { buildMegaset, type MegasetInput } from "./engine";
import { setQuality } from "./set-quality";
import type { MegasetQuality, MegasetResult } from "../shared/megaset";

/** One labeled variant from the N-candidates run. */
export interface MegasetVariant {
  /** The seed that produced this variant (0 = default). */
  seed: number;
  /** Human label: "A" for seed 0, "B" for seed 1, etc. */
  label: string;
  /** Full engine result. */
  result: MegasetResult;
  /** Quality breakdown (same pure function as M4). */
  quality: MegasetQuality;
}

/** Maximum variants per run — beyond ~8 the opener pool wraps and
 *  strategy alternation repeats, so more variants add no variety. */
export const MAX_CANDIDATES = 8;

/** Minimum candidates (1 = the default single-build mode). */
export const MIN_CANDIDATES = 1;

const seedLabel = (seed: number): string =>
  String.fromCodePoint(65 + (seed % 26));

/** Build N variants from the same pool. Each variant uses a different
 *  seed (opener rotation + strategy flip on odd seeds). The input's
 *  `openerId` and `searchOverride` pin those axes — seeded jitter only
 *  applies to dimensions NOT explicitly pinned by the caller.
 *
 *  Returns variants sorted by quality (best first). */
export function buildMegasetCandidates(
  input: MegasetInput,
  n: number,
): MegasetVariant[] {
  const count = Math.max(
    MIN_CANDIDATES,
    Math.min(MAX_CANDIDATES, Math.round(n)),
  );
  const variants: MegasetVariant[] = [];
  for (let seed = 0; seed < count; seed++) {
    const result = buildMegaset({ ...input, seed });
    const quality = setQuality(result);
    variants.push({ seed, label: seedLabel(seed), result, quality });
  }
  variants.sort((a, b) => b.quality.total - a.quality.total);
  return variants;
}
