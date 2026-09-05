// fleet.ts — the fleet superpowers (docs/ideas.md §B6/B7/B8), as pure
// functions over track inventories. No I/O: rows go in, verdicts come out.
//
//   coverage    — track × drive matrix: which stick has this track?
//   redundancy  — "every track in playlist X is on ≥2 drives — PASS" + gaps
//   diff        — drive-vs-drive added/removed/changed (B8)
//
// Track identity (deliberately boring, matches how rekordbox copies files):
//   rel_path — NFC-casefolded Contents-relative path. Master/mirror use
//              identical trees, so this is the primary key across drives.
//   title+artist — fallback join when a track lives at different paths on
//              different sticks (B6's "same track, different folder" case).

export interface TrackRow {
  drive_id: string;
  /** NFC-casefolded path relative to Contents/ (audio files only). */
  path: string;
  title: string | null;
  artist: string | null;
  bpm: number | null;
  key: string | null;
  duration_ms: number | null;
  playlist_names: string[];
}

export interface PlaylistEntryRow {
  drive_id: string;
  /** Casefolded path in track_tracks (matches TrackRow.path). */
  track_path: string;
  playlist_name: string;
}

/** One file in a drive's audio manifest (from the light scan walk). */
export interface ManifestRow {
  drive_id: string;
  path: string; // casefolded, Contents-relative
  bytes: number;
  mtime_ms: number;
}

// ---- helpers ----------------------------------------------------------------

/** Casefold like scan.nfcCasefold without importing scan (keeps this pure). */
function fold(s: string): string {
  return s.normalize("NFC").toLowerCase();
}

/** Fallback identity: "artist - title". null when neither side exists. */
function metaKey(
  t: Pick<TrackRow, "title" | "artist">,
): string | null {
  const artist = (t.artist ?? "").trim();
  const title = (t.title ?? "").trim();
  if (!artist && !title) return null;
  return fold(artist ? `${artist} - ${title}` : title);
}

// ---- coverage (B6) ----------------------------------------------------------

export interface TrackCoverage {
  identity: { path: string; title: string | null; artist: string | null };
  /** drive_ids that carry this track */
  drives: string[];
  /** number of drives, repeated for sort/display convenience */
  copies: number;
  /** true when copies < required (the "gone forever if one fails" list) */
  at_risk: boolean;
}

export interface CoverageResult {
  /** drives that actually contributed an inventory (skipped empty ones) */
  drives: { id: string; tracks: number }[];
  /** one row per unique track across the fleet */
  rows: TrackCoverage[];
  /** tracks that exist on exactly `minCopies` drives or fewer */
  at_risk: TrackCoverage[];
  min_copies: number;
  totals: { unique_tracks: number; fully_redundant: number };
}

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
    .sort((a, b) => a.id.localeCompare(b.id));
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
    .sort((a, b) => a.copies - b.copies || a.identity.path.localeCompare(b.identity.path));

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
 * Which drives carry one track? Accepts either identity and merges hits:
 * match by exact casefolded path OR (when the path is unknown) by
 * artist - title. Powers the search box on the coverage tab and the
 * "is this anywhere else?" question mid-gig.
 */
export function trackLocations(
  inventories: Map<string, TrackRow[]>,
  pathQuery: string | null,
  metaQuery: string | null,
): { identity: { path: string; title: string | null; artist: string | null }; drives: string[] } | null {
  const path = pathQuery ? fold(pathQuery) : null;
  const meta = metaQuery ? fold(metaQuery) : null;
  if (!path && !meta) return null;
  const hit: { identity: { path: string; title: string | null; artist: string | null }; drives: string[] } = {
    identity: { path: path ?? "", title: null, artist: null },
    drives: [],
  };
  for (const [driveId, rows] of inventories) {
    for (const t of rows) {
      const byPath = !!path && t.path === path;
      const byMeta = !!meta && metaKey(t) === meta;
      if (byPath || byMeta) {
        if (!hit.drives.includes(driveId)) hit.drives.push(driveId);
        hit.identity.path = t.path;
        hit.identity.title = t.title;
        hit.identity.artist = t.artist;
      }
    }
  }
  return hit.drives.length ? hit : null;
}

// ---- redundancy (B7) --------------------------------------------------------

export interface PlaylistRedundancy {
  playlist: string;
  /** unique tracks in the playlist across every drive that has it */
  unique_tracks: number;
  /** tracks meeting the floor */
  protected_tracks: number;
  tracks: (TrackCoverage & { playlists: string[] })[];
  verdict: "pass" | "warn" | "fail" | "unknown";
  detail: string;
}

export interface RedundancyResult {
  playlists: PlaylistRedundancy[];
  /** fleet-wide verdict across all audited playlists */
  overall: "pass" | "warn" | "fail" | "unknown";
  summary: string;
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
  // playlist name (folded) → set of folded track paths
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

  // folded path → { coverage row, memberships }
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

  const out: PlaylistRedundancy[] = [];
  for (const [plKey, paths] of plTracks) {
    const rows: (TrackCoverage & { playlists: string[] })[] = [];
    for (const p of paths) {
      const entry = trackIndex.get(p);
      if (!entry) continue; // track row missing on every scanned drive
      rows.push({ ...entry.cov, playlists: [...entry.playlists].sort() });
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
    out.push({
      playlist: plDisplay.get(plKey) ?? plKey,
      unique_tracks: rows.length,
      protected_tracks: rows.length - gaps.length,
      tracks: rows.sort((a, b) => a.copies - b.copies),
      verdict,
      detail:
        rows.length === 0
          ? "no track inventory on any scanned drive — run a scan"
          : gaps.length === 0
            ? `all ${rows.length} tracks on ≥${minCopies} drives`
            : `${gaps.length} of ${rows.length} track(s) below ${minCopies} copies` +
              (fails ? ` (${fails} on a single drive)` : ""),
    });
  }

  out.sort((a, b) => {
    const rank = { fail: 0, warn: 1, unknown: 2, pass: 3 } as const;
    return rank[a.verdict] - rank[b.verdict] || b.unique_tracks - a.unique_tracks;
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

export type DiffKind = "added" | "removed" | "changed";

export interface DiffRow {
  path: string;
  title: string | null;
  artist: string | null;
  kind: DiffKind;
  /** source-side size/bytes when known (file manifests) */
  bytes_a?: number;
  bytes_b?: number;
}

export interface FleetDiff {
  a: string;
  b: string;
  added: DiffRow[]; // on b, missing on a
  removed: DiffRow[]; // on a, missing on b
  changed: DiffRow[]; // both present, bytes differ
  summary: string;
}

function metaIndex(rows: (TrackRow | ManifestRow)[]): {
  byPath: Map<string, TrackRow | ManifestRow>;
  byMeta: Map<string, TrackRow | ManifestRow>;
} {
  const byPath = new Map<string, TrackRow | ManifestRow>();
  const byMeta = new Map<string, TrackRow | ManifestRow>();
  for (const r of rows) {
    const p = "path" in r ? fold(r.path) : "";
    if (p) byPath.set(p, r);
    if ("title" in r) {
      const m = metaKey(r);
      if (m) byMeta.set(m, r);
    }
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
  const rowOf = (r: TrackRow | ManifestRow): DiffRow => ({
    path: r.path,
    title: "title" in r ? (r.title ?? null) : null,
    artist: "artist" in r ? (r.artist ?? null) : null,
    kind: "added",
  });

  const matchedB = new Set<string>();
  const bytesOf = (r: TrackRow | ManifestRow | undefined): number | undefined =>
    r && "bytes" in r ? r.bytes : undefined;
  for (const [path, ra] of ia.byPath) {
    const rb =
      ib.byPath.get(path) ??
      (() => {
        const m = metaKey(ra as TrackRow);
        if (!m) return undefined;
        const cand = ib.byMeta.get(m);
        return cand ? (matchedB.add(fold(cand.path)), cand) : undefined;
      })();
    if (rb) {
      matchedB.add(path);
      const ba = bytesOf(fa.byPath.get(path)) ?? bytesOf(ra);
      const bb = bytesOf(fb.byPath.get(path)) ?? bytesOf(rb);
      if (
        ba !== undefined &&
        bb !== undefined &&
        ba !== bb
      ) {
        changed.push({ ...rowOf(ra), kind: "changed", bytes_a: ba, bytes_b: bb });
      }
    } else {
      removed.push({ ...rowOf(ra), kind: "removed" });
    }
  }
  for (const [path, rb] of ib.byPath) {
    if (matchedB.has(path)) continue;
    const m = metaKey(rb as TrackRow);
    if (m && ia.byMeta.has(m)) continue; // caught on the a-side byMeta pass
    added.push({ ...rowOf(rb), kind: "added" });
  }

  const byPathSort = (x: DiffRow, y: DiffRow) =>
    x.path.localeCompare(y.path);
  added.sort(byPathSort);
  removed.sort(byPathSort);
  changed.sort(byPathSort);
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
