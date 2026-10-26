/**
 * play-history.ts — Mine rekordbox play history for transition pairs (#441).
 *
 * Read-only against master.db. Extracts consecutive plays within a time
 * window and builds transition pairs with BPM/key/energy/genre deltas.
 * These are gold-standard positive examples for MegaSet set building.
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { round1, round2 } from "../shared/leaf/fmt";

/** Maximum gap between consecutive plays to consider them a transition. */
const MAX_GAP_MS = 30 * 60 * 1000; // 30 minutes

export interface TransitionPair {
  /** Content ID of the first track. */
  trackA: string;
  /** Content ID of the second track. */
  trackB: string;
  /** Title of track A. */
  titleA: string;
  /** Title of track B. */
  titleB: string;
  /** Artist of track A. */
  artistA: string;
  /** Artist of track B. */
  artistB: string;
  /** BPM of track A. */
  bpmA: number | null;
  /** BPM of track B. */
  bpmB: number | null;
  /** Absolute BPM delta. */
  bpmDelta: number | null;
  /** Key of track A. */
  keyA: string | null;
  /** Key of track B. */
  keyB: string | null;
  /** Genre of track A. */
  genreA: string | null;
  /** Genre of track B. */
  genreB: string | null;
  /** Whether genres match. */
  genreMatch: boolean;
  /** Timestamp of track A play. */
  playedAtA: string;
  /** Timestamp of track B play. */
  playedAtB: string;
  /** Gap between plays in seconds. */
  gapSeconds: number;
}

export interface PlayHistoryResult {
  command: "rb-play-history";
  ok: boolean;
  totalPlays: number;
  transitions: number;
  uniqueTracks: number;
  genreMatchRate: number | null;
  avgBpmDelta: number | null;
  pairs: TransitionPair[];
  error?: string;
}

interface HistoryRow {
  ContentID: string;
  Title: string;
  Artist: string;
  BPM: number | null;
  ScaleName: string | null;
  GenreName: string | null;
  created_at: string;
}

const playHistoryFailure = (error: string): PlayHistoryResult => ({
  command: "rb-play-history",
  ok: false,
  totalPlays: 0,
  transitions: 0,
  uniqueTracks: 0,
  genreMatchRate: null,
  avgBpmDelta: null,
  pairs: [],
  error,
});

export function minePlayHistory(dbPath: string, opts?: { limit?: number }): PlayHistoryResult {
  if (!existsSync(dbPath)) return playHistoryFailure(`no master DB at ${dbPath}`);

  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT
           h.ContentID,
           c.Title,
           COALESCE(a.Name, '') AS Artist,
           c.BPM,
           k.ScaleName,
           g.Name AS GenreName,
           h.created_at
         FROM djmdSongHistory h
         JOIN djmdContent c ON c.ID = h.ContentID
         LEFT JOIN djmdArtist a ON a.ID = c.ArtistID
         LEFT JOIN djmdKey k ON k.ID = c.KeyID
         LEFT JOIN djmdGenre g ON g.ID = c.GenreID
         ORDER BY h.created_at ASC`,
      )
      .all() as HistoryRow[];

    const totalPlays = rows.length;
    if (totalPlays === 0) return playHistoryFailure("no play history in master.db");

    const pairs: TransitionPair[] = [];
    const trackIds = new Set<string>();

    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i];
      const b = rows[i + 1];
      if (a === undefined || b === undefined) continue;

      const timeA = new Date(a.created_at).getTime();
      const timeB = new Date(b.created_at).getTime();
      if (!Number.isFinite(timeA) || !Number.isFinite(timeB)) continue;

      const gapMs = timeB - timeA;
      if (gapMs <= 0 || gapMs > MAX_GAP_MS) continue;
      if (a.ContentID === b.ContentID) continue;

      const bpmA = a.BPM !== null && Number.isFinite(a.BPM) ? a.BPM : null;
      const bpmB = b.BPM !== null && Number.isFinite(b.BPM) ? b.BPM : null;

      trackIds.add(a.ContentID);
      trackIds.add(b.ContentID);

      pairs.push({
        trackA: a.ContentID,
        trackB: b.ContentID,
        titleA: a.Title,
        titleB: b.Title,
        artistA: a.Artist,
        artistB: b.Artist,
        bpmA,
        bpmB,
        bpmDelta: bpmA !== null && bpmB !== null ? round1(Math.abs(bpmA - bpmB)) : null,
        keyA: a.ScaleName ?? null,
        keyB: b.ScaleName ?? null,
        genreA: a.GenreName ?? null,
        genreB: b.GenreName ?? null,
        genreMatch: a.GenreName !== null && a.GenreName === b.GenreName,
        playedAtA: a.created_at,
        playedAtB: b.created_at,
        gapSeconds: round1(gapMs / 1000),
      });
    }

    const limit = opts?.limit;
    const limitedPairs = limit !== undefined && limit > 0 ? pairs.slice(0, limit) : pairs;

    const genreMatches = pairs.filter((p) => p.genreMatch).length;
    const bpmDeltas = pairs.map((p) => p.bpmDelta).filter((d): d is number => d !== null);

    return {
      command: "rb-play-history",
      ok: true,
      totalPlays,
      transitions: pairs.length,
      uniqueTracks: trackIds.size,
      genreMatchRate: pairs.length > 0 ? round2(genreMatches / pairs.length) : null,
      avgBpmDelta:
        bpmDeltas.length > 0
          ? round1(bpmDeltas.reduce((a, b) => a + b, 0) / bpmDeltas.length)
          : null,
      pairs: limitedPairs,
    };
  } finally {
    db.close();
  }
}

export function printPlayHistoryReport(r: PlayHistoryResult): string {
  if (!r.ok) return `play-history: ${r.error}`;
  const lines: string[] = [
    `play-history: ${r.transitions} transitions from ${r.totalPlays} plays (${r.uniqueTracks} unique tracks)`,
  ];
  if (r.genreMatchRate !== null)
    lines.push(
      `  genre match rate: ${round1(r.genreMatchRate * 100)}% of transitions stay in-genre`,
    );
  if (r.avgBpmDelta !== null) lines.push(`  avg BPM delta: ${r.avgBpmDelta}`);
  if (r.pairs.length > 0) {
    lines.push("");
    for (const p of r.pairs.slice(0, 20)) {
      const bpm = p.bpmDelta !== null ? ` Δ${p.bpmDelta}bpm` : "";
      const genre = p.genreMatch
        ? ` [${p.genreA}]`
        : p.genreA !== null && p.genreB !== null
          ? ` [${p.genreA}→${p.genreB}]`
          : "";
      lines.push(`  ${p.artistA} - ${p.titleA}  →  ${p.artistB} - ${p.titleB}${bpm}${genre}`);
    }
    if (r.pairs.length > 20) lines.push(`  ... and ${r.pairs.length - 20} more`);
  }
  return lines.join("\n");
}
