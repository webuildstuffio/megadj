/**
 * Pure vector similarity shared by the archive engine and CrateDeck.
 *
 * This module is intentionally dependency-free: both sides of the archive
 * boundary can import it without pulling application code across that boundary.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let index = 0; index < a.length; index++) {
    const aValue = a[index]!;
    const bValue = b[index]!;
    dot += aValue * bValue;
    aNorm += aValue * aValue;
    bNorm += bValue * bValue;
  }
  if (aNorm === 0 || bNorm === 0) return 0;
  return dot / Math.sqrt(aNorm * bNorm);
}
