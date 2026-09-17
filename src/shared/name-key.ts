/**
 * name-key.ts — the ONE NFC+casefold name key (issue #67).
 *
 * Ten sites used to hand-roll `s.normalize("NFC").toLowerCase()` (or
 * NFC-only, which still splits on case): match.key, rb-adopt's
 * normPath, rb-fix-paths' nfkc, grid-triage's norm, rb-unmatched's
 * inline trio, shelf-sync's NFC-only index keys, and the Python seams'
 * unicodedata twins. One wrong variant = a variant-sprawl bug class:
 * the same file matches under one join and misses under another.
 *
 * ExFAT is case-insensitive and hands back NFD from fskit; the archive
 * is NFC. NFC+casefold is the only honest comparison on this surface.
 * `nfc()` alone is exported for the (rare) NFC-only index keys —
 * case-aware — but joins should use `nameKey`.
 */

/** Normalize to NFC (macOS NFD trap: composed vs decomposed accents). */
export function nfc(s: string): string {
  return s.normalize("NFC");
}

/** THE name key: NFC + lowercase. Use for every path/basename join
 *  where "same file, different Unicode form or case" must be one key.
 *  (JS toLowerCase, not full casefold — these names are ASCII-leaning
 *  paths, and every existing site already used toLowerCase.) */
export function nameKey(s: string): string {
  return nfc(s).toLowerCase();
}
