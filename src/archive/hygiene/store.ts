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
import type { Database } from "bun:sqlite";
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
} from "../../../cratedeck/shared/hygiene";
import type { HygieneFindingRow } from "../../../cratedeck/shared/hygiene";

type Row = HygieneFindingRow;

export class HygieneStore {
  constructor(private db: Database) {
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
      -- natural key: a re-run UPDATES the row instead of duplicating it
      CREATE UNIQUE INDEX IF NOT EXISTS idx_hygiene_natural
        ON hygiene_findings(kind, keeper_path, json_extract(paths, '$[1]'));
    `);
  }

  private tryHydrate(r: Row): Finding | null {
    try {
      return hydrateHygieneFinding(r);
    } catch (e) {
      console.error(
        `hygiene finding ${r.id} has corrupt JSON — skipping`,
        e instanceof Error ? e.message : e,
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
    const selectFull = this.db.query(
      `SELECT * FROM hygiene_findings
       WHERE kind = ? AND keeper_path IS ? AND json_extract(paths, '$[1]') IS ?`,
    );
    const insert = this.db.query(
      `INSERT INTO hygiene_findings
       (id, kind, severity, status, paths, bytes, md5s, fps, evidence,
        proposed_action, keeper_path, walk_token, auto_safe, created_at,
        decided_at, applied_at, validation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        f.keeperPath,
        f.paths[1] ?? null,
      ) as Row | null;
      if (!prev) {
        insert.run(
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
        );
        written++;
        continue;
      }
      const newFp = HygieneStore.evidenceFp(r);
      const prevFp = HygieneStore.evidenceFp(prev);
      if (newFp === prevFp) continue; // unchanged: decision stands, id stable
      update.run(
        r.severity,
        r.paths,
        r.bytes,
        r.md5s,
        r.fps,
        r.evidence,
        r.proposed_action,
        r.walk_token,
        r.auto_safe,
        // keep the ORIGINAL id + created_at — consumers hold references
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
   * operation atomic across CLI processes sharing the archive DB. */
  acquireOperation(owner: string): boolean {
    this.db
      .query(
        `INSERT OR IGNORE INTO hygiene_operation_lock
         (id, owner, pid, started_at) VALUES (1, ?, ?, ?)`,
      )
      .run(owner, process.pid, new Date().toISOString());
    const row = this.db
      .query("SELECT owner FROM hygiene_operation_lock WHERE id = 1")
      .get() as { owner: string } | null;
    return row?.owner === owner;
  }

  releaseOperation(owner: string): void {
    this.db
      .query("DELETE FROM hygiene_operation_lock WHERE id = 1 AND owner = ?")
      .run(owner);
  }
}
