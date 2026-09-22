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
import { nonEmptyEnv } from "../shared/leaf/guards";
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
  logExclusionShape,
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
  /** #283 genre pool filter (raw value; family-matched via megasetGenreTerms). */
  genre?: string | undefined;
  /** S13 (#107): landmark must-plays (video_ids) — repeatable. */
  landmarkIds?: readonly string[] | undefined;
  json?: boolean | undefined;
  /** Log sink override (tests); default = commandLog routing. */
  onProgress?: ((msg: string) => void) | undefined;
}

export async function megaset(opts: MegasetOptions): Promise<void> {
  const log = commandLog(opts);
  const configRoot =
    nonEmptyEnv("CRATEDECK_ROOT") ?? join(import.meta.dir, "../../cratedeck");
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
      genreFiltered,
      freshness,
    } = reader.setCandidates(
      // shared clamp — an explicit --limit is bounded by the same contract
      // as the route/MCP (1–1000); absent → whole analyzed library
      clampMegasetPool(opts.limit ?? null),
      // #283 genre pool filter — same family matcher as the route/MCP
      opts.genre,
    );
    const built = buildMegaset({
      candidates,
      preset: SET_PRESETS[parsed.preset],
      minutes: parsed.minutes,
      openerId: opts.opener,
      landmarkIds: opts.landmarkIds,
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
      // #283: matched rows when a --genre filter ran (0 = unfiltered)
      genre_filtered: genreFiltered,
      // #283-followup: set-level quality stats (mean/lowest transition)
      avg_transition: built.avg_transition,
      min_transition: built.min_transition,
      // B6 (#107): same-artist adjacency count — the diversity report card
      same_artist_pairs: built.same_artist_pairs,
      // S13 (#107): landmark pins that could not be placed
      landmarks_missing: built.landmarks_missing,
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
          genreFiltered,
        },
        payload.excluded_total,
        log,
      );
      const at = logSteps(built.steps, log);
      // exclusion SHAPE (Sep 21): the full engine list grouped by reason
      // class — the wire preview caps at 40 rows, the terminal now shows
      // the real shape of all of them
      logExclusionShape(built.excluded, payload.excluded_total, total, log);
      // B6/S13 report cards: variety counter + unplaced pins, only when
      // they have something to say (quiet on healthy builds)
      if (built.same_artist_pairs > 0) {
        log(
          `  variety: ${built.same_artist_pairs} same-artist back-to-back pair${built.same_artist_pairs === 1 ? "" : "s"} in this chain`,
        );
      }
      if (built.landmarks_missing.length > 0) {
        log(`  landmarks not placed: ${built.landmarks_missing.join(", ")}`);
      }
      log(`  total ${at} min — propose-only, nothing written`);
      if (!built.complete) setExit(1);
    }
    await writeJson(payload);
  } finally {
    reader.close();
  }
}
