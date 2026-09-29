/**
 * version-llm.test.ts — Tests for LLM version fallback (B3.2).
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  lookupVersionCache,
  migrateVersionLlmCache,
  storeVersionCache,
  validateLlmResponse,
  versionCacheKey,
} from "./version-llm";

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrateVersionLlmCache(db);
});

afterEach(() => {
  db.close();
});

describe("versionCacheKey", () => {
  test("deterministic for same input", () => {
    const a = versionCacheKey("Glue", "Bicep");
    const b = versionCacheKey("Glue", "Bicep");
    expect(a).toBe(b);
  });

  test("different for different input", () => {
    const a = versionCacheKey("Glue", "Bicep");
    const b = versionCacheKey("Glue (Remix)", "Bicep");
    expect(a).not.toBe(b);
  });
});

describe("validateLlmResponse", () => {
  test("valid JSON → VersionIdentity", () => {
    const json = JSON.stringify({
      baseTitle: "glue",
      originalArtists: ["bicep"],
      featured: [],
      versionType: "remix",
      versionArtists: ["denis sulta"],
      rawVersion: "Denis Sulta Remix",
      confidence: 0.95,
    });
    const result = validateLlmResponse(json);
    expect(result).not.toBeNull();
    expect(result!.baseTitle).toBe("glue");
    expect(result!.versionType).toBe("remix");
    expect(result!.parser).toBe("llm");
  });

  test("invalid JSON → null", () => {
    expect(validateLlmResponse("not json")).toBeNull();
  });

  test("missing fields → null", () => {
    expect(validateLlmResponse(JSON.stringify({ baseTitle: "x" }))).toBeNull();
  });

  test("invalid versionType → null", () => {
    const json = JSON.stringify({
      baseTitle: "x",
      originalArtists: [],
      featured: [],
      versionType: "mashup",
      versionArtists: [],
      rawVersion: null,
      confidence: 0.5,
    });
    expect(validateLlmResponse(json)).toBeNull();
  });

  test("clamps confidence to 0-1", () => {
    const json = JSON.stringify({
      baseTitle: "x",
      originalArtists: [],
      featured: [],
      versionType: "original",
      versionArtists: [],
      rawVersion: null,
      confidence: 1.5,
    });
    const result = validateLlmResponse(json);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(1);
  });
});

describe("cache round-trip", () => {
  test("store and lookup", () => {
    const key = versionCacheKey("Glue", "Bicep");
    const json = JSON.stringify({
      baseTitle: "glue",
      originalArtists: ["bicep"],
      featured: [],
      versionType: "original",
      versionArtists: [],
      rawVersion: null,
      confidence: 0.9,
    });
    storeVersionCache(db, key, "Glue", "Bicep", json, "test-model");
    const result = lookupVersionCache(db, key);
    expect(result).not.toBeNull();
    expect(result!.baseTitle).toBe("glue");
  });

  test("missing key returns null", () => {
    expect(lookupVersionCache(db, "nonexistent")).toBeNull();
  });

  test("corrupt cached JSON returns null", () => {
    const key = "corrupt-key";
    db.run(
      "INSERT INTO version_llm_cache (cache_key, title, artist, response, model) VALUES (?, ?, ?, ?, ?)",
      [key, "t", "a", "not json", "m"],
    );
    expect(lookupVersionCache(db, key)).toBeNull();
  });

  test("upsert replaces existing", () => {
    const key = versionCacheKey("X", "Y");
    const json1 = JSON.stringify({
      baseTitle: "x",
      originalArtists: [],
      featured: [],
      versionType: "original",
      versionArtists: [],
      rawVersion: null,
      confidence: 0.5,
    });
    const json2 = JSON.stringify({
      baseTitle: "x",
      originalArtists: [],
      featured: [],
      versionType: "remix",
      versionArtists: ["dj z"],
      rawVersion: "DJ Z Remix",
      confidence: 0.9,
    });
    storeVersionCache(db, key, "X", "Y", json1, "m1");
    storeVersionCache(db, key, "X", "Y", json2, "m2");
    const result = lookupVersionCache(db, key);
    expect(result!.versionType).toBe("remix");
  });
});
