// coverage_fleet.ts — the fleet redundancy + diff families (#89 diet
// extraction from coverage.ts): B7 playlist redundancy and B8 drive-vs-
// drive diff. Same contract as coverage.ts: pure functions over track
// inventories, no I/O, rows in → verdicts out.
import type {
  DiffRow,
  FleetDiff,
  ManifestRow,
  PlaylistEntryRow,
  PlaylistRedundancy,
  RedundancyResult,
  TrackCoverage,
  TrackRow,
} from "../shared/types";
import { coverage } from "./coverage";
// fold + metaKey: the #201 one-definition module (was a byte-identical
// twin here, coverage.ts, radar.ts).
import { fold, metaKey } from "./meta-key";

// ---- redundancy (B7) --------------------------------------------------------
// (PlaylistRedundancy / RedundancyResult are defined in shared/types.ts.)

/** playlist name (folded) → set of folded track paths, plus display names. */
function indexPlaylists(playlistEntries: Map<string, PlaylistEntryRow[]>): {
  plTracks: Map<string, Set<string>>;
  plDisplay: Map<string, string>;
} {
  const plTracks = new Map<string, Set<string>>();
  const plDisplay = new Map<string, string>();
  for (const [, rows] of playlistEntries) {
    for (const e of rows) {
      const pl = fold(e.playlist_name);
      plDisplay.set(pl, e.playlist_name);
      (plTracks.get(pl) ?? plTracks.set(pl, new Set()).get(pl)!).add(
        fold(e.track_path),
      );
    }
  }
  return { plTracks, plDisplay };
}

/** folded path → coverage row + the playlists that reference it. */
function buildTrackIndex(
  inventories: Map<string, TrackRow[]>,
  playlistEntries: Map<string, PlaylistEntryRow[]>,
  minCopies: number,
): Map<string, { cov: TrackCoverage; playlists: Set<string> }> {
  const trackIndex = new Map<
    string,
    { cov: TrackCoverage; playlists: Set<string> }
  >();
  const cov = coverage(inventories, minCopies);
  for (const row of cov.rows) {
    trackIndex.set(row.identity.path, { cov: row, playlists: new Set() });
  }
  for (const [, rows] of playlistEntries) {
    for (const e of rows) {
      const entry = trackIndex.get(fold(e.track_path));
      if (entry) entry.playlists.add(e.playlist_name);
    }
  }
  return trackIndex;
}

/** One playlist's redundancy audit: verdict, gap list, detail line. */
function auditPlaylist(
  plKey: string,
  paths: Set<string>,
  plDisplay: Map<string, string>,
  trackIndex: Map<string, { cov: TrackCoverage; playlists: Set<string> }>,
  minCopies: number,
): PlaylistRedundancy {
  const rows: (TrackCoverage & { playlists: string[] })[] = [];
  for (const p of paths) {
    const entry = trackIndex.get(p);
    if (!entry) continue; // track row missing on every scanned drive
    rows.push({ ...entry.cov, playlists: [...entry.playlists].toSorted() });
  }
  const gaps = rows.filter((r) => r.copies < minCopies);
  const fails = gaps.filter((r) => r.copies <= 1).length;
  const verdict: PlaylistRedundancy["verdict"] =
    rows.length === 0
      ? "unknown"
      : fails > 0
        ? "fail"
        : gaps.length > 0
          ? "warn"
          : "pass";
  return {
    playlist: plDisplay.get(plKey) ?? plKey,
    unique_tracks: rows.length,
    protected_tracks: rows.length - gaps.length,
    tracks: rows.toSorted((a, b) => a.copies - b.copies),
    verdict,
    detail:
      rows.length === 0
        ? "no track inventory on any scanned drive — run a scan"
        : gaps.length === 0
          ? `all ${rows.length} tracks on ≥${minCopies} drives`
          : `${gaps.length} of ${rows.length} track(s) below ${minCopies} copies${
              fails ? ` (${fails} on a single drive)` : ""
            }`,
  };
}

/**
 * Redundancy audit per playlist: is every track on ≥ minCopies drives?
 * Playlists are unioned across drives (a playlist that exists on only some
 * drives still audits all of its known tracks), and every track's playlist
 * memberships ride along so the UI can show what else references a gap.
 */
export function redundancy(
  inventories: Map<string, TrackRow[]>,
  playlistEntries: Map<string, PlaylistEntryRow[]>,
  minCopies = 2,
): RedundancyResult {
  const { plTracks, plDisplay } = indexPlaylists(playlistEntries);
  const trackIndex = buildTrackIndex(inventories, playlistEntries, minCopies);
  const out: PlaylistRedundancy[] = [];
  for (const [plKey, paths] of plTracks) {
    out.push(auditPlaylist(plKey, paths, plDisplay, trackIndex, minCopies));
  }

  out.sort((a, b) => {
    const rank = { fail: 0, warn: 1, unknown: 2, pass: 3 } as const;
    return (
      rank[a.verdict] - rank[b.verdict] || b.unique_tracks - a.unique_tracks
    );
  });
  const fails = out.filter((p) => p.verdict === "fail").length;
  const warns = out.filter((p) => p.verdict === "warn").length;
  const overall: RedundancyResult["overall"] = out.length
    ? fails
      ? "fail"
      : warns
        ? "warn"
        : "pass"
    : "unknown";
  return {
    playlists: out,
    overall,
    summary: out.length
      ? fails
        ? `${fails} playlist(s) with single-drive tracks — a drive failure loses them`
        : warns
          ? `${warns} playlist(s) below the ${minCopies}-drive floor`
          : `every audited playlist is on ≥${minCopies} drives`
      : "no playlist data yet — run scans on mounted drives",
  };
}

// ---- fleet diff (B8) --------------------------------------------------------
// (DiffKind / DiffRow / FleetDiff are defined in shared/types.ts.)

/** Minimal shape the diff engine actually needs — TrackRow and ManifestRow
 *  both fit structurally, so no `in`-narrowing or casts anywhere below. */
type DiffSource = Pick<TrackRow, "path"> & {
  title?: string | null;
  artist?: string | null;
  bytes?: number;
};

function metaIndex(rows: DiffSource[]): {
  byPath: Map<string, DiffSource>;
  byMeta: Map<string, DiffSource>;
} {
  const byPath = new Map<string, DiffSource>();
  const byMeta = new Map<string, DiffSource>();
  for (const r of rows) {
    const p = fold(r.path);
    if (p) byPath.set(p, r);
    const m = metaKey(r);
    if (m) byMeta.set(m, r);
  }
  return { byPath, byMeta };
}

/**
 * Drive-vs-drive diff over two inventories. Track lists (DB truth) define
 * added/removed; file manifests (byte truth) define changed when present.
 * `byMeta` fallback catches the same track at different paths across drives.
 */
export function diff(
  aId: string,
  a: TrackRow[],
  aManifest: ManifestRow[] | null,
  bId: string,
  b: TrackRow[],
  bManifest: ManifestRow[] | null,
): FleetDiff {
  const ia = metaIndex(a);
  const ib = metaIndex(b);
  const fa = metaIndex(aManifest ?? []);
  const fb = metaIndex(bManifest ?? []);

  const added: DiffRow[] = [];
  const removed: DiffRow[] = [];
  const changed: DiffRow[] = [];

  const matchedB = new Set<string>();
  reconcileA(
    ia,
    ib,
    fa,
    fb,
    diffRowOf,
    diffBytesOf,
    matchedB,
    removed,
    changed,
  );
  for (const [path, rb] of ib.byPath) {
    if (matchedB.has(path)) continue;
    const m = metaKey(rb);
    if (m && ia.byMeta.has(m)) continue; // caught on the a-side byMeta pass
    added.push({ ...diffRowOf(rb), kind: "added" });
  }

  added.sort(byPathCompare);
  removed.sort(byPathCompare);
  changed.sort(byPathCompare);
  const parts: string[] = [];
  if (added.length) parts.push(`+${added.length} added`);
  if (removed.length) parts.push(`−${removed.length} removed`);
  if (changed.length) parts.push(`~${changed.length} changed`);
  return {
    a: aId,
    b: bId,
    added,
    removed,
    changed,
    summary: parts.length ? parts.join(" · ") : "identical inventories",
  };
}

type DiffRowOf = (r: DiffSource, tr?: DiffSource) => DiffRow;
type BytesOf = (r?: DiffSource) => number | undefined;

/** True display meta comes from TrackRow; manifests only carry bytes.
 *  Pure over its inputs — module-level so `diff( + ` doesn't re-create it
 *  per call (oxlint consistent-function-scoping). */
const diffRowOf = (r: DiffSource, tr?: DiffSource): DiffRow => ({
  path: r.path,
  title: tr?.title ?? r.title ?? null,
  artist: tr?.artist ?? r.artist ?? null,
  kind: "added",
});
const diffBytesOf = (r?: DiffSource): number | undefined => r?.bytes;

/** Playlist-diff row ordering: by display path. Captures nothing from
 *  `diff()` — module-level so it isn't re-created per call (oxlint
 *  consistent-function-scoping). */
const byPathCompare = (x: DiffRow, y: DiffRow): number =>
  x.path.localeCompare(y.path);

/** A-side reconcile pass: match by path, fall back to artist-title join,
 *  then classify changed (byte drift) / removed. Bytes compare at each
 *  side's OWN path — cross-path matches would otherwise read b's manifest
 *  under a's path and miss (or invent) a "changed" verdict. */
function reconcileA(
  ia: { byPath: Map<string, DiffSource>; byMeta: Map<string, DiffSource> },
  ib: { byPath: Map<string, DiffSource>; byMeta: Map<string, DiffSource> },
  fa: { byPath: Map<string, DiffSource>; byMeta: Map<string, DiffSource> },
  fb: { byPath: Map<string, DiffSource>; byMeta: Map<string, DiffSource> },
  rowOf: DiffRowOf,
  bytesOf: BytesOf,
  matchedB: Set<string>,
  removed: DiffRow[],
  changed: DiffRow[],
): void {
  for (const [path, ra] of ia.byPath) {
    let rb = ib.byPath.get(path);
    if (!rb) {
      // same track, different folder: join on artist - title
      const m = metaKey(ra);
      const cand = m ? ib.byMeta.get(m) : undefined;
      if (cand) {
        rb = cand;
        matchedB.add(fold(cand.path));
      }
    }
    if (rb) {
      matchedB.add(path);
      const ba = bytesOf(fa.byPath.get(path)) ?? bytesOf(ra);
      const bb = bytesOf(fb.byPath.get(fold(rb.path))) ?? bytesOf(rb);
      if (ba !== undefined && bb !== undefined && ba !== bb) {
        changed.push({
          ...rowOf(ra, rb),
          kind: "changed",
          bytes_a: ba,
          bytes_b: bb,
        });
      }
    } else {
      removed.push({ ...rowOf(ra), kind: "removed" });
    }
  }
}
