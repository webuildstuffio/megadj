// megaset.ts — the set-builder CLI spoke (`megadj megaset` (the old `setbuild` alias is gone)).
//
// Closes the last CLI-vs-MCP archive read gap (docs/surface-parity.md §4
// item 4, the same way `megadj similar` closed I49's): the engine and the
// wire shapes are the SAME pure module cratedeck's route and MCP tool
// import — one parse/clamp/scoring code path, three surfaces. The archive
// DB is opened READ-ONLY (ArchiveReader) and nothing is written anywhere:
// propose-only by construction, identical to the web/MCP contract.
//
// Agent-first contract: --json (one summary object on stdout via
// writeJson), human logs suppressed in json mode, meaningful exit codes
// (1 = no archive / nothing mixable, 2 = bad flag input, 0 = proposal).
import { join } from "node:path";
import { ArchiveReader } from "../../cratedeck/src/archive";
import { loadConfig } from "../../cratedeck/src/config";
import { DB_PATH } from "../cli-env";
import { commandLog } from "../progress";
import { writeJson, finishCommandError, setExit } from "../shared/cli-output";
import {
  buildMegaset,
  parseMegasetQuery,
  SET_PRESETS,
} from "../../cratedeck/src/megaset";
import {
  clampMegasetPool,
  isShelfOffline,
  MEGASET_EXCLUDED_PREVIEW_MAX,
  type MegasetPayload,
  type SetSearchOverride,
} from "../../cratedeck/shared/types";

import {
  formatAge,
  ledgerFreshness,
} from "../../cratedeck/shared/ledger-freshness";

export interface MegasetOptions {
  preset?: string | undefined;
  minutes?: number | undefined;
  opener?: string | undefined;
  limit?: number | undefined;
  /** Force a sequencer strategy (A/B compare); undefined = automatic. */
  search?: SetSearchOverride | undefined;
  json?: boolean | undefined;
}

export async function megaset(opts: MegasetOptions): Promise<void> {
  const log = commandLog(opts);
  const configRoot =
    process.env.CRATEDECK_ROOT ?? join(import.meta.dir, "../../cratedeck");
  const cfg = loadConfig(configRoot);
  const archive = new ArchiveReader(
    DB_PATH,
    join(cfg.volumesRoot, cfg.shelfDrive, "Contents"),
  );

  // same parse/validate path as the HTTP route + MCP tool (SSOT): unknown
  // preset is an error, minutes clamp to 10–240 — never silent fallbacks
  const parsed = parseMegasetQuery({
    preset: opts.preset ?? null,
    minutes: opts.minutes ?? null,
  });
  if ("error" in parsed) {
    await finishCommandError({
      command: "megaset",
      json: opts.json === true,
      error: parsed.error,
      exitCode: 2,
    });
    return;
  }

  const reader = archive;
  try {
    if (!reader.available()) {
      await finishCommandError({
        command: "megaset",
        json: opts.json === true,
        error: `no archive at ${DB_PATH} — run \`megadj sync\`/\`megadj drop\` first`,
        exitCode: 1,
      });
      return;
    }

    const {
      sourceTotal,
      total,
      missingFiles,
      metadataOnly,
      duplicateFiles,
      relocatedFiles,
      rekordboxKeyHits,
      rekordboxBpmHits,
      candidates,
      keyReads,
      keyReadFailures,
      freshness,
    } = reader.setCandidates(
      // shared clamp — an explicit --limit is bounded by the same contract
      // as the route/MCP (1–1000); absent → whole analyzed library
      clampMegasetPool(opts.limit ?? null),
    );
    const built = buildMegaset({
      candidates,
      preset: SET_PRESETS[parsed.preset],
      minutes: parsed.minutes,
      openerId: opts.opener,
      searchOverride: opts.search,
    });
    const payload: MegasetPayload = {
      available: true,
      source_total: sourceTotal,
      pool: total,
      missing_files: missingFiles,
      duplicate_files: duplicateFiles,
      relocated_files: relocatedFiles,
      rekordbox_key_hits: rekordboxKeyHits,
      rekordbox_bpm_hits: rekordboxBpmHits,
      key_reads: keyReads,
      key_read_failures: keyReadFailures,
      preset: built.preset,
      minutes: built.minutes,
      actualMinutes: built.actualMinutes,
      shortfallMinutes: built.shortfallMinutes,
      complete: built.complete,
      steps: built.steps,
      excluded: built.excluded.slice(0, MEGASET_EXCLUDED_PREVIEW_MAX),
      excluded_groups: built.excluded_groups,
      excluded_total: built.excluded.length,
      metadata_only: metadataOnly,
      freshness,
      search: built.search,
    };
    if (built.steps.length === 0) {
      // empty proposal = a real finding (nothing analyzed / nothing
      // mixable), not a crash — same honesty as the web Verdict row.
      // The all-missing signature gets its own diagnosis: the shelf
      // volume is away (paths cannot exist), not the library.
      const offline = isShelfOffline(built, {
        source_total: sourceTotal,
        pool: total,
        missing_files: missingFiles,
        metadata_only: metadataOnly,
        relocated_files: relocatedFiles,
      });
      log(
        offline
          ? `megaset: shelf volume is offline and no row carries mirror tempo — all ${missingFiles} downloaded paths are unreadable. Mount the shelf drive, then build again (nothing is lost; the ledger is intact)`
          : total === 0 &&
              sourceTotal > 0 &&
              missingFiles + metadataOnly === sourceTotal
            ? `megaset: checked ${sourceTotal} downloaded DB rows, but none are playable or carry measured tempo — run \`megadj status\`, then repair or resync those rows`
            : `megaset: nothing mixable in a ${total}-track pool — run \`megadj beats\` + \`megadj mood\` first`,
      );
      // #160 ring 3: setExit is the one mutation point.
      setExit(1);
    } else {
      // staleness UX: the pool is only as fresh as its newest analysis —
      // surface the ledger ages so "why isn't my new track in here" is
      // answerable without opening a DB shell. B1: metadata-only rows
      // are named so a shelf-offline proposal is visibly mirror-built.
      log(
        `megaset: ${built.steps.length}-track ${built.preset} proposal, ${built.actualMinutes}/${built.minutes} min${built.complete ? "" : ` (${built.shortfallMinutes} min short)`} via ${built.search} search (checked ${sourceTotal} DB rows; ${total} pool tracks; ${metadataOnly} metadata-only${metadataOnly > 0 ? " — shelf offline, scored from mirror tempo" : ""}; ${rekordboxKeyHits} Rekordbox keys; ${rekordboxBpmHits} Rekordbox BPMs; ${keyReads} file key reads; ${relocatedFiles} relocated; ${duplicateFiles} aliases collapsed; ${missingFiles} missing; excluded ${payload.excluded_total})`,
      );
      if (metadataOnly > 0) {
        log(
          `  note: ${metadataOnly} proposal tracks have no mounted file — the chain is a plan, not a playable playlist until the shelf is mounted`,
        );
      }
      log(
        `  analysis freshness — beats: ${formatAge(ledgerFreshness(payload.freshness.beatsAt))}, mood: ${formatAge(ledgerFreshness(payload.freshness.moodAt))} (newer imports need \`megadj beats\` + \`megadj mood\`)`,
      );
      let at = 0;
      for (const s of built.steps) {
        at = s.atMin;
        log(
          `  ${String(s.atMin).padStart(5)}m  ${s.bpm === null ? "  —  " : String(Math.round(s.bpm * 10) / 10).padStart(5)} bpm  ${(s.key ?? "—").padEnd(4)}  ${s.transition === null ? "open " : s.transition.toFixed(3)}  ${s.artist ?? "?"} — ${s.title ?? s.videoId}`,
        );
      }
      log(`  total ${at} min — propose-only, nothing written`);
      if (!built.complete) setExit(1);
    }
    await writeJson(payload);
  } finally {
    reader.close();
  }
}
