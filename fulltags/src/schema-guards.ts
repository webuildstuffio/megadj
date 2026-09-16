/**
 * Runtime validation for TagPatch values — throws with a precise message on
 * bad input so a bad batch never half-writes files. Migrated verbatim from
 * tools/fetch-lib.ts validateTagValues (same rules, new field names).
 */
import type { TagPatch } from "./schema";

/** Runtime validator for TRUSTED input (typed `TagPatch` from in-process
 * callers). Throws with a precise message on bad input. */
export function validatePatch(vals: TagPatch): void {
  validatePatchObject(vals as Record<string, unknown>);
}

/** Validate UNTRUSTED input (decoded JSON, CLI args, IPC payloads): values
 * arrive as `unknown`. Throws the same precise messages as validatePatch.
 * This is also the negative-test entry point — bad values are expressed
 * as what they are (unknown runtime data), never smuggled past the
 * compiler with `as unknown as` casts. Returns the input unchanged, typed
 * as TagPatch after validation held. */
export function validatePatchUntrusted(
  vals: Record<string, unknown>,
): TagPatch {
  validatePatchObject(vals);
  return vals as TagPatch;
}

/** Per-field bounds/shape spec for the numeric TagPatch fields. */
interface NumericSpec {
  lo: number;
  hi: number;
  integer: boolean;
  /** lo itself is rejected too (bpm 0 = unknown, not a tempo). */
  minExclusive?: boolean;
  expect: string;
}

const NUMERIC_SPECS: Record<string, NumericSpec> = {
  year: { lo: 1900, hi: 2100, integer: true, expect: "an integer 1900–2100" },
  // bpm is EXCLUSIVE at zero (original: `v <= 0` rejected — 0 BPM is
  // "unknown", not a tempo), inclusive at the top.
  bpm: {
    lo: 0,
    hi: 400,
    integer: false,
    minExclusive: true,
    expect: "a number 0–400",
  },
  energy: { lo: 1, hi: 10, integer: false, expect: "a number 1–10" },
};

function numericField(k: string, v: unknown, spec: NumericSpec): void {
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    (spec.minExclusive === true ? v <= spec.lo : v < spec.lo) ||
    v > spec.hi
  )
    throw new TypeError(`${k} must be ${spec.expect}, got ${v}`);
  if (spec.integer && !Number.isInteger(v))
    throw new TypeError(`${k} must be ${spec.expect}, got ${v}`);
}

/** chromaprint base64 — long but bounded; non-empty is the gate. */
function fingerprintField(k: string, v: unknown): void {
  if (typeof v !== "string" || !v.trim())
    throw new TypeError(`${k} must be a non-empty string`);
}

/** Camelot ("9A"/"12B") or traditional ("E min", "C maj", "F# minor"). */
const KEY_RE = /^\d{1,2}[AB]$|^[A-G][#♯b♭]?\s?(maj(or)?|min(or)?|m)?$/iu;
function keyField(k: string, v: unknown): void {
  if (typeof v !== "string" || !KEY_RE.test(v.trim()))
    throw new TypeError(
      `${k} must be Camelot ("9A") or traditional ("E min"), got ${v}`,
    );
}

/** "k=v; k=v" pairs; numeric values 0–1 or valence/arousal 1–9. */
const MOOD_PAIR_RE = /^[a-zA-Z]+=[\d.]+$/u;
function moodField(_k: string, v: unknown): void {
  if (typeof v !== "string" || !v.trim())
    throw new TypeError("mood must be a non-empty string");
  if (v.length > 500) throw new TypeError(`mood too long (${v.length})`);
  if (!v.split(";").every((p) => MOOD_PAIR_RE.test(p.trim())))
    throw new TypeError(`mood must be "k=v; k=v" numeric pairs, got ${v}`);
}

/** AI provenance stamps carry "value|confidence" — sanity-check the shape. */
const AI_STAMP_RE = /^[^|]+\|\d*\.?\d+$/u;

const FIELD_CHECKS: Record<string, (k: string, v: unknown) => void> = {
  year: (k, v) => numericField(k, v, NUMERIC_SPECS.year!),
  bpm: (k, v) => numericField(k, v, NUMERIC_SPECS.bpm!),
  energy: (k, v) => numericField(k, v, NUMERIC_SPECS.energy!),
  fingerprint: fingerprintField,
  key: keyField,
  camelot: keyField,
  mood: moodField,
};

function validatePatchObject(vals: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(vals)) {
    if (v === undefined) continue;
    const check = FIELD_CHECKS[k];
    if (check) {
      check(k, v);
      continue;
    }
    validateGenericString(k, v);
  }
}

/** Every other TagPatch field is a bounded non-empty string. */
function validateGenericString(k: string, v: unknown): void {
  if (typeof v !== "string")
    throw new TypeError(`${k} must be a string, got ${typeof v}`);
  if (k !== "comment" && !v.trim())
    throw new TypeError(`${k} must be non-empty`);
  if (v.length > 500)
    throw new TypeError(`${k} too long (${v.length} chars, max 500)`);
  // AI provenance stamps carry "value|confidence" — sanity-check the shape
  if (k === "aiGenre" || k === "aiYear") {
    if (typeof v !== "string" || !AI_STAMP_RE.test(v))
      throw new TypeError(
        `${k} must be "value|confidence" (e.g. "Techno|0.92"), got ${v}`,
      );
  }
}
