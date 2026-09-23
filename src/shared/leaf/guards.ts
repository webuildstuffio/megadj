/** Runtime guards for untrusted arrays and records.
 *
 * `Array.isArray` narrows to `any[]` in TypeScript's standard library. These
 * wrappers keep decoded JSON and other process-boundary values as `unknown`
 * until every element has been checked.
 */
export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isFiniteNumberArray(value: unknown): value is number[] {
  return isUnknownArray(value) && value.every(isFiniteNumber);
}

/** Finite non-negative integer (counts, lengths, IDs-as-numbers). */
export function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  );
}

/** The non-empty-string env read for filesystem paths. Sep 20 incident
 * (#281 class): `MEGADJ_MUSIC_DIR="$SHELF"` with `$SHELF` unset expands to
 * the EMPTY string, `??` only catches `undefined`, so `MUSIC_DIR` became
 * `""` and the dated batch folder resolved CWD-relative — 20 downloads
 * landed in the repo root. A present-but-empty env var is a typo, never a
 * deliberate override: treat it exactly like absent. Import-leaf only (no
 * deps) so every process-boundary reader can use it without breaking the
 * #222 boundary-direction census. */
export function nonEmptyEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : raw;
}

/** The guarded JSON.parse for untrusted boundary text (#274 rule): a
 *  malformed payload degrades to null (the caller reports a message),
 *  never a throw into a UI or CLI epilogue. Lives in the import leaf so
 *  web AND node sides share one implementation — the #46 web-boundary
 *  census allows only src/shared/leaf imports, and the boundary-json
 *  census classifies calls through THIS seam as guarded. `null` is the
 *  corruption signal; a literal JSON `null` payload is indistinguishable
 *  by design (callers treat both as "no usable object"). */
export function parseJsonOrNull(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : null;
  } catch (error) {
    void error; // the null return IS the error signal
    return null;
  }
}
