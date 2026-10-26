/**
 * identity/version-llm.ts — LLM fallback for unparseable titles (B3.2).
 *
 * Only fires when the regex parser's confidence < 0.7. Uses OpenRouter
 * with temperature 0 and JSON-schema output identical to VersionIdentity.
 * Cached by sha256(title|artist) in the archive DB.
 *
 * Rules:
 * - No per-track genre ever comes from this call
 * - Invalid responses → versionType "unknown", confidence 0
 * - Cache hit on rerun (0 LLM calls on second pass)
 */
import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { VersionIdentity, VersionType } from "./version";

const VERSION_TYPES: readonly VersionType[] = [
  "original",
  "extended",
  "radio",
  "remix",
  "edit",
  "bootleg",
  "flip",
  "vip",
  "rework",
  "dub",
  "instrumental",
  "acapella",
  "acoustic",
  "live",
  "unknown",
];

/** The JSON schema sent to the LLM for structured output. */
const VERSION_SCHEMA = {
  type: "object",
  properties: {
    baseTitle: { type: "string" },
    originalArtists: { type: "array", items: { type: "string" } },
    featured: { type: "array", items: { type: "string" } },
    versionType: { type: "string", enum: VERSION_TYPES },
    versionArtists: { type: "array", items: { type: "string" } },
    rawVersion: { type: ["string", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "baseTitle",
    "originalArtists",
    "featured",
    "versionType",
    "versionArtists",
    "rawVersion",
    "confidence",
  ],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You parse DJ/electronic music track titles into structured metadata.
Given a title and artist field, extract:
- baseTitle: the song name without version/remix info, lowercased
- originalArtists: the main artist(s), split on feat./&/x/,/vs.
- featured: featured artists mentioned in title or artist field
- versionType: one of ${VERSION_TYPES.join(", ")}
- versionArtists: the remixer/editor name(s) if any
- rawVersion: the exact version text from brackets, or null
- confidence: your confidence 0-1

Examples:
"Bicep - Glue (Denis Sulta Remix)" → remix by Denis Sulta
"Fisher - Losing It (Extended Mix)" → extended, no version artist
"Peggy Gou - Starry Night" → original`;

/** Stable cache key: sha256 of "title|artist". */
export function versionCacheKey(title: string, artist: string): string {
  return createHash("sha256").update(`${title}|${artist}`).digest("hex");
}

/** Create the version_llm_cache table. Idempotent. */
export function migrateVersionLlmCache(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS version_llm_cache (
      cache_key   TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      artist      TEXT NOT NULL,
      response    TEXT NOT NULL,
      model       TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/** Look up a cached LLM response. */
export function lookupVersionCache(db: Database, key: string): VersionIdentity | null {
  const row = db.query("SELECT response FROM version_llm_cache WHERE cache_key = ?").get(key) as {
    response: string;
  } | null;
  if (row === null) return null;
  return validateLlmResponse(row.response);
}

/** Store a validated LLM response in the cache. */
export function storeVersionCache(
  db: Database,
  key: string,
  title: string,
  artist: string,
  response: string,
  model: string,
): void {
  db.run(
    `INSERT OR REPLACE INTO version_llm_cache
       (cache_key, title, artist, response, model)
     VALUES (?, ?, ?, ?, ?)`,
    [key, title, artist, response, model],
  );
}

/**
 * Validate and parse an LLM JSON response into VersionIdentity.
 * Returns null if invalid.
 */
export function validateLlmResponse(json: string): VersionIdentity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.baseTitle !== "string") return null;
  if (!Array.isArray(obj.originalArtists)) return null;
  if (!Array.isArray(obj.featured)) return null;
  if (
    typeof obj.versionType !== "string" ||
    !(VERSION_TYPES as readonly string[]).includes(obj.versionType)
  )
    return null;
  if (!Array.isArray(obj.versionArtists)) return null;
  if (typeof obj.confidence !== "number") return null;

  return {
    baseTitle: obj.baseTitle,
    originalArtists: (obj.originalArtists as unknown[]).filter(
      (a): a is string => typeof a === "string",
    ),
    featured: (obj.featured as unknown[]).filter((a): a is string => typeof a === "string"),
    versionType: obj.versionType as VersionType,
    versionArtists: (obj.versionArtists as unknown[]).filter(
      (a): a is string => typeof a === "string",
    ),
    rawVersion: typeof obj.rawVersion === "string" ? obj.rawVersion : null,
    confidence: Math.min(1, Math.max(0, obj.confidence)),
    parser: "llm",
  };
}

/** The unknown fallback when LLM fails. */
function unknownFallback(title: string, artist: string): VersionIdentity {
  return {
    baseTitle: title.toLowerCase(),
    originalArtists: artist ? [artist] : [],
    featured: [],
    versionType: "unknown",
    versionArtists: [],
    rawVersion: null,
    confidence: 0,
    parser: "llm",
  };
}

export interface LlmVersionOptions {
  /** The archive DB for caching. */
  db: Database;
  /** OpenRouter API key. */
  apiKey: string;
  /** Model to use (default: openrouter/auto). */
  model?: string | undefined;
  /** Whether to actually call the LLM (false = cache-only mode). */
  live?: boolean | undefined;
}

/**
 * Parse a version identity using the LLM, with caching.
 * Returns cached result if available. Returns unknown fallback on any error.
 */
export async function parseVersionLlm(
  title: string,
  artist: string,
  opts: LlmVersionOptions,
): Promise<VersionIdentity> {
  const key = versionCacheKey(title, artist);
  migrateVersionLlmCache(opts.db);

  // Check cache first
  const cached = lookupVersionCache(opts.db, key);
  if (cached !== null) return cached;

  // Cache-only mode — don't call LLM
  if (opts.live === false) return unknownFallback(title, artist);

  const model = opts.model ?? "openrouter/auto";

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: { name: "version_identity", strict: true, schema: VERSION_SCHEMA },
        },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Title: ${title}\nArtist: ${artist}` },
        ],
      }),
    });

    if (!response.ok) return unknownFallback(title, artist);

    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") return unknownFallback(title, artist);

    const validated = validateLlmResponse(content);
    if (validated === null) return unknownFallback(title, artist);

    // Store in cache
    storeVersionCache(opts.db, key, title, artist, content, model);
    return validated;
  } catch {
    return unknownFallback(title, artist);
  }
}
