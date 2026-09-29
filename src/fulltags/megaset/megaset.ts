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
import { DB_PATH } from "../../cli-env";
import { commandLog } from "../../shared/progress";
import {
  writeJson,
  finishCommandError,
  setExit,
} from "../../shared/cli-output";
import {
  buildMegaset,
  parseMegasetQuery,
  SET_PRESETS,
} from "../../deck/megaset/engine";
import {
  buildMegasetCandidates,
  type MegasetVariant,
} from "../../deck/megaset/candidates";
import {
  buildMegasetPayload,
  clampMegasetPool,
  MEGASET_GENRE_FAMILIES,
  megasetNearestGenreFamily,
  type MegasetPayload,
  type SetSearchOverride,
} from "../../deck/shared/types";
import { setQuality } from "../../deck/megaset/set-quality";
import { classifyChain } from "../../deck/megaset/transition-types";

import {
  emptyPoolDiagnosis,
  logExclusionShape,
  logProposalHeader,
  logSteps,
} from "./megaset-report";
import { openMegasetArchive } from "./archive-open";

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
  /** S14 (#288): number of seeded variants to build (1 = default). */
  candidates?: number | undefined;
  json?: boolean | undefined;
  /** Log sink override (tests); default = commandLog routing. */
  onProgress?: ((msg: string) => void) | undefined;
}

export async function megaset(opts: MegasetOptions): Promise<void> {
  const log = commandLog(opts);
  const archive = openMegasetArchive();

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
      stagesMs: censusStagesMs,
    } = reader.setCandidates(
      // shared clamp — an explicit --limit is bounded by the same contract
      // as the route/MCP (1–1000); absent → whole analyzed library
      clampMegasetPool(opts.limit ?? null),
      // #283 genre pool filter — same family matcher as the route/MCP
      opts.genre,
    );
    // #286: the engine stage is timed by the caller and merged into the
    // census's measured stage split before it hits the wire.
    // #290: unknown-genre guard. A filter that matched ZERO rows builds
    // an honest empty pool — but "gqom" vs "afro" should not both end
    // there: when the value matched nothing, suggest the nearest family
    // from the SAME shared table the matcher uses (no twin list).
    // Non-fatal: the build still reports its honest empty shape after.
    let genreSuggestion: string | undefined;
    if (
      opts.genre !== undefined &&
      opts.genre.trim() !== "" &&
      genreFiltered === 0
    ) {
      const near = megasetNearestGenreFamily(opts.genre);
      if (near !== null) {
        genreSuggestion = near.family;
        log(
          `  hint: genre "${opts.genre.trim()}" matched 0 rows — nearest known family is "${near.family}" (edit distance ${near.distance}); try --genre "${near.family}"`,
        );
      } else {
        log(
          `  hint: genre "${opts.genre.trim()}" matched 0 rows and is not near any known family — known families: ${Object.keys(MEGASET_GENRE_FAMILIES).join(", ")}`,
        );
      }
    }

    const buildInput = {
      candidates,
      preset: SET_PRESETS[parsed.preset],
      minutes: parsed.minutes,
      openerId: opts.opener,
      landmarkIds: opts.landmarkIds,
      searchOverride: opts.search,
    };
    const censusData = {
      sourceTotal,
      total,
      missingFiles,
      metadataOnly,
      duplicateFiles,
      relocatedFiles,
      rekordboxKeyHits,
      rekordboxBpmHits,
      keyReads,
      keyReadFailures,
      genreFiltered,
      freshness,
    };
    const variantPayload = (
      variant: MegasetVariant,
      stagesMs: MegasetPayload["stages_ms"],
    ): MegasetPayload => {
      const classifications = classifyChain(variant.result.steps);
      const classifiedSteps = variant.result.steps.map((s, i) => ({
        ...s,
        transitionType: classifications[i]?.type,
      }));
      return buildMegasetPayload({
        built: variant.result,
        quality: variant.quality,
        classifiedSteps,
        available: true,
        census: { ...censusData, stagesMs },
        ...(genreSuggestion !== undefined ? { genreSuggestion } : {}),
      });
    };

    // S14 (#288): N-candidates mode — run N seeded builds, log the best
    const candidateCount = opts.candidates ?? 1;
    const engineT0 = Date.now();
    if (candidateCount > 1) {
      const variants = buildMegasetCandidates(buildInput, candidateCount);
      const stagesMs = { ...censusStagesMs, engine: Date.now() - engineT0 };
      const payloads = variants.map((v) => variantPayload(v, stagesMs));
      if (variants.length === 0 || variants[0]!.result.steps.length === 0) {
        log(
          emptyPoolDiagnosis(
            { sourceTotal, total, missingFiles, metadataOnly, relocatedFiles },
            [],
          ),
        );
        setExit(1);
      } else {
        log(`  ${variants.length} variants built (best first):`);
        for (const v of variants) {
          log(
            `    ${v.label} (seed ${v.seed}): ${v.result.steps.length} tracks, ` +
              `quality ${v.quality.total}, search ${v.result.search}`,
          );
        }
        const best = variants[0]!;
        logProposalHeader(
          best.result,
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
          payloads[0]!.excluded_total,
          log,
        );
        const at = logSteps(best.result.steps, log);
        logExclusionShape(
          best.result.excluded,
          payloads[0]!.excluded_total,
          total,
          log,
        );
        if (best.result.same_artist_pairs > 0) {
          log(
            `  variety: ${best.result.same_artist_pairs} same-artist back-to-back pair${best.result.same_artist_pairs === 1 ? "" : "s"} in this chain`,
          );
        }
        if (best.result.landmarks_missing.length > 0) {
          log(
            `  landmarks not placed: ${best.result.landmarks_missing.join(", ")}`,
          );
        }
        const sm = stagesMs;
        log(
          `  stages: sql ${sm.sql}ms · files ${sm.fileCheck}ms · key fills ${sm.keyFills}ms · engine ${sm.engine}ms`,
        );
        log(`  total ${at} min — propose-only, nothing written`);
        if (!best.result.complete) setExit(1);
      }
      await writeJson(payloads);
    } else {
      const built = buildMegaset(buildInput);
      const stagesMs = { ...censusStagesMs, engine: Date.now() - engineT0 };
      const quality = setQuality(built);
      const classifications = classifyChain(built.steps);
      const classifiedSteps = built.steps.map((s, i) => ({
        ...s,
        transitionType: classifications[i]?.type,
      }));
      const payload = buildMegasetPayload({
        built,
        quality,
        classifiedSteps,
        available: true,
        census: { ...censusData, stagesMs },
        ...(genreSuggestion !== undefined ? { genreSuggestion } : {}),
      });
      if (built.steps.length === 0) {
        log(
          emptyPoolDiagnosis(
            { sourceTotal, total, missingFiles, metadataOnly, relocatedFiles },
            built.steps,
          ),
        );
        setExit(1);
      } else {
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
        logExclusionShape(built.excluded, payload.excluded_total, total, log);
        if (built.same_artist_pairs > 0) {
          log(
            `  variety: ${built.same_artist_pairs} same-artist back-to-back pair${built.same_artist_pairs === 1 ? "" : "s"} in this chain`,
          );
        }
        if (built.landmarks_missing.length > 0) {
          log(`  landmarks not placed: ${built.landmarks_missing.join(", ")}`);
        }
        const sm = payload.stages_ms;
        log(
          `  stages: sql ${sm.sql}ms · files ${sm.fileCheck}ms · key fills ${sm.keyFills}ms · engine ${sm.engine}ms`,
        );
        log(`  total ${at} min — propose-only, nothing written`);
        if (!built.complete) setExit(1);
      }
      await writeJson(payload);
    }
  } finally {
    reader.close();
  }
}
