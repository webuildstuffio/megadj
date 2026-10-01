/**
 * energy-command.ts — CLI entrypoint for `megadj energy` and `megadj energy-why`.
 *
 * Orchestrates the energy v3.1 pipeline:
 *   --phase0   Correlation matrix + PCA diagnostics
 *   --freeze   Build frozen percentile reference from energy_features
 *   --score    Score all tracks against frozen reference
 *   --gates    Run validation gates
 *   --shadow   Diff report: biggest movers vs Energy 2.0
 *   --full     All of the above in sequence
 *   --extract  Feature extraction (requires audio + essentia, run separately)
 */
import type { Database } from "bun:sqlite";
import type { ArchiveState } from "../../core/state";
import { writeJson } from "../../shared/cli-output";
import {
  migrateEnergyTables,
  loadAllEnergyFeatures,
  energyModelsPresent,
  energyModelsEnsure,
  getEnergyScript,
  parseExtractLine,
  extractResultToRow,
  upsertEnergyFeatures,
  energyFeatureCount,
} from "./energy-features";
import { lineReader } from "../utils/stdio";
import {
  WEIGHT_PRESETS,
  BLOC_NAMES,
  freezeSignals,
  scoreAll,
  bandDistribution,
  type ScoredTrack,
} from "./energy-composite";
import {
  gateBlocDominance,
  gateNotBpm,
  gateTierAgreement,
  collectGates,
  type GateResult,
} from "./energy-validate";

export interface EnergyCommandOpts {
  readonly state: ArchiveState;
  readonly phase0: boolean;
  readonly extract: boolean;
  readonly freeze: boolean;
  readonly score: boolean;
  readonly gates: boolean;
  readonly full: boolean;
  readonly shadow: boolean;
  readonly json: boolean;
}

interface ExtractTrack {
  readonly videoId: string;
  readonly path: string;
  readonly bpm: number;
  readonly dropStart: number;
  readonly dropEnd: number;
}

/** Build the extraction queue: downloaded tracks with BPM and a file path. */
function buildExtractionQueue(db: Database): ExtractTrack[] {
  interface Row {
    video_id: string;
    file_path: string;
    duration_s: number | null;
    bpm_folded: number | null;
  }
  const rows = db
    .query(
      `SELECT t.video_id, t.file_path, t.duration_s, b.bpm_folded
       FROM tracks t
       JOIN beats b ON t.video_id = b.video_id
       WHERE t.status = 'downloaded'
         AND t.file_path IS NOT NULL AND t.file_path != ''
         AND b.bpm_folded IS NOT NULL AND b.bpm_folded > 0`,
    )
    .all() as Row[];

  const existing = new Set(
    (
      db.query("SELECT video_id FROM energy_features").all() as {
        video_id: string;
      }[]
    ).map((r) => r.video_id),
  );

  const queue: ExtractTrack[] = [];
  for (const r of rows) {
    if (existing.has(r.video_id)) continue;
    const dur = r.duration_s ?? 300;
    const dropStart = dur * 0.3;
    const dropEnd = Math.min(dur * 0.6, dropStart + 60);
    if (dropEnd - dropStart < 4) continue;
    queue.push({
      videoId: r.video_id,
      path: r.file_path,
      bpm: r.bpm_folded!,
      dropStart,
      dropEnd,
    });
  }
  return queue;
}

/** Run the Python energy extractor over all queued tracks. */
async function runEnergyExtraction(db: Database): Promise<void> {
  const queue = buildExtractionQueue(db);
  if (queue.length === 0) {
    const existing = energyFeatureCount(db);
    console.log(
      `energy --extract: nothing to extract (${existing} features already stored)`,
    );
    return;
  }
  console.log(`energy --extract: ${queue.length} tracks to extract`);

  const script = getEnergyScript();
  const { writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const scriptPath = join(
    (await import("node:os")).tmpdir(),
    `megadj-energy-extract-${process.pid}.py`,
  );
  writeFileSync(scriptPath, script);
  const proc = Bun.spawn(
    ["uv", "run", "--with", "essentia,onnxruntime,numpy", "python", scriptPath],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );
  const enc = new TextEncoder();
  const lr = lineReader(proc.stdout as ReadableStream);
  const readLine = (timeoutMs: number) => lr.next(timeoutMs);

  let extracted = 0;
  let failed = 0;
  const startMs = Date.now();

  const videoIdByPath = new Map(queue.map((q) => [q.path, q.videoId]));

  try {
    for (const t of queue) {
      const msg = JSON.stringify({
        path: t.path,
        drop_start: t.dropStart,
        drop_end: t.dropEnd,
        bpm: t.bpm,
      });
      proc.stdin.write(enc.encode(`${msg}\n`));
      await proc.stdin.flush();

      const line = await readLine(300_000);
      if (line === null) {
        console.error(
          `energy --extract: timeout/EOF after ${extracted} extracted, ${failed} failed`,
        );
        break;
      }
      const parsed = parseExtractLine(line);
      if (parsed === null) continue;
      if (parsed.error !== undefined) {
        failed++;
        if (failed <= 10) {
          console.error(`  ✗ ${parsed.path.slice(-60)}: ${parsed.error}`);
        }
        continue;
      }
      if (parsed.features === undefined) continue;
      const vid = videoIdByPath.get(parsed.path);
      if (vid === undefined) continue;
      const row = extractResultToRow(vid, parsed.features);
      upsertEnergyFeatures(db, row);
      extracted++;
      if (extracted % 100 === 0) {
        const elapsedS = ((Date.now() - startMs) / 1000).toFixed(0);
        console.log(
          `  ${extracted}/${queue.length} extracted (${failed} failed, ${elapsedS}s)`,
        );
      }
    }
    proc.stdin.end();
  } finally {
    try {
      proc.kill();
    } catch {
      // Process exit can race cleanup
    }
  }

  const elapsedS = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(
    `energy --extract: done — ${extracted} extracted, ${failed} failed (${elapsedS}s)`,
  );
}

export async function runEnergy(opts: EnergyCommandOpts): Promise<void> {
  const db = opts.state.db;
  migrateEnergyTables(db);

  const doFreeze = opts.freeze || opts.full;
  const doScore = opts.score || opts.full;
  const doGates = opts.gates || opts.full;
  const doPhase0 = opts.phase0 || opts.full;
  const doShadow = opts.shadow || opts.full;

  if (opts.extract) {
    if (!energyModelsPresent()) {
      console.log("energy --extract: downloading missing ONNX heads...");
      const fetched = await energyModelsEnsure();
      console.log(
        `  fetched ${fetched.length} model(s): ${fetched.join(", ")}`,
      );
    }
    await runEnergyExtraction(db);
    return;
  }

  const rows = loadAllEnergyFeatures(db);
  const n = rows.length;

  if (n === 0) {
    console.log(
      "energy: no features extracted yet. Run `megadj energy --extract` first.",
    );
    return;
  }

  console.log(`energy: ${n} tracks with features`);

  const needsFreeze = doPhase0 || doFreeze || doScore || doGates || doShadow;
  if (!needsFreeze) {
    console.log(
      "usage: megadj energy --full | --phase0 | --extract | --freeze | --score | --gates | --shadow",
    );
    return;
  }
  const frozen = freezeSignals(rows);

  // Phase 0: diagnostics
  if (doPhase0) {
    console.log(
      `phase0: ${Object.keys(frozen.values).length} live signals, ${frozen.deadSignals.length} dead`,
    );
    if (frozen.deadSignals.length > 0) {
      console.log(`  dead signals: ${frozen.deadSignals.join(", ")}`);
    }
  }

  // Freeze + Score
  if (doFreeze || doScore) {
    console.log(`freeze: ${Object.keys(frozen.values).length} live signals`);

    const bpms = rows.map((r) => r.bpm ?? 0);
    const scoredCache = new Map<string, ScoredTrack[]>();
    const presetResults: {
      name: string;
      gatesPassed: number;
      gatesTotal: number;
    }[] = [];

    for (const preset of WEIGHT_PRESETS) {
      const scored = scoreAll(rows, frozen, preset);
      scoredCache.set(preset.name, scored);
      const dist = bandDistribution(scored);

      const gateResults: GateResult[] = [
        gateBlocDominance(scored),
        gateNotBpm(scored, bpms),
        gateTierAgreement(scored),
      ];
      const coll = collectGates(gateResults);

      presetResults.push({
        name: preset.name,
        gatesPassed: coll.passed,
        gatesTotal: coll.total,
      });

      if (!opts.json) {
        console.log(`\npreset: ${preset.name}`);
        console.log(
          `  weights: ${BLOC_NAMES.map((b) => `${b}=${preset.weights[b]}`).join(" ")}`,
        );
        console.log(
          `  bands: ${Object.entries(dist)
            .map(([k, v]) => `E${k}=${(v * 100).toFixed(1)}%`)
            .join(" ")}`,
        );
        console.log(`  gates: ${coll.passed}/${coll.total} pass`);
        for (const g of coll.results) {
          console.log(
            `    ${g.pass ? "✓" : "✗"} ${g.name}: ${g.value} (${g.threshold})${g.detail ? ` — ${g.detail}` : ""}`,
          );
        }
      }
    }

    // Pick best preset (most gates passed, ties: prefer "default")
    presetResults.sort((a, b) => {
      if (b.gatesPassed !== a.gatesPassed) return b.gatesPassed - a.gatesPassed;
      return a.name === "default" ? -1 : b.name === "default" ? 1 : 0;
    });
    const best = presetResults[0];
    if (best !== undefined) {
      console.log(
        `\nbest preset: ${best.name} (${best.gatesPassed}/${best.gatesTotal} gates)`,
      );
    }

    if (opts.json) {
      await writeJson({
        trackCount: n,
        presets: presetResults,
        bestPreset: best?.name ?? null,
      });
    }

    // Write scores + persist frozen reference for the best preset
    if (doScore && best !== undefined) {
      const scored =
        scoredCache.get(best.name) ??
        scoreAll(
          rows,
          frozen,
          WEIGHT_PRESETS.find((p) => p.name === best.name) ??
            WEIGHT_PRESETS[1]!,
        );
      const updateStmt = db.prepare(
        `UPDATE energy_features
         SET composite_rank = ?, energy_band = ?, energy_confidence = ?,
             weight_preset = ?
         WHERE video_id = ?`,
      );
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const t of scored) {
          updateStmt.run(
            t.composite,
            t.band,
            t.confidence,
            best.name,
            t.videoId,
          );
        }
        // Persist the frozen reference so future scores are stable
        const composites = scored.map((t) => t.composite);
        db.run(
          `INSERT OR REPLACE INTO energy_reference
             (id, signals_json, blocs_json, frozen_composites,
              dead_signals, track_count, weight_preset, frozen_at)
           VALUES (1, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          [
            JSON.stringify(frozen.values),
            JSON.stringify(
              Object.fromEntries(
                BLOC_NAMES.map((b) => [
                  b,
                  WEIGHT_PRESETS.find((p) => p.name === best.name)?.weights[
                    b
                  ] ?? 0.2,
                ]),
              ),
            ),
            JSON.stringify(composites),
            JSON.stringify(frozen.deadSignals),
            n,
            best.name,
          ],
        );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      console.log(
        `score: updated ${scored.length} tracks with preset ${best.name}`,
      );
      console.log(
        `freeze: persisted reference (${n} tracks, preset ${best.name})`,
      );
    }
  }

  // Gates (standalone)
  if (doGates && !doFreeze && !doScore) {
    const preset = WEIGHT_PRESETS[1]!;
    const scored = scoreAll(rows, frozen, preset);
    const bpmsStandalone = rows.map((r) => r.bpm ?? 0);
    const gateResults: GateResult[] = [
      gateBlocDominance(scored),
      gateNotBpm(scored, bpmsStandalone),
      gateTierAgreement(scored),
    ];
    const coll = collectGates(gateResults);
    console.log(`gates: ${coll.passed}/${coll.total} pass`);
    for (const g of coll.results) {
      console.log(
        `  ${g.pass ? "✓" : "✗"} ${g.name}: ${g.value} (${g.threshold})`,
      );
    }
  }

  // Shadow: biggest movers vs Energy 2.0
  if (doShadow) {
    const preset = WEIGHT_PRESETS[1]!;
    const scored = scoreAll(rows, frozen, preset);

    interface TrackRow {
      video_id: string;
      energy: number | null;
      title: string | null;
    }
    const oldRows = db
      .query(
        "SELECT video_id, energy, title FROM tracks WHERE energy IS NOT NULL",
      )
      .all() as TrackRow[];
    const oldMap = new Map(oldRows.map((r) => [r.video_id, r]));

    const movers: {
      videoId: string;
      title: string;
      oldBand: number;
      newBand: number;
      delta: number;
    }[] = [];
    for (const t of scored) {
      const old = oldMap.get(t.videoId);
      if (old?.energy !== undefined && old.energy !== null) {
        const oldBand = Math.max(1, Math.min(9, Math.round(old.energy)));
        const delta = Math.abs(t.band - oldBand);
        if (delta >= 2) {
          movers.push({
            videoId: t.videoId,
            title: old.title ?? t.videoId,
            oldBand,
            newBand: t.band,
            delta,
          });
        }
      }
    }
    movers.sort((a, b) => b.delta - a.delta);
    const top = movers.slice(0, 30);

    console.log(
      `\nshadow: ${movers.length} tracks moved ≥2 bands (showing top ${top.length})`,
    );
    for (const m of top) {
      console.log(`  ${m.title}: E${m.oldBand} → E${m.newBand} (Δ${m.delta})`);
    }
  }
}

/** Show bloc breakdown for one track. */
export async function energyWhy(
  state: ArchiveState,
  videoId: string,
): Promise<void> {
  const db = state.db;
  migrateEnergyTables(db);

  interface WhyRow {
    video_id: string;
    onsets_per_beat: number | null;
    bpm: number | null;
    hf_energy_re_lufs: number | null;
    low_energy_re_lufs: number | null;
    crest_factor: number | null;
    spectral_flux: number | null;
    lufs_drop: number | null;
    spectral_centroid: number | null;
    aggressive: number | null;
    engagement: number | null;
    approachability: number | null;
    arousal_drop: number | null;
    drop_start_s: number | null;
    drop_end_s: number | null;
    drop_contrast_db: number | null;
    composite_rank: number | null;
    energy_band: number | null;
    energy_confidence: string | null;
    weight_preset: string | null;
  }

  const row = db
    .query(
      `SELECT video_id, onsets_per_beat, bpm, hf_energy_re_lufs,
              low_energy_re_lufs, crest_factor, spectral_flux, lufs_drop,
              spectral_centroid, aggressive, engagement, approachability,
              arousal_drop, drop_start_s, drop_end_s, drop_contrast_db,
              composite_rank, energy_band, energy_confidence, weight_preset
       FROM energy_features WHERE video_id = ?`,
    )
    .get(videoId) as WhyRow | null;

  if (row === null) {
    console.log(`energy-why: no features for ${videoId}`);
    return;
  }

  const v = (n: number | null, unit = ""): string =>
    n !== null ? `${n}${unit}` : "?";

  console.log(`energy-why: ${videoId}`);
  console.log(
    `  band: E${row.energy_band ?? "?"} (composite: ${v(row.composite_rank)})`,
  );
  console.log(`  confidence: ${row.energy_confidence ?? "?"}`);
  console.log(`  preset: ${row.weight_preset ?? "?"}`);
  console.log(
    `  drop: ${v(row.drop_start_s, "s")}–${v(row.drop_end_s, "s")} (contrast: ${v(row.drop_contrast_db, " dB")})`,
  );
  console.log("  Tier A (DSP):");
  console.log(`    onsets/beat: ${v(row.onsets_per_beat)}`);
  console.log(`    BPM: ${v(row.bpm)}`);
  console.log(`    HF energy re:LUFS: ${v(row.hf_energy_re_lufs, " dB")}`);
  console.log(`    low energy re:LUFS: ${v(row.low_energy_re_lufs, " dB")}`);
  console.log(`    crest factor: ${v(row.crest_factor)}`);
  console.log(`    spectral flux: ${v(row.spectral_flux)}`);
  console.log(`    LUFS (drop): ${v(row.lufs_drop)}`);
  console.log(`    spectral centroid: ${v(row.spectral_centroid, " Hz")}`);
  console.log("  Tier B (pretrained):");
  console.log(`    aggressive: ${v(row.aggressive)}`);
  console.log(`    engagement: ${v(row.engagement)}`);
  console.log(`    approachability: ${v(row.approachability)}`);
  console.log(`    arousal (drop): ${v(row.arousal_drop)}`);
}
