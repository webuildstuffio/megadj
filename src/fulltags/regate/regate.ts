import type { ArchiveState } from "../../core/state";
import { goldDir, loadGoldSet, type GoldAnnotation } from "../analysis/gold";
import { runRegate, type GateObservation, type GateResult } from "../cli/gates";
import { regateEffnet, regateGenre } from "./regate-genre";

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
