// megaset-report.ts — the human-readable rendering half of `megadj
// megaset` (#88 diet split). The command function kept the pool/build
// orchestration; everything that is log-line formatting (proposal header,
// freshness note, per-step lines, the three empty-pool diagnoses) moved
// here so the CLI arm stays read-through-able. Same strings the tests
// pin; nothing here makes decisions.

import {
  formatAge,
  ledgerFreshness,
} from "../../cratedeck/shared/ledger-freshness";
import {
  isShelfOffline,
  type MegasetPayload,
  type MegasetResult,
} from "../../cratedeck/shared/types";

export interface MegasetCensus {
  sourceTotal: number;
  total: number;
  missingFiles: number;
  metadataOnly: number;
  duplicateFiles: number;
  relocatedFiles: number;
  rekordboxKeyHits: number;
  rekordboxBpmHits: number;
  keyReads: number;
}

/** The one-line proposal header — pool provenance counts ride it so the
 *  numbers the web/MCP payloads carry are visible on the terminal too. */
export function logProposalHeader(
  built: MegasetResult,
  freshness: MegasetPayload["freshness"],
  census: MegasetCensus,
  excludedTotal: number,
  log: (m: string) => void,
): void {
  const {
    sourceTotal,
    total,
    missingFiles,
    metadataOnly,
    duplicateFiles,
    relocatedFiles,
    rekordboxKeyHits,
    rekordboxBpmHits,
    keyReads,
  } = census;
  log(
    `megaset: ${built.steps.length}-track ${built.preset} proposal, ${built.actualMinutes}/${built.minutes} min${built.complete ? "" : ` (${built.shortfallMinutes} min short)`} via ${built.search} search${built.avg_transition !== null ? `, transitions avg ${built.avg_transition.toFixed(3)} / min ${built.min_transition?.toFixed(3)}` : ""} (checked ${sourceTotal} DB rows; ${total} pool tracks; ${metadataOnly} metadata-only${metadataOnly > 0 ? " — shelf offline, scored from mirror tempo" : ""}; ${rekordboxKeyHits} Rekordbox keys; ${rekordboxBpmHits} Rekordbox BPMs; ${keyReads} file key reads; ${relocatedFiles} relocated; ${duplicateFiles} aliases collapsed; ${missingFiles} missing; excluded ${excludedTotal})`,
  );
  if (metadataOnly > 0) {
    log(
      `  note: ${metadataOnly} proposal tracks have no mounted file — the chain is a plan, not a playable playlist until the shelf is mounted`,
    );
  }
  log(
    `  analysis freshness — beats: ${formatAge(ledgerFreshness(freshness.beatsAt))}, mood: ${formatAge(ledgerFreshness(freshness.moodAt))} (newer imports need \`megadj beats\` + \`megadj mood\`)`,
  );
}

/** Per-step line: time, BPM, key, transition score, title, and the #106
 *  handoff windows (same evidence the web hover cards and M3U8 #EXTREM
 *  comments carry). Returns the LAST step's minute mark for the total. */
export function logSteps(
  steps: MegasetPayload["steps"],
  log: (m: string) => void,
): number {
  let at = 0;
  for (const s of steps) {
    at = s.atMin;
    // null pair = no cues ledger row, printed as dashes.
    const windows =
      s.mixInCue !== null || s.mixOutCue !== null
        ? `  ♪ in ${Math.round(s.mixInCue?.position ?? 0)}s/bar ${s.mixInCue?.bar ?? "—"} · out ${Math.round(s.mixOutCue?.position ?? 0)}s/bar ${s.mixOutCue?.bar ?? "—"}`
        : "  ♪ no cue windows";
    log(
      `  ${String(s.atMin).padStart(5)}m  ${s.bpm === null ? "  —  " : String(Math.round(s.bpm * 10) / 10).padStart(5)} bpm  ${(s.key ?? "—").padEnd(4)}  ${s.transition === null ? "open " : s.transition.toFixed(3)}  ${s.artist ?? "?"} — ${s.title ?? s.videoId}${windows}`,
    );
  }
  return at;
}

/** The three honest empty-pool diagnoses: shelf offline (nothing is
 *  lost), all rows unmeasurable (repair needed), or nothing mixable
 *  (analysis gap). */
export function emptyPoolDiagnosis(
  census: {
    sourceTotal: number;
    total: number;
    missingFiles: number;
    metadataOnly: number;
    relocatedFiles: number;
  },
  steps: readonly unknown[],
): string {
  const offline = isShelfOffline(
    { steps },
    {
      source_total: census.sourceTotal,
      pool: census.total,
      missing_files: census.missingFiles,
      metadata_only: census.metadataOnly,
      relocated_files: census.relocatedFiles,
    },
  );
  if (offline)
    return `megaset: shelf volume is offline and no row carries mirror tempo — all ${census.missingFiles} downloaded paths are unreadable. Mount the shelf drive, then build again (nothing is lost; the ledger is intact)`;
  if (
    census.total === 0 &&
    census.sourceTotal > 0 &&
    census.missingFiles + census.metadataOnly === census.sourceTotal
  )
    return `megaset: checked ${census.sourceTotal} downloaded DB rows, but none are playable or carry measured tempo — run \`megadj status\`, then repair or resync those rows`;
  return `megaset: nothing mixable in a ${census.total}-track pool — run \`megadj beats\` + \`megadj mood\` first`;
}
