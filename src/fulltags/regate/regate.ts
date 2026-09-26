import type { ArchiveState } from "../../core/state";
import { round3 } from "../../shared/leaf/fmt";
import { goldDir, loadGoldSet, type GoldAnnotation } from "../analysis/gold";
import {
  evalLeaveOneOut,
  genreFamily,
  parseEmbeddingVector,
} from "../../core/similar";
import { runRegate, type GateObservation, type GateResult } from "../cli/gates";

// ---- the genre/effnet re-gates (#169, folded from regate-genre.ts —
// one command, one module; the LOO harness is evalLeaveOneOut in
// core/similar — no second eval implementation) ----

/** The genre ship gate (genre-pipeline.md §V2, tier-0 arbitration bar). */
export const GENRE_GATE_PERCENT = 65;

/** The per-dimension result: measured agreement + gate verdict from the
 * EXISTING eval engine, or an honest unavailability. */
export interface GenreRegateResult {
  command: "regate";
  dimension: "genre" | "effnet";
  detector: "ledger";
  /** true = reference population absent → measured/gate are null */
  unavailable: boolean;
  /** why the ledger is unavailable (only when unavailable) */
  reason?: string;
  measured: number | null;
  gate: GateResult | null;
  evaluated: number;
  ok: boolean;
}

/** Build the eval population from the archive state: every embedded
 * downloaded track with a label (the same rows `genre --eval` feeds the
 * harness). Returns null when the population is empty — an honest gap,
 * not a zero-scored pass. */
export function genreEvalSeeds(state: ArchiveState): {
  seeds: { videoId: string; genre: string; vec: number[] }[];
  durations: { videoId: string; durationS: number | null }[];
} {
  const pop = state.evalPopulation();
  const seeds: { videoId: string; genre: string; vec: number[] }[] = [];
  const durations: { videoId: string; durationS: number | null }[] = [];
  for (const row of pop) {
    seeds.push({
      videoId: row.video_id,
      genre: row.genre,
      vec: parseEmbeddingVector(row.vec_json, `regate ${row.video_id}`),
    });
    durations.push({ videoId: row.video_id, durationS: row.duration_s });
  }
  return { seeds, durations };
}

/** `regate genre` — LOO agreement vs the ≥65% gate, through the shared
 * harness. Corrupt vector rows throw with their context (parseEmbedding
 * Vector's contract): a poisoned ledger must surface, not silently shrink
 * the population. */
export function regateGenre(state: ArchiveState): GenreRegateResult {
  const { seeds, durations } = genreEvalSeeds(state);
  const familyEvaluable = seeds.filter(
    (s) => genreFamily(s.genre) !== null,
  ).length;
  if (familyEvaluable === 0) {
    return {
      command: "regate",
      dimension: "genre",
      detector: "ledger",
      unavailable: true,
      reason:
        "no genre-labeled embeddings in the ledger — run `megadj mood --embeddings` and fetch genres first",
      measured: null,
      gate: null,
      evaluated: 0,
      ok: true, // honest gap: exit 0, the JSON states the census
    };
  }
  const summary = evalLeaveOneOut(seeds, 5, 0.6, durations);
  const measured = round3(summary.agreement);
  // gate verdict shape mirrors runRegate's GateResult (passPercent vs
  // requiredPercent) so consumers never branch on dimension
  const gate: GateResult = {
    dimension: "genre",
    tolerancePercent: 0,
    passPercent: measured * 100,
    requiredPercent: GENRE_GATE_PERCENT,
    passed: familyEvaluable > 0 && measured * 100 >= GENRE_GATE_PERCENT,
    tracks: [],
  };
  return {
    command: "regate",
    dimension: "genre",
    detector: "ledger",
    unavailable: false,
    measured,
    gate,
    evaluated: summary.evaluated,
    ok: gate.passed,
  };
}

/** `regate effnet` — the reference ledger (audio-true genre labels scored
 * over the effnet tower's own 1280-d vectors, distinct from the whitened
 * genre kNN space) does not exist yet. Honest unavailability: exit 0,
 * `unavailable: true`, the reason on the wire. NEVER a manufactured pass
 * (docs/fulltags/fulltags-roadmap.md §4 gap 2's own rule). */
export function regateEffnet(): GenreRegateResult {
  return {
    command: "regate",
    dimension: "effnet",
    detector: "ledger",
    unavailable: true,
    reason:
      "the effnet reference ledger (audio-true genre labels on the effnet tower's vectors) is not populated — `regate genre` measures the whitened kNN space today",
    measured: null,
    gate: null,
    evaluated: 0,
    ok: true,
  };
}

export interface RegateResult {
  command: "regate";
  detector: string;
  matched: number;
  unmatched: number;
  gate: GateResult;
  ok: boolean;
  error?: string;
}

/** The genre/effnet result reuses the same envelope as the BPM one so
 * consumers never branch: `gate` stays present (null inside would break
 * `report.gate.passPercent`), so an unavailable ledger carries a ZERO
 * GateResult with the reason on `error` — measured-nothing, not
 * measured-zero. `unavailable` distinguishes the two on the wire. */
export interface RegateReport {
  command: "regate";
  detector: string;
  matched: number;
  unmatched: number;
  gate: GateResult;
  ok: boolean;
  error?: string | undefined;
  /** true = the reference ledger is absent → nothing was measured */
  unavailable?: boolean | undefined;
  /** measured agreement share (genre) — null when unavailable */
  measured?: number | null | undefined;
  /** LOO population size (genre) */
  evaluated?: number | undefined;
  /** the concrete dimension when genre/effnet (bpm keeps detector) */
  dimension?: "genre" | "effnet" | undefined;
}

type BeatRow = ReturnType<ArchiveState["beatAnalyzedTracks"]>[number];

/** Build the BPM observations from the existing hash-keyed gold/beat ledgers. */
export function bpmObservations(
  annotations: readonly GoldAnnotation[],
  analyzed: readonly BeatRow[],
): GateObservation<number>[] {
  const byHash = new Map(
    analyzed
      .filter((row) => row.track.content_hash !== null)
      .map((row) => [row.track.content_hash as string, row]),
  );
  return annotations.flatMap((annotation) => {
    const row = byHash.get(annotation.hash);
    const actual = row?.bpmFitted ?? row?.bpmRaw ?? null;
    return actual === null
      ? []
      : [{ id: annotation.hash, expected: annotation.bpm, actual }];
  });
}

export function regateBpm(
  state: ArchiveState,
  dir: string,
  detector = "ledger",
): RegateResult {
  const set = loadGoldSet(dir);
  const observations = bpmObservations(
    set.annotations,
    state.beatAnalyzedTracks(),
  );
  const gate = runRegate({
    dimension: "bpm",
    observations,
    tolerancePercent: 2,
    passPercent: 80,
  });
  return {
    command: "regate",
    detector,
    matched: observations.length,
    unmatched: set.annotations.length - observations.length,
    gate,
    ok: gate.passed && set.issues.length === 0,
    ...(set.issues.length > 0
      ? {
          error: `invalid gold annotations: ${set.issues.map((i) => i.file).join(", ")}`,
        }
      : {}),
  };
}

const zeroGate = (dimension: "genre" | "effnet"): GateResult => ({
  dimension,
  tolerancePercent: 0,
  passPercent: 0,
  requiredPercent: 0,
  passed: false,
  tracks: [],
});

export function regate(
  state: ArchiveState,
  dimension: string,
  detector = "ledger",
  dir?: string,
): RegateReport {
  if (dimension !== "bpm" && dimension !== "genre" && dimension !== "effnet") {
    const gate = runRegate({
      dimension: "bpm",
      observations: [],
    });
    return {
      command: "regate",
      detector,
      matched: 0,
      unmatched: 0,
      gate,
      ok: false,
      error: `unknown re-gate dimension ${dimension}; expected bpm, genre, or effnet`,
    };
  }
  if (detector !== "ledger") {
    const gate = runRegate({ dimension, observations: [] });
    return {
      command: "regate",
      detector,
      matched: 0,
      unmatched: 0,
      gate,
      ok: false,
      error: `unknown detector ${detector}; available detector: ledger`,
    };
  }
  if (dimension === "genre") {
    const r = regateGenre(state);
    return {
      command: "regate",
      detector,
      matched: r.evaluated,
      unmatched: 0,
      gate: r.gate ?? zeroGate("genre"),
      ok: r.ok,
      unavailable: r.unavailable,
      ...(r.reason !== undefined ? { error: r.reason } : {}),
      measured: r.measured,
      evaluated: r.evaluated,
      dimension: "genre",
    };
  }
  if (dimension === "effnet") {
    const r = regateEffnet();
    return {
      command: "regate",
      detector,
      matched: 0,
      unmatched: 0,
      gate: zeroGate("effnet"),
      ok: r.ok,
      unavailable: true,
      error: r.reason,
      measured: null,
      evaluated: 0,
      dimension: "effnet",
    };
  }
  return regateBpm(
    state,
    dir ?? goldDir(process.env.MEGADJ_MUSIC_DIR ?? ""),
    detector,
  );
}
