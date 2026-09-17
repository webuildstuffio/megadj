// radar.ts — the new-music radar (PRD F10, issue #148): a PURE set
// difference between megadj's archive mirror (the archive DB's
// downloaded rows) and a drive's snapshot inventory (fleet_tracks).
//
// The PRD's question — "12 downloaded tracks not on the master" — is the
// PRE-sync question the coverage matrix can't answer (coverage asks
// which drive HAS a track; the radar asks which tracks are NOWHERE on a
// drive yet).
//
// Track identity is the fleet-wide convention (coverage.ts): NFC-casefolded
// Contents-relative path primary, "artist - title" fallback join for the
// same-track-different-path case. Pure function: rows in, verdict out —
// the route/UI twins stay thin and the fixture tests stay honest. Wire
// types are canonically defined in shared/types.ts and re-exported here
// (the FleetDiff precedent; RadarMiss stays import-only here — it's the
// row type of `missing`, not part of this module's surface).
import type { RadarMiss, RadarResult } from "../shared/types";
// fold + metaKey: the #201 one-definition module (was a byte-identical
// twin here, coverage.ts, coverage_fleet.ts).
import { fold, metaKey } from "./meta-key";

export type { RadarResult } from "../shared/types";

/** One side of the radar comparison, structurally: the two real row
 *  shapes (archive tracks and fleet TrackRow) both fit without casts. */
export interface RadarSource {
  path: string | null;
  title?: string | null;
  artist?: string | null;
}

/** Strip everything through a leading Contents/ and fold — the archive
 *  side's file_path is absolute-or-batch-relative while fleet paths are
 *  Contents-relative already. */
export function archivePathKey(file_path: string | null): string | null {
  if (!file_path) return null;
  const noContents = file_path.replace(/^.*?Contents\//, "");
  const folded = fold(noContents);
  return folded === "" ? null : folded;
}

/** The radar engine's answer — freshness fields (snapshotAt /
 *  archiveAvailable / inventoryAvailable) attach at the route layer, so
 *  the pure core returns the shared RadarResult minus those three. */
export type RadarCore = Omit<
  RadarResult,
  "snapshotAt" | "archiveAvailable" | "inventoryAvailable"
>;

/**
 * The radar: archive rows the drive's snapshot lacks.
 *
 * Matching is the diff() convention — folded-path primary with a
 * byMeta ("artist - title") fallback pass so a track the shelf regrouped
 * into artist folders still counts as present. Deterministic, pure, and
 * fixture-testable end to end.
 */
export function radar(
  driveId: string,
  driveName: string,
  archive: (RadarSource & {
    videoId: string;
    firstSeenAt: string | null;
  })[],
  driveRows: RadarSource[],
  previewLimit = 50,
): RadarCore {
  const onDrive = new Set<string>();
  const onDriveMeta = new Set<string>();
  for (const r of driveRows) {
    const p = r.path === null ? null : fold(r.path);
    if (p) onDrive.add(p);
    const m = metaKey(r);
    if (m) onDriveMeta.add(m);
  }

  const missing: RadarMiss[] = [];
  let archiveTracks = 0;
  for (const t of archive) {
    archiveTracks++;
    const p = archivePathKey(t.path);
    if (p && onDrive.has(p)) continue;
    const m = metaKey(t);
    if (m && onDriveMeta.has(m)) continue; // same track, regrouped path
    missing.push({
      path: p ?? fold(t.title ?? t.videoId),
      title: t.title ?? null,
      artist: t.artist ?? null,
      videoId: t.videoId,
      firstSeenAt: t.firstSeenAt,
    });
  }

  // Newest-first: the tracks you added most recently lead the list.
  missing.sort((a, b) =>
    (b.firstSeenAt ?? "").localeCompare(a.firstSeenAt ?? ""),
  );

  const missingCount = missing.length;
  const preview = missing.slice(0, Math.max(1, previewLimit));
  return {
    driveId,
    driveName,
    archiveTracks,
    driveTracks: driveRows.length,
    missingCount,
    missing: preview,
    summary:
      missingCount > 0
        ? `${missingCount} of ${archiveTracks} archived tracks not on this drive`
        : `drive matches the archive (${archiveTracks} compared)`,
  };
}
