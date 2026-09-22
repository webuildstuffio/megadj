// archive/reader-core.ts — the SQLite query body of the archive reader
// (#205 split from archive.ts): the readonly handle, the rows/row seam
// the split-out modules type against, the track_keys read-cache, and
// TRACK_COLS. archive.ts keeps the ArchiveReader façade and imports this
// — consumers' `from "./reader-core.ts/archive"` import path is unchanged.
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";

export const TRACK_COLS = `video_id, title, artist, album, status, bitrate_kbps,
  codec, file_path, duration_s, genre, energy, source, liked_position,
  first_seen_at, updated_at`;

/** Read-only connection and key-cache query family. */
export class ArchiveReaderCore {
  private db: Database | null = null;
  private hasKeyCache: boolean | null = null;
  /** Fresh file reads remembered for this reader's lifetime. This preserves
   *  the strict DB-readonly contract without paying the same stale/missing
   *  ledger miss on every set-builder request handled by the server. */
  private liveKeys = new Map<
    string,
    { key: string; analyzedAt: string; size: number; mtimeMs: number }
  >();
  readonly path: string;
  protected readonly shelfContents: string | undefined;

  constructor(path: string, shelfContents?: string) {
    this.path = path;
    this.shelfContents = shelfContents;
  }

  /** Public "is the archive DB present" probe (routes/agents use this to
   *  degrade gracefully; keeps `handle( + ` private). */
  available(): boolean {
    return this.handle() !== null;
  }

  /** Public readonly access to the opened handle — tests (readonly-flag
   *  regression) and split modules probe it without private-state casts;
   *  bun's `readonly: true` keeps writes throwing at the driver level. */
  get handleOrNull(): Database | null {
    return this.db;
  }

  /** Lazily open readonly; missing DB → null (agents get a clean "no
   *  archive yet" result, not a stack trace). */
  protected handle(): Database | null {
    if (this.db) return this.db;
    if (!existsSync(this.path)) return null;
    this.db = new Database(this.path, { readonly: true });
    return this.db;
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.hasKeyCache = null;
    this.liveKeys.clear();
  }

  /** Public read access for the split-out modules (archive/similar.ts):
   * parameterised SELECT only — still read-only by construction. */
  rows<T>(sql: string, ...params: SQLQueryBindings[]): T[] {
    const db = this.handle();
    if (!db) return [];
    return db.query(sql).all(...params) as T[];
  }

  /** rows(...)[0] — undefined on empty. ArchiveQuery leaf contract; see
   *  archive/types.ts. */
  row<T>(sql: string, ...params: SQLQueryBindings[]): T | undefined {
    return this.rows<T>(sql, ...params)[0];
  }

  // ---------- track_keys read-cache (strictly readonly) ----------

  private sourceIdentity(sourcePath: string): {
    size: number;
    mtimeMs: number;
  } | null {
    try {
      const stat = statSync(sourcePath);
      return stat.isFile() ? { size: stat.size, mtimeMs: stat.mtimeMs } : null;
    } catch (error) {
      // A file can vanish between the candidate census and this lookup. A
      // missing identity must never validate a stale key record.
      console.debug("archive key cache could not stat candidate", error);
      return null;
    }
  }

  keyRecord(
    videoId: string,
    sourcePath: string,
  ): { key: string; analyzedAt: string } | null {
    const memoryKey = `${videoId}\0${sourcePath}`;
    const identity = this.sourceIdentity(sourcePath);
    if (!identity) return null;
    const live = this.liveKeys.get(memoryKey);
    if (
      live &&
      live.size === identity.size &&
      live.mtimeMs === identity.mtimeMs
    )
      return live;
    if (this.hasKeyCache === null) {
      this.hasKeyCache =
        this.row<{ present: number }>(
          `SELECT 1 AS present FROM sqlite_master
           WHERE type = 'table' AND name = 'track_keys'`,
        ) !== undefined;
    }
    if (!this.hasKeyCache) return null;
    const row = this.row<{
      key: string;
      analyzed_at: string;
      track_updated_at: string;
    }>(
      `SELECT k.key, k.analyzed_at, t.updated_at AS track_updated_at
       FROM track_keys k
       JOIN tracks t ON t.video_id = k.video_id
       WHERE k.video_id = ? AND k.source_path = ?`,
      videoId,
      sourcePath,
    );
    if (!row) return null;
    const analyzedAt = Date.parse(row.analyzed_at);
    const trackUpdatedAt = Date.parse(row.track_updated_at);
    if (
      !Number.isFinite(analyzedAt) ||
      !Number.isFinite(trackUpdatedAt) ||
      trackUpdatedAt > analyzedAt ||
      identity.mtimeMs > analyzedAt
    )
      return null;
    return { key: row.key, analyzedAt: row.analyzed_at };
  }

  rememberKeyRecord(rec: {
    videoId: string;
    key: string;
    sourcePath: string;
  }): void {
    const identity = this.sourceIdentity(rec.sourcePath);
    if (!identity) return;
    this.liveKeys.set(`${rec.videoId}\0${rec.sourcePath}`, {
      key: rec.key,
      analyzedAt: new Date().toISOString(),
      ...identity,
    });
  }

  /** The ArchiveTrack column list, shared by every query that returns
   *  full rows (search/stats/recent) so the wire shape can't fork. */
  trackCols(): string {
    return TRACK_COLS;
  }
}
