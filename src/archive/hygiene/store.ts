/**
 * HygieneStore — the `hygiene_findings` ledger over the megadj archive DB
 * (same DB as ShelfSweeps/shelf_fingerprints). The SSOT every surface
 * reads: CLI reports, the CrateDeck API, and the web queue. No markdown
 * state (§4.4).
 *
 * Findings are immutable evidence + mutable status. The natural key
 * (kind, keeper, first loser) makes re-runs UPSERT: identical evidence
 * keeps status (a dismissed finding stays down); CHANGED evidence resets
 * status to open — the only way a "no" comes back (§5 Phase 0 tests).
 */
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { errMessage as errorText } from "../../shared/leaf/fmt";
import type {
  Finding,
  FindingKind,
  FindingStatus,
  Severity,
  ValidationReceipt,
} from "./types";
import {
  hydrateHygieneFinding,
  hygieneWhere,
  HYGIENE_ORDER_SQL,
  type HygieneFindingRow,
} from "../../deck/shared/hygiene";

type Row = HygieneFindingRow;

/** Column order for the INSERT — one declaration feeding both the SQL
 *  placeholder count and (via insertParams) the value tuple. */
const HYGIENE_INSERT_COLUMNS = [
  "id",
  "kind",
  "severity",
  "status",
  "paths",
  "bytes",
  "md5s",
  "fps",
  "evidence",
  "proposed_action",
  "keeper_path",
  "walk_token",
  "auto_safe",
  "created_at",
  "decided_at",
  "applied_at",
  "validation",
] as const;

const NATURAL_INDEX_MARKER = "coalesce(json_extract(paths, '$[1]'), char(0))";
const NATURAL_INDEX_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_hygiene_natural
    ON hygiene_findings(
      kind,
      json_extract(paths, '$[0]'),
      coalesce(json_extract(paths, '$[1]'), char(0))
    )
    WHERE status <> 'archived'`;

/** Wall-clock takeover cap for the hygiene lease: a holder past this age
 *  (even with a live pid — a wedged process) loses the shelf-mutation
 *  interlock. Matches the tmp-purge >24h age-gate pattern. */
const LEASE_TAKEOVER_MS = 24 * 60 * 60 * 1000;

export class HygieneStore {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS hygiene_findings (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        paths TEXT NOT NULL,
        bytes TEXT NOT NULL,
        md5s TEXT,
        fps TEXT,
        evidence TEXT,
        proposed_action TEXT NOT NULL,
        keeper_path TEXT,
        walk_token TEXT NOT NULL,
        auto_safe INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        decided_at TEXT,
        applied_at TEXT,
        validation TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_hygiene_status
        ON hygiene_findings(status, kind);
      CREATE TABLE IF NOT EXISTS hygiene_operation_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        owner TEXT NOT NULL,
        pid INTEGER NOT NULL,
        started_at TEXT NOT NULL
      );
      -- natural key: a re-run UPDATES the row instead of duplicating it.
      -- Key = (kind + FIRST TWO paths): pair findings key on keeper+loser;
      -- single-path kinds (zero-byte, appledouble-junk, truncated-name)
      -- key on the file alone. The old keeper-only key collapsed every
      -- singleton of a kind onto ONE arbitrary row — a confirm on file A
      -- silently absorbed file B's evidence on the next scan (#9-class
      -- status bleed).
      ${NATURAL_INDEX_SQL};
    `);
    // Migrate the nullable second path to a NUL sentinel (not a valid file
    // path). SQLite permits duplicate NULLs in unique indexes, so the old
    // index admitted concurrent singleton findings. Keep one active row per
    // key, favoring the most final decision; archive the remaining evidence.
    const idx = db
      .query(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_hygiene_natural'",
      )
      .get() as { sql: string | null } | null;
    if (!idx?.sql?.includes(NATURAL_INDEX_MARKER)) {
      db.exec("DROP INDEX IF EXISTS idx_hygiene_natural");
      db.exec(`
        WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY kind, json_extract(paths, '$[0]'),
              coalesce(json_extract(paths, '$[1]'), char(0))
            ORDER BY CASE status
              WHEN 'applied' THEN 5 WHEN 'failed' THEN 4
              WHEN 'confirmed' THEN 3 WHEN 'dismissed' THEN 2 ELSE 1 END DESC,
              created_at, id
          ) AS rank
          FROM hygiene_findings WHERE status <> 'archived'
        )
        UPDATE hygiene_findings SET status = 'archived'
        WHERE id IN (SELECT id FROM ranked WHERE rank > 1);
      `);
      db.exec(NATURAL_INDEX_SQL);
    }
  }

  private tryHydrate(r: Row): Finding | null {
    try {
      return hydrateHygieneFinding(r);
    } catch (e) {
      console.error(
        `hygiene finding ${r.id} has corrupt JSON — skipping`,
        errorText(e),
      );
      return null;
    }
  }

  private rowFor(f: Finding): Omit<Row, "id"> & { id: string } {
    return {
      id: f.id,
      kind: f.kind,
      severity: f.severity,
      status: f.status,
      paths: JSON.stringify(f.paths),
      bytes: JSON.stringify(f.bytes),
      md5s: f.md5s.length ? JSON.stringify(f.md5s) : null,
      fps: f.fps.length ? JSON.stringify(f.fps) : null,
      evidence: JSON.stringify(f.evidence),
      proposed_action: JSON.stringify(f.proposedAction),
      keeper_path: f.keeperPath,
      walk_token: f.walkToken,
      auto_safe: f.autoSafe ? 1 : 0,
      created_at: f.createdAt,
      decided_at: f.decidedAt,
      applied_at: f.appliedAt,
      validation: f.validation ? JSON.stringify(f.validation) : null,
    };
  }

  /** The INSERT parameter tuple in column order — derived from rowFor so
   *  the 17 placeholders can never drift from the fields. */
  private static insertParams(
    r: Omit<Row, "id"> & { id: string },
  ): SQLQueryBindings[] {
    return [
      r.id,
      r.kind,
      r.severity,
      r.status,
      r.paths,
      r.bytes,
      r.md5s,
      r.fps,
      r.evidence,
      r.proposed_action,
      r.keeper_path,
      r.walk_token,
      r.auto_safe,
      r.created_at,
      r.decided_at,
      r.applied_at,
      r.validation,
    ];
  }

  /** The UPDATE parameter tuple (evidence half only; status resets to
   *  open, id/created_at stay the row's own). */
  private static updateParams(
    r: Omit<Row, "id"> & { id: string },
  ): SQLQueryBindings[] {
    return [
      r.severity,
      r.paths,
      r.bytes,
      r.md5s,
      r.fps,
      r.evidence,
      r.proposed_action,
      r.walk_token,
      r.auto_safe,
    ];
  }

  /** The evidence fingerprint of a finding — every field a re-run could
   *  change. Status/decidedAt/appliedAt are deliberately NOT part of it
   *  (that's the mutable half a decision writes). */
  private static evidenceFp(f: {
    kind: string;
    severity: string;
    paths: string;
    bytes: string;
    md5s: string | null;
    fps: string | null;
    evidence: string | null;
    proposed_action: string;
    walk_token: string;
    auto_safe: 0 | 1;
  }): string {
    return JSON.stringify([
      f.kind,
      f.severity,
      f.paths,
      f.bytes,
      f.md5s,
      f.fps,
      f.evidence,
      f.proposed_action,
      f.walk_token,
      f.auto_safe,
    ]);
  }

  /**
   * Upsert a detection batch. Returns { written, reopened }.
   * - NEW natural key → insert (status open).
   * - EXISTING key, identical evidence fingerprint → keep row untouched
   *   (status decisions survive re-runs; id stays stable).
   * - EXISTING key, changed evidence → update evidence + reset status to
   *   open (a dismissed finding re-opens ONLY when its evidence changed),
   *   count it in `reopened`.
   */
  upsert(findings: Finding[]): { written: number; reopened: number } {
    let written = 0;
    let reopened = 0;
    // Natural key = (kind, paths[0], paths[1]) — MUST stay aligned with
    // the idx_hygiene_natural columns above (single-path kinds key on
    // their one file; pair kinds on keeper + first loser).
    const selectFull = this.db.query(
      `SELECT * FROM hygiene_findings
       WHERE kind = ? AND json_extract(paths, '$[0]') IS ?
         AND coalesce(json_extract(paths, '$[1]'), char(0)) = coalesce(?, char(0))
         AND status <> 'archived'`,
    );
    const insert = this.db.query(
      `INSERT INTO hygiene_findings
       (id, kind, severity, status, paths, bytes, md5s, fps, evidence,
        proposed_action, keeper_path, walk_token, auto_safe, created_at,
        decided_at, applied_at, validation)
       VALUES (${HYGIENE_INSERT_COLUMNS.map(() => "?").join(", ")})`,
    );
    const update = this.db.query(
      `UPDATE hygiene_findings SET severity=?, status='open', paths=?, bytes=?,
        md5s=?, fps=?, evidence=?, proposed_action=?, walk_token=?, auto_safe=?
        WHERE id=?`,
    );
    for (const f of findings) {
      const r = this.rowFor(f);
      const prev = selectFull.get(
        f.kind,
        f.paths[0] ?? null,
        f.paths[1] ?? null,
      ) as Row | null;
      if (!prev) {
        insert.run(...HygieneStore.insertParams(r));
        written++;
        continue;
      }
      const newFp = HygieneStore.evidenceFp(r);
      const prevFp = HygieneStore.evidenceFp(prev);
      if (newFp === prevFp) continue; // unchanged: decision stands, id stable
      update.run(
        // keep the ORIGINAL id + created_at — consumers hold references
        ...HygieneStore.updateParams(r),
        prev.id,
      );
      written++;
      if (prev.status === "dismissed") reopened++;
    }
    return { written, reopened };
  }

  list(filter?: {
    status?: FindingStatus;
    kind?: FindingKind;
    severity?: Severity;
  }): Finding[] {
    // WHERE/ORDER fragments come from cratedeck/shared/hygiene — the
    // wire contract module owns them so this query can't drift from
    // CrateDeck's HygieneReader.list (jscpd flagged the twin).
    const { whereSql, params } = hygieneWhere(filter);
    const rows = this.db
      .query(
        `SELECT * FROM hygiene_findings
         ${whereSql}
         ${HYGIENE_ORDER_SQL}`,
      )
      .all(...params) as Row[];
    return rows.flatMap((r) => {
      const finding = this.tryHydrate(r);
      return finding ? [finding] : [];
    });
  }

  get(id: string): Finding | null {
    const r = this.db
      .query("SELECT * FROM hygiene_findings WHERE id = ?")
      .get(id) as Row | null;
    return r ? this.tryHydrate(r) : null;
  }

  /** open → confirmed | dismissed. Returns false when the id is unknown
   *  or the status machine doesn't allow the transition. */
  decide(id: string, confirm: boolean): boolean {
    const cur = this.get(id);
    if (!cur) return false;
    if (cur.status !== "open") return false;
    const status: FindingStatus = confirm ? "confirmed" : "dismissed";
    this.db
      .query(
        `UPDATE hygiene_findings SET status = ?, decided_at = ? WHERE id = ?`,
      )
      .run(status, new Date().toISOString(), id);
    return true;
  }

  /** confirmed → applied (with receipt) or → failed (kept for inspection). */
  markApplied(id: string, receipt: ValidationReceipt): boolean {
    const cur = this.get(id);
    if (!cur) return false;
    if (cur.status !== "confirmed") return false;
    const status: FindingStatus = receipt.ok ? "applied" : "failed";
    this.db
      .query(
        `UPDATE hygiene_findings SET status = ?, applied_at = ?, validation = ?
         WHERE id = ?`,
      )
      .run(status, new Date().toISOString(), JSON.stringify(receipt), id);
    return true;
  }

  /** Acquire the single shelf mutation lease. INSERT OR IGNORE makes the
   *  operation atomic across CLI processes sharing the archive DB. A
   *  crashed holder (kill -9, launchd group-kill — the "kill the process
   *  GROUP" operational reality) never reaches the release `finally`, so
   *  on conflict the row is probed: a dead holder pid or a lease older
   *  than the takeover cap is taken over loudly instead of bricking every
   *  future hygiene run with "already in flight" (#268). */
  acquireOperation(owner: string): boolean {
    this.db
      .query(
        `INSERT OR IGNORE INTO hygiene_operation_lock
         (id, owner, pid, started_at) VALUES (1, ?, ?, ?)`,
      )
      .run(owner, process.pid, new Date().toISOString());
    const row = this.db
      .query(
        "SELECT owner, pid, started_at FROM hygiene_operation_lock WHERE id = 1",
      )
      .get() as { owner: string; pid: number; started_at: string } | null;
    if (row?.owner === owner) return true;
    if (row && this.leaseAbandoned(row.pid, row.started_at)) {
      console.error(
        `hygiene: lease takeover — holder pid ${row.pid} (${row.owner}, ` +
          `started ${row.started_at}) is dead or past the ${LEASE_TAKEOVER_MS / 3_600_000}h cap`,
      );
      this.db
        .query("DELETE FROM hygiene_operation_lock WHERE id = 1 AND owner = ?")
        .run(row.owner);
      // re-arm through the same atomic insert: if another taker won the
      // race, its row stands and the read-back answers it as holder.
      return this.acquireOperation(owner);
    }
    return false;
  }

  /** POSIX pid-liveness probe (signal 0). EPERM means the pid exists but
   *  belongs to another user — treat as alive. */
  private holderAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  }

  /** Takeover eligibility: corrupt timestamps and non-pids count as
   *  abandoned (unusable evidence); a live pid is taken over only once
   *  the lease exceeds the wall-clock cap (the tmp-purge >24h age-gate
   *  pattern — a wedged holder must not hold the shelf interlock
   *  forever). */
  private leaseAbandoned(pid: number, startedAt: string): boolean {
    const started = Date.parse(startedAt);
    if (!Number.isFinite(started)) return true;
    if (!Number.isInteger(pid) || pid <= 0) return true;
    if (!this.holderAlive(pid)) return true;
    return Date.now() - started > LEASE_TAKEOVER_MS;
  }

  releaseOperation(owner: string): void {
    this.db
      .query("DELETE FROM hygiene_operation_lock WHERE id = 1 AND owner = ?")
      .run(owner);
  }

  /** applied → archived (#36): the terminal state. The row keeps its
   *  receipt; only the recoverable byte copy is gone. Returns false for
   *  rows not in `applied` (the status machine has no other exit). */
  markArchived(id: string): boolean {
    const cur = this.get(id);
    if (!cur) return false;
    if (cur.status !== "applied") return false;
    this.db
      .query("UPDATE hygiene_findings SET status = 'archived' WHERE id = ?")
      .run(id);
    return true;
  }
}
