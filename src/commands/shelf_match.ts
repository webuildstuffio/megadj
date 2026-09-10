// shelf_match.ts — the junk filter + NFC/casefold name key shared by the
// shelf sweep commands (shelf-archive's walk + index, shelf-dedupe's
// scans). ExFAT traps live here: AppleDouble (._*) files, .DS_Store,
// fseventsd, and case-insensitive name collisions.

/** Junk that must never count as content (the AppleDouble trap). */
export function isJunk(name: string): boolean {
  return (
    name.startsWith("._") ||
    name === ".DS_Store" ||
    name === "System Volume Information" ||
    name === "$RECYCLE.BIN" ||
    name === "XDJXZ.UPD" // device firmware blob, not music
  );
}

/** Machine-generated dirs whose contents are cache/DB, never user music. */
export function isJunkDir(name: string): boolean {
  return name === "USBANLZ" || name === "ARTWORK";
}

/** NFC + casefold key — the only honest name comparison on exFAT. */
export function key(s: string): string {
  return s.normalize("NFC").toLowerCase();
}
