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
import type { ArchiveState } from "../../core/state";
import { writeJson } from "../../shared/cli-output";
import {
  migrateEnergyTables,
  loadAllEnergyFeatures,
  energyModelsPresent,
  energyModelsEnsure,
  getEnergyScript,
} from "./energy-features";
import {
  WEIGHT_PRESETS,
  BLOC_NAMES,
  freezeSignals,
  scoreAll,
  bandDistribution,
} from "./energy-composite";
import {
  gateBlocDominance,
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
    const script = getEnergyScript();
    console.log(
      "energy --extract: models ready. Run the Python extractor:\n" +
        "  uv run --with essentia,onnxruntime,numpy python -c '<script>' < input.jsonl\n" +
        `  Script length: ${script.length} chars\n` +
        "  See docs/fulltags/energy-v3-plan-2026-10-01.md §8.",
    );
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

    const presetResults: {
      name: string;
      gatesPassed: number;
      gatesTotal: number;
    }[] = [];

    for (const preset of WEIGHT_PRESETS) {
      const scored = scoreAll(rows, frozen, preset);
      const dist = bandDistribution(scored);

      const gateResults: GateResult[] = [
        gateBlocDominance(scored),
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

    // Write scores back to energy_features for the best preset
    if (doScore && best !== undefined) {
      const bestPreset =
        WEIGHT_PRESETS.find((p) => p.name === best.name) ?? WEIGHT_PRESETS[1]!;
      const scored = scoreAll(rows, frozen, bestPreset);
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
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      console.log(
        `score: updated ${scored.length} tracks with preset ${best.name}`,
      );
    }
  }

  // Gates (standalone)
  if (doGates && !doFreeze && !doScore) {
    const preset = WEIGHT_PRESETS[1]!;
    const scored = scoreAll(rows, frozen, preset);
    const gateResults: GateResult[] = [
      gateBlocDominance(scored),
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
