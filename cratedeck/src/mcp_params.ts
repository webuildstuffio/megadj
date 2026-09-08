// mcp_params.ts — shared MCP tool param helpers (extracted when the
// archive_* tools moved to archive_tools.ts and duplicated these).
// One source of truth for typed param extraction + the param-error class.

/** Typed string param extraction: string → value, else undefined. */
export function str(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof args[key] === "string" ? (args[key] as string) : undefined;
}

/** Typed number param extraction: finite number → value, else undefined. */
export function num(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Optional bounded-number param: clamps to [1, max], falls back to def.
 * The archive_* tools all expose `limit` with the same clamp semantics. */
export function optLimit(
  args: Record<string, unknown>,
  def: number,
  max: number,
): number {
  const v = num(args, "limit");
  if (v === undefined) return def;
  return Math.min(Math.max(Math.floor(v), 1), max);
}

/** Invalid/missing tool argument — maps to JSON-RPC -32602. */
export class RpcParamError extends Error {}
