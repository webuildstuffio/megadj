/**
 * similarity.ts — the ONE name-similarity helper for hygiene checks.
 *
 * Two regimes, both proven in the Sep 9 session (§3.4: "edit distance is
 * a trap" — Belly/Nelly, Cassian/Kassian are different artists):
 * - nameSimilarity: normalized-levenshtein ratio for FILE names, where a
 *   typo twin ("song-1.mp3") still scores high. Threshold ≥0.5.
 * - nameSimilarityTokens: shared-token ratio for FOLDER/artist names,
 *   where separator flips ("ANOTR x 54" vs "ANOTR, 54") must score 1.0
 *   but edit distance would too ("Akn" vs "Ama" scores high on levenshtein
 *   — exactly the trap). Threshold ≥0.5, and only token-equality + a
 *   human confirm ever merges folders.
 */

/** Normalized levenshtein ratio 0..1 (1 = identical). O(n·m) on short
 *  basename strings only — files, never folder walks. */
export function nameSimilarity(a: string, b: string): number {
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const x = norm(a);
  const y = norm(b);
  if (x === y) return 1;
  if (x.length === 0 || y.length === 0) return 0;
  // normalized levenshtein over short basenames only (files, never walks)
  const m = x.length;
  const n = y.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(
        dp[j]! + 1,
        dp[j - 1]! + 1,
        prev + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return (2 * (m + n - dp[n]!)) / (m + n);
}

/** Shared-token ratio over token sets (folders/artist folders). 1.0 when
 *  both names reduce to the same token set regardless of separators or
 *  order. Unicode-hyphen safe (folded by the [^a-z0-9] split). */
export function nameSimilarityTokens(a: string, b: string): number {
  const norm = (s: string): string[] =>
    s
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  const at = new Set(norm(a));
  const bt = new Set(norm(b));
  if (at.size === 0 || bt.size === 0) return 0;
  if (at.size === bt.size && [...at].every((t) => bt.has(t))) return 1;
  let shared = 0;
  for (const t of at) if (bt.has(t)) shared++;
  return shared / Math.max(at.size, bt.size);
}
