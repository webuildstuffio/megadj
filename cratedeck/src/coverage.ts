// fleet.ts — the fleet superpowers (archived ideas §B6/B7/B8 (docs/archive/ideas-2026-09-15.md)), as pure
// functions over track inventories. No I/O: rows go in, verdicts come out.
//
//   coverage    — track × drive matrix: which stick has this track?
//   redundancy  — `every track in playlist X is on ≥2 drives — PASS${gaps}`
//   diff        — drive-vs-drive added/removed/changed (B8)
//
// Track identity (deliberately boring, matches how rekordbox copies files):
//   rel_path — NFC-casefolded Contents-relative path. Master/mirror use
//              identical trees, so this is the primary key across drives.
//   title+artist — fallback join when a track lives at different paths on
//              different sticks (B6's "same track, different folder" case).

import type { CoverageResult, TrackCoverage, TrackRow } from "../shared/types";
export {
  type ManifestRow,
  type PlaylistEntryRow,
  type TrackRow,
} from "../shared/types";

/** Casefold like scan.nfcCasefold without importing scan (keeps this pure). */
function fold(s: string): string {
  return s.normalize("NFC").toLowerCase();
}

/** Fallback identity: "artist - title". null when neither side exists.
 *  Fields optional: manifests (DiffSource) carry no metadata at all. */
function metaKey(t: {
  title?: string | null;
  artist?: string | null;
}): string | null {
  const artist = (t.artist ?? "").trim();
  const title = (t.title ?? "").trim();
  if (!artist && !title) return null;
  return fold(artist ? `${artist} - ${title}` : title);
}

// ---- coverage (B6) ----------------------------------------------------------
// (TrackCoverage / CoverageResult / CoverageResponse are defined in
// shared/types.ts and re-exported at the top of this file.)

/**
 * Track × drive coverage across the whole fleet.
 *
 * @param inventories drive_id → DB track rows for that drive
 * @param minCopies redundancy floor; rows below it are flagged at_risk
 */
export function coverage(
  inventories: Map<string, TrackRow[]>,
  minCopies = 2,
): CoverageResult {
  const drives = [...inventories.entries()]
    .filter(([, rows]) => rows.length > 0)
    .map(([id, rows]) => ({ id, tracks: rows.length }))
    .toSorted((a, b) => a.id.localeCompare(b.id));
  const driveIds = new Set(drives.map((d) => d.id));

  // path-keyed index; the first sighting provides display metadata
  const byPath = new Map<string, TrackCoverage>();
  const ensure = (path: string, t: TrackRow): TrackCoverage => {
    let row = byPath.get(path);
    if (!row) {
      row = {
        identity: { path, title: t.title, artist: t.artist },
        drives: [],
        copies: 0,
        at_risk: false,
      };
      byPath.set(path, row);
    }
    return row;
  };

  for (const [driveId, rows] of inventories) {
    if (!driveIds.has(driveId)) continue;
    for (const t of rows) {
      const row = ensure(t.path, t);
      if (!row.drives.includes(driveId)) {
        row.drives.push(driveId);
        row.copies = row.drives.length;
      }
      if (!row.identity.title && t.title) row.identity.title = t.title;
      if (!row.identity.artist && t.artist) row.identity.artist = t.artist;
    }
  }

  const rows = [...byPath.values()].map((r) => ({
    ...r,
    at_risk: r.copies < minCopies,
  }));
  const atRisk = rows
    .filter((r) => r.at_risk)
    .toSorted(
      (a, b) =>
        a.copies - b.copies || a.identity.path.localeCompare(b.identity.path),
    );

  return {
    drives,
    rows,
    at_risk: atRisk,
    min_copies: minCopies,
    totals: {
      unique_tracks: rows.length,
      fully_redundant: rows.filter((r) => r.copies >= minCopies).length,
    },
  };
}

/**
 * Which drives carry one track? One query string, two passes: exact identity
 * (folded path, or exact "artist - title") first, then substring over
 * path/title/artist — so typing "three" finds "Three". Powers the coverage
 * tab's search box and the "is this anywhere else?" question mid-gig.
 */
export function trackLocations(
  inventories: Map<string, TrackRow[]>,
  query: string,
): {
  identity: { path: string; title: string | null; artist: string | null };
  drives: string[];
} | null {
  const q = fold(query.trim());
  if (!q) return null;
  const hit: {
    identity: { path: string; title: string | null; artist: string | null };
    drives: string[];
  } = {
    identity: { path: "", title: null, artist: null },
    drives: [],
  };
  const tryRow = (t: TrackRow, driveId: string, ok: boolean): void => {
    if (!ok) return;
    if (!hit.drives.includes(driveId)) hit.drives.push(driveId);
    hit.identity.path = t.path;
    hit.identity.title = t.title;
    hit.identity.artist = t.artist;
  };
  // pass 1: exact identity (folded path or "artist - title")
  for (const [driveId, rows] of inventories) {
    for (const t of rows) {
      tryRow(t, driveId, t.path === q || metaKey(t) === q);
    }
  }
  // pass 2: substring fallback over path + title + artist
  if (!hit.drives.length) {
    for (const [driveId, rows] of inventories) {
      for (const t of rows) {
        const hay = fold(`${t.path} ${t.title ?? ""} ${t.artist ?? ""}`);
        tryRow(t, driveId, hay.includes(q));
      }
    }
  }
  return hit.drives.length ? hit : null;
}
