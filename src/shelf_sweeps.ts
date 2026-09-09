/**
 * Shelf-sweep ledger — the DB-side record of every drive → shelf archive
 * sweep. The `docs/usb-sync-log.md` entry is the human story; this table is
 * the queryable state so "what's on the shelf, from which drive, verified
 * when" never depends on anyone remembering to write markdown.
 *
 * One row per (drive, sweep): the census the sweep saw and the verdict it
 * reached. `megadj shelf-archive` records a row automatically (pass a
 * callback); `megadj status` surfaces the last verdict per drive.
 */

import type { Database } from "bun:sqlite";

export interface ShelfSweepRow {
  id: number;
  /** Volume name swept, e.g. "BANGERS". */
  drive: string;
  /** Shelf volume archived INTO, e.g. "SHELF1". */
  shelf: string;
  /** ISO timestamps. */
  started_at: string;
  finished_at: string | null;
  /** preview | full — a dry run writes a finished preview row. */
  mode: string;
  /** deep = MD5 every same-size pair, not just size-compare. */
  deep: 0 | 1;
  /** trashes walked + into-folder landing (trash rescue runs). */
  trashes: 0 | 1;
  into_folder: string | null;
  /** Drive census: real (non-junk) files seen. */
  files_seen: number;
  /** Same shelf path + same size (byte-identical unless deep). */
  covered_exact: number;
  /** Divergent copies preserved as "<stem> [<drive>]" twins. */
  preserved: number;
  /** Fresh files copied (not already represented on the shelf). */
  copied: number;
  bytes_copied: number;
  /** Copy/verify failures — a sweep with failures > 0 is not done. */
  failed: number;
  /** "complete" | "failed" | "preview" — never invented; derived from counts. */
  verdict: string;
  /** Optional free-text note (operator context for the log). */
  note: string | null;
}

export class ShelfSweeps {
  constructor(private db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS shelf_sweeps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        drive TEXT NOT NULL,
        shelf TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        mode TEXT NOT NULL DEFAULT 'full',
        deep INTEGER NOT NULL DEFAULT 0,
        trashes INTEGER NOT NULL DEFAULT 0,
        into_folder TEXT,
        files_seen INTEGER NOT NULL DEFAULT 0,
        covered_exact INTEGER NOT NULL DEFAULT 0,
        preserved INTEGER NOT NULL DEFAULT 0,
        copied INTEGER NOT NULL DEFAULT 0,
        bytes_copied INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        verdict TEXT NOT NULL DEFAULT 'running',
        note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_shelf_sweeps_drive
        ON shelf_sweeps(drive, started_at);
    `);
  }

  /** Open a sweep row; returns its id. */
  start(info: {
    drive: string;
    shelf: string;
    mode?: string;
    deep?: boolean;
    trashes?: boolean;
    into?: string | null;
  }): number {
    const now = new Date().toISOString();
    const res = this.db
      .query(
        `INSERT INTO shelf_sweeps (drive, shelf, started_at, mode, deep, trashes, into_folder, verdict)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'running')`,
      )
      .run(
        info.drive,
        info.shelf,
        now,
        info.mode ?? "full",
        info.deep ? 1 : 0,
        info.trashes ? 1 : 0,
        info.into ?? null,
      );
    return Number(res.lastInsertRowid);
  }

  /** Finish a sweep: counters + derived verdict. */
  finish(
    id: number,
    counts: {
      filesSeen: number;
      coveredExact: number;
      preserved: number;
      copied: number;
      bytesCopied: number;
      failed: number;
    },
    note?: string,
  ): void {
    const verdict = counts.failed > 0 ? "failed" : "complete";
    this.db
      .query(
        `UPDATE shelf_sweeps SET finished_at = ?, files_seen = ?, covered_exact = ?,
         preserved = ?, copied = ?, bytes_copied = ?, failed = ?, verdict = ?, note = ?
         WHERE id = ?`,
      )
      .run(
        new Date().toISOString(),
        counts.filesSeen,
        counts.coveredExact,
        counts.preserved,
        counts.copied,
        counts.bytesCopied,
        counts.failed,
        verdict,
        note ?? null,
        id,
      );
  }

  /** Mark a dry run finished without copying (honest preview record). */
  finishPreview(
    id: number,
    counts: {
      filesSeen: number;
      coveredExact: number;
      preserved: number;
      copied: number;
      bytesCopied: number;
      failed: number;
    },
  ): void {
    this.db
      .query(
        `UPDATE shelf_sweeps SET finished_at = ?, files_seen = ?, covered_exact = ?,
         preserved = ?, copied = ?, bytes_copied = ?, failed = ?,
         verdict = CASE WHEN ? > 0 THEN 'failed' ELSE 'preview' END
         WHERE id = ?`,
      )
      .run(
        new Date().toISOString(),
        counts.filesSeen,
        counts.coveredExact,
        counts.preserved,
        counts.copied,
        counts.bytesCopied,
        counts.failed,
        counts.failed,
        id,
      );
  }

  /** Latest sweep per drive — the "is drive X archived?" answer. */
  latestPerDrive(): ShelfSweepRow[] {
    return this.db
      .query(
        `SELECT s.* FROM shelf_sweeps s
         JOIN (SELECT drive, MAX(id) AS id FROM shelf_sweeps GROUP BY drive) m
           ON s.drive = m.drive AND s.id = m.id
         ORDER BY s.drive`,
      )
      .all() as ShelfSweepRow[];
  }

  /** Full history, newest first (for `--json` and the UI later). */
  history(limit = 50): ShelfSweepRow[] {
    return this.db
      .query("SELECT * FROM shelf_sweeps ORDER BY id DESC LIMIT ?")
      .all(limit) as ShelfSweepRow[];
  }
}
