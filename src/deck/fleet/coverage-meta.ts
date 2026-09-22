/**
 * coverage-meta — the fleet family's ONE metadata identity join (#201).
 * Was meta-key.ts (25L, #221): the byte-identical fold + metaKey twins
 * in coverage.ts, radar.ts, coverage-fleet.ts merged onto one definition.
 * Extracted to its own leaf (Sep 21) to break the coverage ↔
 * coverage-fleet import cycle: both sides compose these helpers, neither
 * imports the other for them.
 */
import { nameKey } from "../../shared/name-key";

/** fold is src/shared/name-key.ts's nameKey (NFC+lowercase — the #67
 *  SSOT), re-exported under the fleet family's local name. */
export const fold = nameKey;

/** Fallback identity: "artist - title". null when neither side exists.
 *  Fields optional: manifests (DiffSource) carry no metadata at all. */
export function metaKey(t: {
  title?: string | null;
  artist?: string | null;
}): string | null {
  const artist = (t.artist ?? "").trim();
  const title = (t.title ?? "").trim();
  if (!artist && !title) return null;
  return fold(artist ? `${artist} - ${title}` : title);
}
