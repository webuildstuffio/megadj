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
  return optNum(args, "limit", def, max);
}

/** optLimit twin for a named (non-"limit") numeric param: same clamp
 * semantics, caller picks the key. */
export function optNum(
  args: Record<string, unknown>,
  key: string,
  def: number,
  max: number,
): number {
  const v = num(args, key);
  if (v === undefined) return def;
  return Math.min(Math.max(Math.floor(v), 1), max);
}

/** Invalid/missing tool argument — maps to JSON-RPC -32602. */
export class RpcParamError extends Error {}

// ---- input-schema builders --------------------------------------------------
// One source of truth for the JSON-Schema boilerplate every tool repeats
// (`{type:"object", properties, required?, additionalProperties:false}` and
// the per-property `{type, description?}` wrappers). Keeps tool tables to
// their substance: names, descriptions, run bodies.

/** One object property. */
export interface Prop {
  type: "string" | "number" | "boolean" | "array";
  description?: string | undefined;
  enum?: readonly string[] | undefined;
  /** array-only: the items' schema */
  items?: { type: "string" } | undefined;
}

function prop(p: Prop): Record<string, unknown> {
  const out: Record<string, unknown> = { type: p.type };
  if (p.description) out.description = p.description;
  if (p.enum) out.enum = [...p.enum];
  if (p.items) out.items = p.items;
  return out;
}

/** Tool input schema: `obj({ drive: strProp(...), k: numProp(...) }, ["drive"])`. */
export function obj(
  properties: Record<string, Prop>,
  required: string[] = [],
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(properties)) props[k] = prop(v);
  const out: Record<string, unknown> = {
    type: "object",
    properties: props,
    additionalProperties: false,
  };
  if (required.length) out.required = required;
  return out;
}

/** The no-parameter schema shared by the readonly no-arg tools. */
export function noArgs(): Record<string, unknown> {
  return { type: "object", properties: {}, additionalProperties: false };
}

/** `s("text", "search text" + ` shorthand for a string property. */
export function s(description: string): Prop {
  return { type: "string", description };
}

/** Bare string property (no description) — for enum/case rows keep `)s`. */
export function sEnum(options: readonly string[], description?: string): Prop {
  return { type: "string", enum: options, description };
}

/** Numeric property with optional description. */
export function n(description?: string): Prop {
  return { type: "number", description };
}

/** Boolean property with optional description. */
export function b(description?: string): Prop {
  return { type: "boolean", description };
}

/** String-array property (e.g. booth fleet ids). */
export function sArr(description: string): Prop {
  return { type: "array", items: { type: "string" }, description };
}
