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
import { ArchiveReader } from "../../cratedeck/src/archive/reader";
import { loadConfig } from "../../cratedeck/src/config";
import { DB_PATH } from "../cli-env";
import { commandLog } from "../shared/progress";
import { writeJson, finishCommandError, setExit } from "../shared/cli-output";
import {
  buildMegaset,
  parseMegasetQuery,
  SET_PRESETS,
} from "../../cratedeck/src/megaset/engine";
import {
  clampMegasetPool,
  MEGASET_EXCLUDED_PREVIEW_MAX,
  type MegasetPayload,
  type SetSearchOverride,
} from "../../cratedeck/shared/types";

import {
  emptyPoolDiagnosis,
  logProposalHeader,
  logSteps,
} from "./megaset-report";

export interface MegasetOptions {
  preset?: string | undefined;
  minutes?: number | undefined;
  opener?: string | undefined;
  limit?: number | undefined;
  /** Force a sequencer strategy (A/B compare); undefined = automatic. */
  search?: SetSearchOverride | undefined;
  json?: boolean | undefined;
  /** Log sink override (tests); default = commandLog routing. */
  onProgress?: ((msg: string) => void) | undefined;
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
      log(
        emptyPoolDiagnosis(
          {
            sourceTotal,
            total,
            missingFiles,
            metadataOnly,
            relocatedFiles,
          },
          built.steps,
        ),
      );
      // #160 ring 3: setExit is the one mutation point.
      setExit(1);
    } else {
      // staleness UX: the pool is only as fresh as its newest analysis —
      // surface the ledger ages so "why isn't my new track in here" is
      // answerable without opening a DB shell. B1: metadata-only rows
      // are named so a shelf-offline proposal is visibly mirror-built.
      logProposalHeader(
        built,
        freshness,
        {
          sourceTotal,
          total,
          missingFiles,
          metadataOnly,
          duplicateFiles,
          relocatedFiles,
          rekordboxKeyHits,
          rekordboxBpmHits,
          keyReads,
        },
        payload.excluded_total,
        log,
      );
      const at = logSteps(built.steps, log);
      log(`  total ${at} min — propose-only, nothing written`);
      if (!built.complete) setExit(1);
    }
    await writeJson(payload);
  } finally {
    reader.close();
  }
}
