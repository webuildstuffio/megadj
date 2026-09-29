/**
 * playlist-evidence.ts — Rekordbox playlists as genre evidence (B4.6).
 *
 * If a playlist is ≥70% one genre family, membership in that playlist
 * is evidence at the `user` scope. This turns your manual playlist
 * organization into an additional signal for the genre estimator.
 *
 * Opt-in via config — only agent-managed playlists under DJ-Imports
 * and MegaSets roots are candidates (user playlists never touched).
 */
import type { Database } from "bun:sqlite";
import type { GenreEvidence, EvidenceScope } from "./evidence-store";
import { mapToFamily } from "../genre/taxonomy-v3";

/** Minimum fraction of tracks in a playlist that share one family
 *  for the playlist to count as a genre signal. */
const PLAYLIST_FAMILY_THRESHOLD = 0.7;

/** Minimum playlist size to produce evidence. */
const MIN_PLAYLIST_SIZE = 5;

interface PlaylistRow {
  playlist_id: string;
  playlist_name: string;
}

interface PlaylistTrackRow {
  playlist_id: string;
  video_id: string;
  genre: string | null;
}

export interface PlaylistEvidenceResult {
  /** Number of playlists examined. */
  playlistsExamined: number;
  /** Number of playlists that qualified (≥70% one family). */
  playlistsQualified: number;
  /** Total evidence rows produced. */
  evidenceRows: number;
  /** Details per qualified playlist. */
  details: {
    playlistName: string;
    family: string;
    trackCount: number;
    familyShare: number;
  }[];
}

/**
 * Extract genre evidence from rekordbox playlist membership.
 *
 * For each playlist that is ≥70% one family:
 * - Every track in that playlist gets a `user` scope evidence row
 *   with the majority family
 * - Tracks already tagged with that family still get evidence
 *   (confirmation signal)
 *
 * @param archiveDb - The archive DB with tracks and genre info
 * @param playlistRows - Playlists to examine (from djmdPlaylist)
 * @param playlistTracks - Track membership (from djmdSongPlaylist join)
 * @returns Evidence rows and stats
 */
export function extractPlaylistEvidence(
  playlistRows: readonly PlaylistRow[],
  playlistTracks: readonly PlaylistTrackRow[],
): { evidence: GenreEvidence[]; stats: PlaylistEvidenceResult } {
  const tracksByPlaylist = new Map<string, PlaylistTrackRow[]>();
  for (const t of playlistTracks) {
    const arr = tracksByPlaylist.get(t.playlist_id) ?? [];
    arr.push(t);
    tracksByPlaylist.set(t.playlist_id, arr);
  }

  const evidence: GenreEvidence[] = [];
  const details: PlaylistEvidenceResult["details"] = [];
  let qualified = 0;
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  for (const pl of playlistRows) {
    const tracks = tracksByPlaylist.get(pl.playlist_id);
    if (!tracks || tracks.length < MIN_PLAYLIST_SIZE) continue;

    // Count families
    const familyCounts = new Map<string, number>();
    let withFamily = 0;
    for (const t of tracks) {
      if (t.genre === null) continue;
      const family = mapToFamily(t.genre);
      if (family === null) continue;
      withFamily++;
      familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    }

    if (withFamily === 0) continue;

    // Find majority family
    let bestFamily = "";
    let bestCount = 0;
    for (const [fam, count] of familyCounts) {
      if (count > bestCount) {
        bestFamily = fam;
        bestCount = count;
      }
    }

    const share = bestCount / withFamily;
    if (share < PLAYLIST_FAMILY_THRESHOLD) continue;

    qualified++;
    details.push({
      playlistName: pl.playlist_name,
      family: bestFamily,
      trackCount: tracks.length,
      familyShare: share,
    });

    // Generate evidence for every track in the playlist
    for (const t of tracks) {
      evidence.push({
        trackId: t.video_id,
        annotatorId: `user:playlist:${pl.playlist_name.toLowerCase()}`,
        scope: "user" as EvidenceScope,
        genreFamily: bestFamily,
        genreSubgenre: null,
        confidence: share,
        verified: false,
        audioMatch: null,
        sourceUrl: null,
        evidence: `playlist "${pl.playlist_name}" is ${Math.round(share * 100)}% ${bestFamily}`,
        createdAt: now,
      });
    }
  }

  return {
    evidence,
    stats: {
      playlistsExamined: playlistRows.length,
      playlistsQualified: qualified,
      evidenceRows: evidence.length,
      details,
    },
  };
}

/**
 * Load playlists and their tracks from the rekordbox mirror in archive.db.
 * Only loads playlists under the agent-managed subtrees.
 * Entry point: wired from `bench backfill-playlists` (B4.6 CLI).
 */
export function loadPlaylistData(
  db: Database,
  rootNames: readonly string[] = ["DJ-Imports", "MegaSets"],
): { playlists: PlaylistRow[]; tracks: PlaylistTrackRow[] } {
  // Find playlist folders that are agent-managed roots
  const rootPlaceholders = rootNames.map(() => "?").join(",");

  const playlists = db
    .query(
      `SELECT DISTINCT p.ID AS playlist_id, p.Name AS playlist_name
       FROM djmdPlaylist p
       WHERE p.Name IN (${rootPlaceholders})
         OR p.ParentID IN (
           SELECT ID FROM djmdPlaylist WHERE Name IN (${rootPlaceholders})
         )`,
    )
    .all(...rootNames, ...rootNames) as PlaylistRow[];

  if (playlists.length === 0) return { playlists: [], tracks: [] };

  const playlistIds = playlists.map((p) => p.playlist_id);
  const idPlaceholders = playlistIds.map(() => "?").join(",");

  const tracks = db
    .query(
      `SELECT sp.PlaylistID AS playlist_id, t.video_id, t.genre
       FROM djmdSongPlaylist sp
       JOIN rekordbox_content rc ON rc.ID = sp.ContentID
       JOIN tracks t ON t.video_id = rc.video_id
       WHERE sp.PlaylistID IN (${idPlaceholders})`,
    )
    .all(...playlistIds) as PlaylistTrackRow[];

  return { playlists, tracks };
}
