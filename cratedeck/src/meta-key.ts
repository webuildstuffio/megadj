// meta-key.ts — the ONE metadata identity join for the fleet family
// (issue #201: byte-identical fold + metaKey twins in coverage.ts,
// radar.ts, coverage_fleet.ts — any normalization change had to be
// edited 3×, and one would be missed, the #200 drift class).
//
// fold is src/shared/name-key.ts's nameKey (NFC+lowercase — the #67
// SSOT), re-exported under the fleet family's local name. metaKey is
// the "artist - title" fallback join when a track lives at different
// paths on different sticks (B6's same-track-different-folder case):
// null when neither side exists.
import { nameKey } from "../../src/shared/name-key";

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
