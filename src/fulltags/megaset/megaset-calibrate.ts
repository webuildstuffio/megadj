// megaset-calibrate.ts — the #306 calibration spoke CLI:
// `megadj megaset-calibrate [--preset P] [--minutes N] [--limit N] [--json]`.
//
// WHY: 95a1e0c shipped "Full suite 2066 pass"; d740df8 fixed 4 semantic
// scoring defects 39 min later (F1–F4). Unit tests could not see scoring
// changes — only the BUILT SETS can. This spoke scores the LIVE archive
// over a fixed scenario grid (all presets × greedy/beam) and emits a
// DATED digest file: run it before a scoring change, run it after, diff.
//
// The digest is deliberately compact (per-scenario: chain ids, hop scores
// at 3dp, arc clock, counters) so the diff reads like a changelog:
// a moved track shows as a changed `chain=` line, a re-weighted hop as a
// changed `t=` value. The census test (megaset-calibration.test.ts) is
// the CI-speed gate over a synthetic corpus; THIS verb is the
// live-archive confirmation across that gate's blind spot.
//
// Propose-only: reads the archive DB, writes nothing but the digest
// file (or stdout with --json). Exit 0 digest written · 1 no archive ·
// 2 bad flag input.
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DB_PATH } from "../../cli-env";
import { commandLog } from "../../shared/progress";
import { loadConfig } from "../../deck/config";
import { crateDeckRoot } from "../../shared/volume";
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
import { clampMegasetPool, MEGASET_PRESET_IDS } from "../../deck/shared/types";
import { openMegasetArchive } from "./archive-open";

export interface MegasetCalibrateOptions {
  preset?: string | undefined;
  minutes?: number | undefined;
  limit?: number | undefined;
  /** Write the digest to this file (default: a dated path under the
   *  state dir). `--out -` streams the digest to stdout (no file). */
  out?: string | undefined;
  json?: boolean | undefined;
  onProgress?: ((msg: string) => void) | undefined;
}

/** Per-hop score at 3dp — the same rounding the wire uses. */
const t3 = (n: number | null): string =>
  n === null ? "-" : (Math.round(n * 1000) / 1000).toFixed(3);

/** One scenario's build → the digest lines. Mirrors the census test's
 *  fingerprint: chain ids + scores + arc clock + honest counters. */
function scenarioDigest(r: ReturnType<typeof buildMegaset>): string[] {
  const lines: string[] = [];
  lines.push(
    `  search=${r.search} minutes=${r.minutes} actual=${r.actualMinutes} complete=${r.complete} steps=${r.steps.length}`,
  );
  for (const s of r.steps) {
    lines.push(
      `  S ${s.videoId} @${s.atMin} t=${t3(s.transition)} lm=${s.landmark ? 1 : 0}`,
    );
  }
  lines.push(
    `  excluded_total=${r.excluded_total} pairs=${r.same_artist_pairs} lmMissing=${r.landmarks_missing.join(",")}`,
  );
  return lines;
}

export async function megasetCalibrate(
  opts: MegasetCalibrateOptions,
): Promise<void> {
  const log = commandLog(opts);
  const cfg = loadConfig(crateDeckRoot());
  const archive = openMegasetArchive();

  // one parse/validate path: minutes clamp 10–240, preset validated
  // (an unknown --preset is exit 2, never a silent fallback)
  const requestedPreset = opts.preset ?? null;
  const presets = requestedPreset
    ? (MEGASET_PRESET_IDS as string[]).includes(requestedPreset)
      ? [requestedPreset]
      : null
    : [...MEGASET_PRESET_IDS];
  if (presets === null) {
    await finishCommandError({
      command: "megaset-calibrate",
      json: opts.json === true,
      error: `unknown preset "${requestedPreset}" — expected one of: ${MEGASET_PRESET_IDS.join(", ")}`,
      exitCode: 2,
    });
    return;
  }
  const parsed = parseMegasetQuery({
    preset: requestedPreset,
    minutes: opts.minutes ?? null,
  });
  if ("error" in parsed) {
    await finishCommandError({
      command: "megaset-calibrate",
      json: opts.json === true,
      error: parsed.error,
      exitCode: 2,
    });
    return;
  }

  if (!archive.available()) {
    await finishCommandError({
      command: "megaset-calibrate",
      json: opts.json === true,
      error: `no archive at ${DB_PATH} — run \`megadj sync\`/\`megadj drop\` first`,
      exitCode: 1,
    });
    return;
  }

  const reader = archive;
  log("megaset-calibrate: scoring the live archive (propose-only, read-only)");
  const { candidates, total, missingFiles, metadataOnly, duplicateFiles } =
    reader.setCandidates(clampMegasetPool(opts.limit ?? null), undefined);
  log(
    `  pool: ${total} candidates (missing ${missingFiles}, metadata-only ${metadataOnly}, dupes ${duplicateFiles})`,
  );

  // the scenario grid: every requested preset × greedy AND beam (the
  // automatic pick is derivable from the pair — both lanes pinned)
  const scenarios: { name: string; lines: string[] }[] = [];
  for (const presetId of presets) {
    for (const search of ["greedy", "beam"] as const) {
      const built = buildMegaset({
        candidates,
        preset: SET_PRESETS[presetId as keyof typeof SET_PRESETS],
        minutes: parsed.minutes,
        searchOverride: search,
      });
      scenarios.push({
        name: `${presetId}/${search}`,
        lines: scenarioDigest(built),
      });
    }
  }

  // combined digest: one hash over all scenarios (the single number a
  // before/after diff compares first)
  const allText = scenarios
    .map((s) => `${s.name}\n${s.lines.join("\n")}`)
    .join("\n");
  const combined = createHash("sha256")
    .update(allText)
    .digest("hex")
    .slice(0, 16);

  const today = new Date().toISOString().slice(0, 10);
  const outPath =
    opts.out ?? join(cfg.dataDir, "megaset-calibration", `digest-${today}.txt`);
  const body = [
    `# megaset calibration digest — ${new Date().toISOString()}`,
    `# archive pool=${total} minutes=${parsed.minutes} presets=${presets.join(",")}`,
    `# combined=${combined}`,
    `# diff me: scoring changes move chain=/t= lines; re-run after any scoring commit`,
    allText,
    "",
  ].join("\n");

  if (opts.out === "-") {
    // stdout stream (no file): still ONE parseable --json object when
    // json mode is on — the digest rides the payload
    if (opts.json === true) {
      await writeJson({
        command: "megaset-calibrate" as const,
        combined,
        pool: total,
        minutes: parsed.minutes,
        scenarios: scenarios.map((s) => s.name),
        digest: body,
      });
    } else {
      process.stdout.write(body);
    }
  } else {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(outPath, ".."), { recursive: true });
    writeFileSync(outPath, body);
    log(`  digest: ${outPath} (combined=${combined})`);
    if (opts.json === true) {
      await writeJson({
        command: "megaset-calibrate" as const,
        combined,
        pool: total,
        minutes: parsed.minutes,
        scenarios: scenarios.map((s) => s.name),
        out: outPath,
      });
    } else {
      log("  next: run again after the scoring change and diff the two files");
    }
  }
  setExit(0);
}
