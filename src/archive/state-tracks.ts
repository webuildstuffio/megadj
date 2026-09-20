import { ArchiveCore } from "./state-core";
import type { TrackRow, TrackStatus, MarkDownloadedInfo } from "./state-types";
import {
  electGenre,
  parseVotes,
  serializeVotes,
  type GenreVote,
} from "../fulltags/genre/genre-vote";

/** Track lifecycle and inventory queries. */
export class ArchiveTracks extends ArchiveCore {
  upsertTrackFromPlaylist(
    videoId: string,
    position: number,
    title: string | null,
    source = "liked",
  ): void {
    const now = this.now();
    this.db
      .query(
        `INSERT INTO tracks (video_id, liked_position, title, source, first_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET
           liked_position = excluded.liked_position,
           title = COALESCE(excluded.title, tracks.title),
           updated_at = excluded.updated_at`,
      )
      .run(videoId, position, title, source, now, now);
  }

  /** Read one row by its ledger id (the sync loop's per-track reads). */
  trackById(trackId: string): TrackRow | null {
    return (
      (this.db.query("SELECT * FROM tracks WHERE video_id = ?").get(trackId) as
        TrackRow | undefined) ?? null
    );
  }

  markAttempt(videoId: string, error: string | null): void {
    const now = this.now();
    const row = this.db
      .query("SELECT attempts FROM tracks WHERE video_id = ?")
      .get(videoId) as { attempts: number } | null;
    this.db
      .query(
        "UPDATE tracks SET attempts = ?, last_attempt_at = ?, last_error = ?, updated_at = ? WHERE video_id = ?",
      )
      .run((row?.attempts ?? 0) + 1, now, error, now, videoId);
  }

  markDownloaded(videoId: string, info: MarkDownloadedInfo): void {
    const now = this.now();
    this.db
      .query(
        `UPDATE tracks SET
           status = 'downloaded', title = COALESCE(?, title),
           artist = COALESCE(?, artist), album = COALESCE(?, album),
           genre = COALESCE(?, genre), energy = COALESCE(?, energy),
           artwork_status = COALESCE(?, artwork_status),
           format_id = ?, bitrate_kbps = ?, codec = ?, file_path = ?,
           file_size_bytes = ?, duration_s = ?, last_error = NULL, updated_at = ?
         WHERE video_id = ?`,
      )
      .run(
        info.title,
        info.artist,
        info.album,
        info.genre ?? null,
        info.energy ?? null,
        info.artworkStatus ?? null,
        info.formatId,
        info.bitrateKbps,
        info.codec,
        info.filePath,
        info.fileSizeBytes,
        info.durationS,
        now,
        videoId,
      );
  }

  markGone(videoId: string, reason: string): void {
    this.markStatus(videoId, "gone", { lastError: reason });
  }

  markFailed(videoId: string, error: string): void {
    this.markStatus(videoId, "failed", { lastError: error });
  }

  resetFailures(): number {
    return this.db
      .query(
        "UPDATE tracks SET status = 'pending', attempts = 0, last_error = NULL, updated_at = ? WHERE status = 'failed'",
      )
      .run(this.now()).changes;
  }

  markNotMusic(videoId: string, category: string | null): void {
    this.markStatus(videoId, "skipped_not_music", {
      lastError: `category: ${category ?? "unknown"}`,
    });
  }

  private markStatus(
    videoId: string,
    status: TrackStatus,
    fields: {
      filePath?: string;
      durationS?: number | null;
      lastError?: string;
    } = {},
  ): void {
    this.db
      .query(
        "UPDATE tracks SET status = ?, file_path = COALESCE(?, file_path), duration_s = COALESCE(?, duration_s), last_error = COALESCE(?, last_error), updated_at = ? WHERE video_id = ?",
      )
      .run(
        status,
        fields.filePath ?? null,
        fields.durationS ?? null,
        fields.lastError ?? null,
        this.now(),
        videoId,
      );
  }

  updateFilePath(videoId: string, newFilePath: string): void {
    this.db
      .query(
        "UPDATE tracks SET file_path = ?, updated_at = ? WHERE video_id = ?",
      )
      .run(newFilePath, this.now(), videoId);
  }

  updateEnergyColumn(videoId: string, energy: number): void {
    this.db
      .query("UPDATE tracks SET energy = ?, updated_at = ? WHERE video_id = ?")
      .run(energy, this.now(), videoId);
  }

  trackByFilePath(filePath: string): TrackRow | null {
    return (
      (this.db
        .query(
          "SELECT * FROM tracks WHERE file_path = ? AND status = 'downloaded' LIMIT 1",
        )
        .get(filePath) as TrackRow | undefined) ?? null
    );
  }

  markShortSkipped(
    videoId: string,
    filePath: string,
    durationS: number | null,
  ): void {
    this.markStatus(videoId, "skipped_short", { filePath, durationS });
  }

  updateGenre(videoId: string, genre: string | null): void {
    this.db
      .query(
        "UPDATE tracks SET genre = COALESCE(?, genre), updated_at = ? WHERE video_id = ?",
      )
      .run(genre, this.now(), videoId);
  }

  /** #173 vote-ladder write seam: elect from collected votes and persist
   *  the breakdown. The genre write keeps updateGenre's COALESCE (fills
   *  EMPTY columns; the kNN inference rung is the only caller allowed to
   *  write over existing labels, via overwriteGenre). A null election is
   *  an honest no-op — the breakdown still persists so the absent genre
   *  is explainable ("two rungs voted, weights 0.2 < 0.35" etc.).
   *  Returns the elected genre (null = nothing written). */
  applyGenreVotes(videoId: string, votes: GenreVote[]): string | null {
    const elected = electGenre(votes);
    if (elected.genre !== null) {
      this.db
        .query(
          "UPDATE tracks SET genre = COALESCE(?, genre), genre_votes = ?, updated_at = ? WHERE video_id = ?",
        )
        .run(elected.genre, serializeVotes(votes), this.now(), videoId);
    } else {
      this.db
        .query(
          "UPDATE tracks SET genre_votes = ?, updated_at = ? WHERE video_id = ?",
        )
        .run(serializeVotes(votes), this.now(), videoId);
    }
    return elected.genre;
  }

  /** The persisted vote breakdown for one track (null when never voted). */
  genreVotes(videoId: string): GenreVote[] {
    const row = this.db
      .query("SELECT genre_votes FROM tracks WHERE video_id = ?")
      .get(videoId) as { genre_votes: string | null } | null;
    return parseVotes(row?.genre_votes ?? null);
  }

  /** Explicitly clear a label (genre = NULL) so the row re-enters the
   *  inference path as a QUERY (`genreSeeds` selects on `genre IS NULL`).
   *  updateGenre's COALESCE makes a null a deliberate no-op — unstranding
   *  placeholder rows (#61) needs a real clear. Idempotent by nature. */
  clearGenre(videoId: string): void {
    this.db
      .query(
        "UPDATE tracks SET genre = NULL, updated_at = ? WHERE video_id = ?",
      )
      .run(this.now(), videoId);
  }

  /** Set/clear the dispute flag on one track. `flag` is the audited
   *  vocabulary ('disputed'); null clears. The label column is NEVER
   *  touched — flagging is metadata, a human decision stays human.
   *  A null clear is CONDITIONAL: it only clears the 'disputed'
   *  vocabulary value, never a `resolved:<note>` audit trail (#64) —
   *  the --flag self-heal loop calls this on every embedded row each
   *  run, and an unconditional clear would erase review notes. A new
   *  'disputed' write DOES overwrite a stale resolution (fresh
   *  evidence supersedes an old verdict). */
  setGenreFlag(videoId: string, flag: "disputed" | null): void {
    if (flag === null) {
      this.db
        .query(
          "UPDATE tracks SET genre_flag = NULL, updated_at = ? WHERE video_id = ? AND (genre_flag IS NULL OR genre_flag = 'disputed')",
        )
        .run(this.now(), videoId);
      return;
    }
    this.db
      .query(
        "UPDATE tracks SET genre_flag = ?, updated_at = ? WHERE video_id = ?",
      )
      .run(flag, this.now(), videoId);
  }

  /** The disputed rows with their labels — the #64 review surface's
   *  read half. Only flagged rows appear; embed evidence joins via the
   *  disputeConsensus view when it exists. */
  disputedRows(): {
    video_id: string;
    title: string | null;
    artist: string | null;
    genre: string;
  }[] {
    return this.db
      .query(
        `SELECT video_id, title, artist, genre FROM tracks
         WHERE genre_flag = 'disputed' AND genre IS NOT NULL AND genre != ''
         ORDER BY updated_at DESC`,
      )
      .all() as {
      video_id: string;
      title: string | null;
      artist: string | null;
      genre: string;
    }[];
  }

  /** The CURRENT kNN consensus for (flagged) rows, computed over the
   *  live embeddings: each flagged row is held out and the unflagged
   *  seeded neighbours vote (same engine `--flag` uses; flagged rows
   *  are excluded from the SEEDS, so a flagged row's verdict comes
   *  from unflagged neighbours only). Null consensus = the
   *  neighbourhood no longer agrees. Computed by genre-disputes.ts —
   *  this accessor only supplies the raw rows (seeds + the flagged
   *  queries), keeping the state layer engine-free. */
  disputeVoteInputs(): {
    flagged: {
      video_id: string;
      vec_json: string;
      analyzed_at: string;
    }[];
    seeds: { video_id: string; genre: string; vec_json: string }[];
  } {
    const flagged = this.db
      .query(
        `SELECT e.video_id, e.vec_json, e.analyzed_at
         FROM embeddings e JOIN tracks t ON t.video_id = e.video_id
         WHERE t.genre_flag = 'disputed' AND t.status = 'downloaded'`,
      )
      .all() as {
      video_id: string;
      vec_json: string;
      analyzed_at: string;
    }[];
    const seeds = this.db
      .query(
        `SELECT e.video_id, t.genre, e.vec_json
         FROM embeddings e JOIN tracks t ON t.video_id = e.video_id
         WHERE t.status = 'downloaded' AND t.genre IS NOT NULL AND t.genre != ''
           AND (t.genre_flag IS NULL OR t.genre_flag != 'disputed')`,
      )
      .all() as { video_id: string; genre: string; vec_json: string }[];
    return { flagged, seeds };
  }

  /** The #64 "agree" verb: the human ratifies the AUDIO. Forces the
   *  label (updateGenre's COALESCE would refuse an overwrite — this is
   *  the deliberate exception, human-approved) and clears the flag so
   *  the row re-enters seeding (self-heal). */
  agreeDispute(videoId: string, genre: string): void {
    this.db
      .query(
        "UPDATE tracks SET genre = ?, genre_flag = NULL, updated_at = ? WHERE video_id = ?",
      )
      .run(genre, this.now(), videoId);
  }

  /** Audit-trail note for a dispute resolution (#64 --note). Lives in
   *  the flag column itself as a suffix — one column, no new table, and
   *  the census can count resolutions without a join. */
  setGenreFlagNote(videoId: string, note: string): void {
    this.db
      .query(
        "UPDATE tracks SET genre_flag = 'resolved:' || ?, updated_at = ? WHERE video_id = ?",
      )
      .run(note.slice(0, 120), this.now(), videoId);
  }

  genreSeeds(): {
    seeds: { video_id: string; genre: string; vec_json: string }[];
    queries: { video_id: string; title: string | null; vec_json: string }[];
  } {
    // flagged-disputed seeds cannot vote: one bad label poisons every
    // neighbourhood it lands in, and the flag already says a unanimous
    // audio consensus contradicts it (§5b.3 step 2). Excluded, not
    // rewritten — the human decision remains open.
    const seeds = this.db
      .query(
        `SELECT e.video_id, t.genre, e.vec_json
         FROM embeddings e JOIN tracks t ON t.video_id = e.video_id
         WHERE t.status = 'downloaded' AND t.genre IS NOT NULL AND t.genre != ''
           AND (t.genre_flag IS NULL OR t.genre_flag != 'disputed')`,
      )
      .all() as { video_id: string; genre: string; vec_json: string }[];
    const queries = this.db
      .query(
        `SELECT e.video_id, t.title, e.vec_json
         FROM embeddings e JOIN tracks t ON t.video_id = e.video_id
         WHERE t.status = 'downloaded' AND (t.genre IS NULL OR t.genre = '')`,
      )
      .all() as { video_id: string; title: string | null; vec_json: string }[];
    return { seeds, queries };
  }

  /** Eval population for `genre --eval`: every embedded downloaded track
   *  with a label AND its duration + artist — the LOO harness applies the
   *  measured 90–480 s band itself (G5: hygiene, applied at eval time
   *  only, never a data change); artist feeds the Tier-0 diagnostics and
   *  the --artist-disjoint rerun (research review 0.1/0.2/F2). Reads the
   *  same rows `genreSeeds` sees plus `duration_s`/`artist` so one query
   *  keeps the views identical. */
  evalPopulation(): {
    video_id: string;
    genre: string;
    duration_s: number | null;
    artist: string | null;
    vec_json: string;
  }[] {
    return this.db
      .query(
        `SELECT e.video_id, t.genre, t.duration_s, t.artist, e.vec_json
         FROM embeddings e JOIN tracks t ON t.video_id = e.video_id
         WHERE t.status = 'downloaded' AND t.genre IS NOT NULL AND t.genre != ''`,
      )
      .all() as {
      video_id: string;
      genre: string;
      duration_s: number | null;
      artist: string | null;
      vec_json: string;
    }[];
  }

  /** Every downloaded track WITH a label — embeddings NOT required. The
   *  refold data half canonicalizes labels wherever they live (a track
   *  analyzed before its embedding exists still deserves `edm` → `EDM`);
   *  the scoring/eval half uses `evalPopulation` (vectors required). */
  labeledPopulation(): { video_id: string; genre: string }[] {
    return this.db
      .query(
        `SELECT video_id, genre FROM tracks
         WHERE status = 'downloaded' AND genre IS NOT NULL AND genre != ''`,
      )
      .all() as { video_id: string; genre: string }[];
  }

  updateArtworkStatus(videoId: string, status: string): void {
    this.db
      .query(
        "UPDATE tracks SET artwork_status = ?, updated_at = ? WHERE video_id = ?",
      )
      .run(status, this.now(), videoId);
  }

  queuedArtworkTracks(): TrackRow[] {
    return this.db
      .query(
        "SELECT * FROM tracks WHERE artwork_status = 'queued' ORDER BY updated_at",
      )
      .all() as TrackRow[];
  }

  pendingTracks(): TrackRow[] {
    return this.db
      .query(
        `SELECT * FROM tracks WHERE status IN ('pending', 'failed') AND attempts < 5
         ORDER BY status = 'pending' DESC, liked_position IS NULL, liked_position, first_seen_at`,
      )
      .all() as TrackRow[];
  }

  /** The YouTube-side download queue for UI review (the Backlog tab's
   *  pending card): pending/failed rows that `sync` would attempt. */
  pendingQueue(limit = 500): TrackRow[] {
    return this.db
      .query(
        `SELECT * FROM tracks WHERE status IN ('pending', 'failed') AND attempts < 5
         ORDER BY status = 'pending' DESC, liked_position IS NULL, liked_position, first_seen_at
         LIMIT ?`,
      )
      .all(limit) as TrackRow[];
  }

  /** User-marked "not YouTube music" (Sep 19): the row leaves the
   *  download queue permanently — same terminal state the ingest skipper
   *  uses, and `skipped_not_music` is sticky across playlist refreshes
   *  (upsert never touches status). Category records WHO decided. */
  markNotMusicByUser(videoId: string): boolean {
    const row = this.db
      .query("SELECT status FROM tracks WHERE video_id = ?")
      .get(videoId) as { status: string } | undefined;
    if (!row) return false;
    this.markNotMusic(videoId, "user-marked not-music");
    return row.status !== "skipped_not_music";
  }

  downloadedCount(): number {
    const row = this.db
      .query("SELECT COUNT(*) as n FROM tracks WHERE status = 'downloaded'")
      .get() as { n: number };
    return row.n;
  }

  /** #256 link-first: park a row with its acquisition link(s). The rip
   *  was deliberately skipped — this is an HONEST terminal state, never
   *  counted as downloaded library. Links persist as JSON so the user
   *  can go through the official channel later. */
  markLinkSurfaced(trackId: string, linksJson: string, detail: string): void {
    this.db
      .query(
        "UPDATE tracks SET status = 'link_surfaced', source_links = ?, last_error = ?, updated_at = ? WHERE video_id = ?",
      )
      .run(linksJson, detail, this.now(), trackId);
  }

  /** #267 Bug C: `--force-rip` only held its documented contract for
   *  never-attempted rows — once a row was parked `link_surfaced`,
   *  pendingTracks() (pending/failed only) never re-queued it, so a
   *  re-run streamed 0 tracks and still exited 0. Requeue flips the
   *  row's OWN source scope back to pending (attempts kept: the
   *  backoff ceiling still applies) and returns whether it matched. */
  requeueLinkSurfaced(trackId: string): boolean {
    const r = this.db
      .query(
        "UPDATE tracks SET status = 'pending', updated_at = ? WHERE video_id = ? AND status = 'link_surfaced'",
      )
      .run(this.now(), trackId);
    return r.changes > 0;
  }

  /** Surfaced-link checklist (Sep 19): the user clicked the link, saved
   *  the official file into the downloads folder, and checks it off.
   *  `done=false` undoes (a mis-check). Only flips the timestamp — the
   *  status stays `link_surfaced` until the file actually lands through
   *  the fulltags batch ingest, which is the real state machine. */
  markSurfacedDone(trackId: string, done: boolean): void {
    this.db
      .query(
        "UPDATE tracks SET surfaced_done_at = ?, updated_at = ? WHERE video_id = ? AND status = 'link_surfaced'",
      )
      .run(done ? this.now() : null, this.now(), trackId);
  }

  /** True when the row EXISTS and is in the surfaced-link cohort (the
   *  gate `surfaced-note` checks before flipping the timestamp). */
  markSurfacedDoneExists(trackId: string): boolean {
    const row = this.db
      .query(
        "SELECT 1 FROM tracks WHERE video_id = ? AND status = 'link_surfaced'",
      )
      .get(trackId);
    return row !== null && row !== undefined;
  }

  /** Identity backfill for SC rows that reached a terminal state with thin
   *  metadata (#258-followup): set/user fan-out entries carry only id+url,
   *  so a row marked gone/link_surfaced at probe time never learned its
   *  title/artist. Fills ONLY empty columns — never overwrites real
   *  metadata (same fill-don't-clobber contract as markDownloaded). */
  backfillTrackIdentity(
    videoId: string,
    title: string | null,
    artist: string | null,
  ): void {
    this.db
      .query(
        `UPDATE tracks SET
           title = COALESCE(NULLIF(TRIM(title), ''), ?, title),
           artist = COALESCE(NULLIF(TRIM(artist), ''), ?, artist),
           updated_at = updated_at
         WHERE video_id = ?`,
      )
      .run(title, artist, videoId);
  }

  /** Record that a rip happened despite an existing link (--force-rip):
   *  the decision is kept on the row for provenance. */
  markForcedRip(trackId: string, linksJson: string): void {
    this.db
      .query(
        "UPDATE tracks SET source_links = ?, updated_at = ? WHERE video_id = ?",
      )
      .run(linksJson, this.now(), trackId);
  }

  /** The stored acquisition links for one row (null when none). */
  sourceLinks(trackId: string): string | null {
    const row = this.db
      .query("SELECT source_links FROM tracks WHERE video_id = ?")
      .get(trackId) as { source_links: string | null } | null;
    return row?.source_links ?? null;
  }

  /** Count of surfaced-link rows (sync/summary honesty: surfaced ≠
   *  downloaded). */
  linkSurfacedCount(): number {
    const row = this.db
      .query("SELECT COUNT(*) as n FROM tracks WHERE status = 'link_surfaced'")
      .get() as { n: number };
    return row.n;
  }

  /** Every surfaced-link row — the "go get these properly" queue. */
  linkSurfacedTracks(): TrackRow[] {
    return this.db
      .query(
        "SELECT * FROM tracks WHERE status = 'link_surfaced' ORDER BY first_seen_at",
      )
      .all() as TrackRow[];
  }

  statusCounts(): Record<string, number> {
    const rows = this.db
      .query("SELECT status, COUNT(*) as n FROM tracks GROUP BY status")
      .all() as { status: string; n: number }[];
    return Object.fromEntries(rows.map((row) => [row.status, row.n]));
  }

  allTracks(): TrackRow[] {
    return this.db
      .query("SELECT * FROM tracks ORDER BY liked_position")
      .all() as TrackRow[];
  }

  downloadedWithFiles(): TrackRow[] {
    return this.allTracks().filter(
      (track) => track.status === "downloaded" && track.file_path,
    );
  }
}
