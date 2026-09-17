// verify_parse.ts — the usb_verify.py output parser (#89 diet
// extraction from verify_report.ts): VERIFY_JSON structured payload
// first, human-output regex fallback second; every check gets a status,
// plain-English meaning, and a fix when failing.
// Metric extraction lives in verify-parse-metrics.ts (#88 item 1) —
// this file is check ASSEMBLY only.
import { VERIFY_HELP } from "./verify_help";
import type { VerifyCheck, VerifyReport } from "../shared/types";
import { lastLines } from "./verify_report";
import { extractVerifyMetrics } from "./verify-parse-metrics";

/** Longest offender list kept per check (full list stays in the log). */
const MAX_OFFENDERS = 50;

/** Cap an offender list for a check: at most MAX_OFFENDERS entries plus
 *  the true count (the UI shows "and N more"). Lives here — its only
 *  consumers are the check builders below (#212). */
export function cap(list: string[] | undefined): {
  offenders?: string[];
  offender_count?: number;
} {
  if (!list?.length) return {};
  return {
    offenders: list.slice(0, MAX_OFFENDERS),
    offender_count: list.length,
  };
}

/** Check doc lookup from the shared help SSOT: meaning + fix stay in one place. */
const DOC = new Map(VERIFY_HELP.checks.map((c) => [c.id, c]));

/** Parse usb_verify.py output into a full structured verify report.
 *
 *  Preferred input: the script's machine-readable "VERIFY_JSON: {...}" line
 *  (has exact counts + offending track paths). Falls back to regexing the
 *  human output for older script versions. Every check gets a status
 *  (pass/fail/warn), plain-English meaning, and a fix when failing. Passes
 *  are included — silence about 3500 good tracks is exactly the confusion
 *  we're fixing. */
export function parseVerifyReport(
  out: string,
  ok: boolean,
  finalLine: string | null,
  durationS: number | null,
  /** Drive role (when known) — shelf-tier drives archive rather than gig,
   *  so player-facing pdb parity is informational, never a failure. */
  driveRole?: string,
): VerifyReport {
  const m = extractVerifyMetrics(out);
  const checks: VerifyCheck[] = [];

  const mk = (
    id: string,
    status: VerifyCheck["status"],
    detail: string,
    off?: { offenders?: string[]; offender_count?: number },
  ): VerifyCheck => {
    const doc = DOC.get(id);
    return {
      id,
      label: doc?.label ?? id,
      status,
      detail,
      meaning: doc?.why ?? "See deckctl explain verify.",
      fix: status === "pass" ? undefined : doc?.fix,
      ...off,
    };
  };

  // 1 — dual-DB agreement. Shelf-tier drives are ARCHIVE storage: the
  // master library lives there (rekordbox Database Management) and the
  // legacy pdb is a vestigial copy of a migrated stick tree. Parity is a
  // gig-stick concern — on a shelf it's informational, never a fail.
  if (m.pdb !== null && m.odb !== null) {
    const shelfTier = driveRole === "shelf";
    checks.push(
      mk(
        "dual-db",
        m.pdb === m.odb || shelfTier ? "pass" : "fail",
        m.pdb === m.odb
          ? `${m.odb} tracks in both databases`
          : shelfTier
            ? `archive tier — master library lives here (${m.odb} tracks); legacy pdb (${m.pdb}) is vestigial and not read by players`
            : `export.pdb ${m.pdb} vs OneLibrary ${m.odb} (${
                m.odb > m.pdb
                  ? `${m.odb - m.pdb} newer tracks invisible to hardware`
                  : `${m.pdb - m.odb} stale rows hardware will show but rekordbox won't`
              })`,
      ),
    );
  }

  // 2 — audio files present
  if (m.tracks !== null) {
    checks.push(
      mk(
        "audio-files",
        m.missingAudio === 0 ? "pass" : "fail",
        m.missingAudio === 0
          ? `all ${m.tracks} DB tracks have their file on disk`
          : `${m.missingAudio} of ${m.tracks} DB tracks have NO file on disk`,
        cap(m.missingFiles),
      ),
    );
  }

  // 3 — analysis files (waveforms + beatgrids)
  const anlzTotal = m.missingAnlz + m.anlzHash;
  if (m.tracks !== null) {
    checks.push(
      mk(
        "anlz",
        anlzTotal === 0 ? "pass" : anlzTotal < 20 ? "warn" : "fail",
        anlzTotal === 0
          ? `all ${m.tracks} tracks have analysis at both the DB and hardware hash path`
          : `${anlzTotal} track(s) missing analysis (${m.missingAnlz} at DB path, ${m.anlzHash} at hardware hash path)`,
        cap([...m.missingAnlzList, ...m.anlzHashList]),
      ),
    );
  }

  // 4 — field sanity (BPM / duration). Conditioned on tracks: previously
  // unconditional, which turned a CRASHED verify into a green "all ? tracks
  // have plausible BPM and length" line — the "?" was the tell that no
  // measurement happened. A crash is not a measurement.
  if (m.tracks !== null) {
    checks.push(
      mk(
        "fields",
        m.noBpm + m.badLen === 0 ? "pass" : "warn",
        m.noBpm + m.badLen === 0
          ? `all ${m.tracks} tracks have plausible BPM and length`
          : `${m.noBpm} without BPM, ${m.badLen} with implausible length`,
        cap([...m.noBpmList, ...m.badLenList]),
      ),
    );
  }

  // 5 — grid plausibility
  if (m.tracks !== null) {
    checks.push(
      mk(
        "grids",
        m.badGrids === 0 ? "pass" : "warn",
        m.badGrids === 0
          ? `all generated grids pass the ANLZ-vs-DB consistency check`
          : `${m.badGrids} generated track(s) failed the ANLZ-vs-DB consistency check`,
        cap(m.badGridList),
      ),
    );
  }
  if (m.pioneerVar !== null && m.pioneerVar > 0) {
    checks.push(
      mk(
        "pioneer-variance",
        "pass",
        `${m.pioneerVar} Pioneer-shipped tracks have loose grids — informational, not an error`,
      ),
    );
  }

  // 6 — playlists + relations
  if (m.playlists !== null) {
    const dang = m.dangling ?? 0;
    const fk = m.artistFk ?? 0;
    checks.push(
      mk(
        "relations",
        dang + fk === 0 ? "pass" : "fail",
        dang + fk === 0
          ? `${m.playlists} playlists, ${m.entries ?? "?"} entries, no dangling rows`
          : `${m.playlists} playlists · ${dang} dangling entries · ${fk} broken artist links`,
      ),
    );
  }

  // 7..9 — cross-drive parity (only present in 2-drive runs)
  if (m.crossDrive) {
    checks.push(
      mk(
        "db-parity",
        m.dbIdentical ? "pass" : "fail",
        m.dbIdentical
          ? "exportLibrary.db byte-identical on both drives"
          : "exportLibrary.db differs between drives",
      ),
    );
    if (m.anlzParity) {
      checks.push(
        mk(
          "anlz-parity",
          m.anlzParity[0] === 0 ? "pass" : "fail",
          `${m.anlzParity[0]} of ${m.anlzParity[1]} analysis files differ between drives`,
          cap(m.anlzMismatchList),
        ),
      );
    }
    if (m.j || m.audioMismatch !== null) {
      checks.push(
        mk(
          "audio-parity",
          m.audioMismatch === 0 ? "pass" : "fail",
          m.audioMismatch === 0
            ? "40 random tracks hash-identical across drives"
            : `${m.audioMismatch}/40 sampled tracks DIFFER between drives (different rips)`,
          cap(m.audioMismatchList),
        ),
      );
    }
  }

  // Crash guard — LAST, after real checks: usb_verify.py that died mid-run
  // (OOM, DB lock, uv/env failure — a SQLAlchemy traceback in the output)
  // produces no counts and none of the checks above. The old shape returned
  // ok:false with ZERO failing checks, which the UI rendered as
  // "0 of 0 checks need attention" — a crash reading as verified.
  // Corrupt verdicts never read as success.
  if (finalLine === null) {
    const tail = out
      .split("\n")
      .filter((l) => l.trim())
      .slice(-3)
      .join(" · ")
      .slice(0, 300);
    checks.push(
      mk(
        "script-failed",
        "fail",
        tail
          ? `verify script crashed before producing a verdict — last output: ${tail}`
          : "verify script crashed before producing any output",
      ),
    );
  }

  return {
    ran_at: Date.now(),
    ok,
    final: finalLine,
    duration_s: durationS,
    checks,
    stats: m.stats,
    summary: lastLines(out, 25),
  };
}
