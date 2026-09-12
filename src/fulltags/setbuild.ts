// setbuild.ts — M66 set-builder CLI spoke (`megadj setbuild`).
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
import { ArchiveReader } from "../../cratedeck/src/archive";
import { DB_PATH } from "../cli-env";
import { commandLog } from "../progress";
import { writeJson } from "../shared/cli-output";
import {
  buildSet,
  parseSetbuildQuery,
  SET_PRESETS,
} from "../../cratedeck/src/setbuild";
import {
  clampSetPool,
  type SetBuildPayload,
} from "../../cratedeck/shared/types";

/** ISO timestamp → YYYY-MM-DD (null → "never"). Module scope — the
 *  staleness line formats both ledger ages with one helper. */
const dayOf = (iso: string | null): string =>
  iso === null ? "never" : iso.slice(0, 10);

export interface SetbuildOptions {
  preset?: string | undefined;
  minutes?: number | undefined;
  opener?: string | undefined;
  limit?: number | undefined;
  json?: boolean | undefined;
}

export async function setbuild(opts: SetbuildOptions): Promise<void> {
  const log = commandLog(opts);
  const archive = new ArchiveReader(DB_PATH);

  // same parse/validate path as the HTTP route + MCP tool (SSOT): unknown
  // preset is an error, minutes clamp to 10–240 — never silent fallbacks
  const parsed = parseSetbuildQuery({
    preset: opts.preset ?? null,
    minutes: opts.minutes ?? null,
  });
  if ("error" in parsed) {
    console.error(`setbuild: ${parsed.error}`);
    process.exitCode = 2;
    return;
  }

  const reader = archive;
  try {
    if (!reader.available()) {
      console.error(
        `setbuild: no archive at ${DB_PATH} — run \`megadj sync\`/\`megadj drop\` first`,
      );
      if (opts.json)
        await writeJson({ command: "setbuild", error: "no archive" });
      process.exitCode = 1;
      return;
    }

    const { total, candidates } = reader.setCandidates(
      // shared clamp — an explicit --limit is bounded by the same contract
      // as the route/MCP (1–1000); absent → whole analyzed library
      clampSetPool(opts.limit ?? null),
    );
    const built = buildSet({
      candidates,
      preset: SET_PRESETS[parsed.preset],
      minutes: parsed.minutes,
      openerId: opts.opener,
    });
    const payload: SetBuildPayload = {
      available: true,
      pool: total,
      preset: built.preset,
      minutes: built.minutes,
      steps: built.steps,
      excluded: built.excluded.slice(0, 40),
      excluded_total: built.excluded.length,
      freshness: reader.freshness(),
    };
    if (built.steps.length === 0) {
      // empty proposal = a real finding (nothing analyzed / nothing
      // mixable), not a crash — same honesty as the web Verdict row
      log(
        `setbuild: nothing mixable in a ${total}-track pool — run \`megadj beats\` + \`megadj mood\` first`,
      );
      process.exitCode = 1;
    } else {
      // staleness UX: the pool is only as fresh as its newest analysis —
      // surface the ledger ages so "why isn't my new track in here" is
      // answerable without opening a DB shell
      log(
        `setbuild: ${built.steps.length}-track ${built.preset} proposal, ${built.minutes} min (pool ${total}, excluded ${payload.excluded_total})`,
      );
      log(
        `  analysis freshness — beats: ${dayOf(payload.freshness.beatsAt)}, mood: ${dayOf(payload.freshness.moodAt)} (newer imports need \`megadj beats\` + \`megadj mood\`)`,
      );
      let at = 0;
      for (const s of built.steps) {
        at = s.atMin;
        log(
          `  ${String(s.atMin).padStart(5)}m  ${s.bpm === null ? "  —  " : String(Math.round(s.bpm * 10) / 10).padStart(5)} bpm  ${(s.key ?? "—").padEnd(4)}  ${s.transition === null ? "open " : s.transition.toFixed(3)}  ${s.artist ?? "?"} — ${s.title ?? s.videoId}`,
        );
      }
      log(`  total ${at} min — propose-only, nothing written`);
    }
    await writeJson(payload);
  } finally {
    reader.close();
  }
}
