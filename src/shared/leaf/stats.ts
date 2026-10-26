// stats.ts — shared stats primitives (dependency-free leaf module).

/** Φ(x) — standard normal CDF via the Abramowitz & Stegun erf approximation. */
export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + 0.3275911 * z);
  const y =
    1.0 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return x < 0 ? 0.5 * (1 - y) : 0.5 * (1 + y);
}
