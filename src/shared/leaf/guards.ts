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
