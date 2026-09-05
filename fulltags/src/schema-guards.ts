/**
 * Runtime validation for TagPatch values — throws with a precise message on
 * bad input so a bad batch never half-writes files. Migrated verbatim from
 * tools/fetch_lib.ts validateTagValues (same rules, new field names).
 */
import type { TagPatch } from "./schema";

/** Runtime validator — throws with a precise message on bad input. */
export function validatePatch(vals: TagPatch): void {
  for (const [k, v] of Object.entries(vals) as [keyof TagPatch, unknown][]) {
    if (v === undefined) continue;
    if (k === "year") {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1900 || v > 2100)
        throw new TypeError(`year must be an integer 1900–2100, got ${v}`);
      continue;
    }
    if (k === "bpm") {
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 400)
        throw new TypeError(`bpm must be a number 0–400, got ${v}`);
      continue;
    }
    if (k === "energy") {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 1 || v > 10)
        throw new TypeError(`energy must be a number 1–10, got ${v}`);
      continue;
    }
    if (typeof v !== "string")
      throw new TypeError(`${k} must be a string, got ${typeof v}`);
    if (k !== "comment" && !v.trim())
      throw new TypeError(`${k} must be non-empty`);
    if (v.length > 500)
      throw new TypeError(`${k} too long (${v.length} chars, max 500)`);
    // AI provenance stamps carry "value|confidence" — sanity-check the shape
    if ((k === "aiGenre" || k === "aiYear") && !/^[^|]+\|\d*\.?\d+$/.test(v))
      throw new TypeError(
        `${k} must be "value|confidence" (e.g. "Techno|0.92"), got ${v}`,
      );
  }
}

/** Compat alias: the fetch_lib-era name for the same rules (TagValues ⊂ TagPatch). */
export function validateTagValues(vals: TagPatch): void {
  validatePatch(vals);
}
