// archive_grid.ts — the INDEPENDENT beatgrid cross-check, split out of
// archive.ts under the file-length guard (the same delegate pattern as
// archive_similar/archive_overview/archive_tagcensus).
//
// Roadmap rev 5 §2/#2 → plan.md GA-04/GA-05: beat_this's beat arrays
// (megadj `beats` ledger) vs the track's rekordbox BPM. The verify
// pipeline's own grid check is self-referential (duration × BPM vs beat
// count from the SAME analysis) — this one compares a SECOND analyzer's
// grid against RB's stored BPM, so a drifted or octave-locked grid
// actually shows.
//
// Verdicts come from the ONE grid-math SSOT (`gridAudit` in
// fulltags/src/grid-audit.ts — the same functions `megadj beats` fits
// with):
// - `off`    — fitted grid tempo >2% from RB (drift-in-waiting)
// - `octave` — grid locked half/double RB's tempo
// - `drift`  — grid drifts >15 ms monotonically (the real failure the
//              v1 shape couldn't see: it compared COUNTS, not POSITIONS)
// - `ok`     — within tolerance
// `aok` is the count of clean tracks; offender lists stay per-class so
// the UI keeps its fix-first ordering (octave > off > drift).
import type { ArchiveQuery } from "./archive_types";
import {
  gridAudit,
  type GridAuditVerdict,
} from "../../src/fulltags/grid-audit";
import { isFiniteNumberArray } from "../../src/shared/leaf/guards";
import type { ArchiveGridCrossCheck } from "../shared/archive-wire";

interface Offender {
  video_id: string;
  title: string | null;
  rbBpm: number;
  ledgerBpm: number;
  driftMs: number;
  reason: string;
}

export function gridCrossCheck(
  reader: ArchiveQuery,
  limit = 200,
): ArchiveGridCrossCheck {
  // Pre-ledger archive DBs have no `beats` table — degrade to an empty
  // result (the SQLiteError would otherwise break every caller).
  const hasBeats = reader.rows<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'beats'`,
  );
  if (!hasBeats.length) {
    return {
      available: reader.available(),
      ledgered: 0,
      checked: 0,
      ok: 0,
      off: [],
      octave: [],
      drift: [],
    };
  }
  const rows = reader.rows<{
    video_id: string;
    title: string | null;
    duration_s: number | null;
    beats_json: string;
    bpm_folded: number | null;
  }>(
    `SELECT t.video_id, t.title, t.duration_s, b.beats_json, b.bpm_folded
     FROM tracks t JOIN beats b ON b.video_id = t.video_id
     WHERE t.status = 'downloaded' AND t.duration_s IS NOT NULL
     ORDER BY t.updated_at DESC LIMIT ?`,
    Math.min(Math.max(limit, 1), 500),
  );
  const off: Offender[] = [];
  const octave: Offender[] = [];
  const drift: Offender[] = [];
  const result = {
    available: reader.available(),
    ledgered: rows.length,
    checked: 0,
    ok: 0,
    off,
    octave,
    drift,
  };
  for (const r of rows) {
    if (r.bpm_folded == null) continue;
    let beats: number[] = [];
    try {
      const parsed: unknown = JSON.parse(r.beats_json);
      if (!isFiniteNumberArray(parsed)) {
        console.warn(
          `beat record ${r.video_id} has invalid beats_json — skipping`,
        );
        continue;
      }
      beats = parsed;
    } catch (error) {
      console.warn(
        `beat record ${r.video_id} has invalid beats_json — skipping`,
        error,
      );
      continue;
    }
    if (beats.length < 8 || !r.duration_s) continue;
    const rbBpm = r.bpm_folded;
    const v: GridAuditVerdict | null = gridAudit(beats, rbBpm);
    if (!v) continue;
    result.checked++;
    const row = {
      video_id: r.video_id,
      title: r.title,
      rbBpm,
      // the FITTED grid tempo (bpmDelta = rb − fitted, so fitted = rb − Δ)
      ledgerBpm: Math.round((rbBpm - v.bpmDelta) * 10) / 10,
      driftMs: v.driftMs,
      reason: v.reason,
    };
    switch (v.bucket) {
      case "TEMPO":
        octave.push(row); // half/double lock — the dangerous class
        break;
      case "DRIFT":
      case "CHAOS":
        drift.push(row);
        break;
      case "SHIFT":
        off.push(row);
        break;
      default:
        result.ok++;
    }
  }
  result.ok = result.checked - off.length - octave.length - drift.length;
  return result;
}
