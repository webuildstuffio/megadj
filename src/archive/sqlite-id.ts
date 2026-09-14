/** Convert bun:sqlite's row-id union without silently rounding a 64-bit id. */
export function sqliteRowId(raw: number | bigint): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new RangeError(
      `SQLite row id ${raw.toString()} is outside JavaScript's safe integer range`,
    );
  }
  return id;
}
