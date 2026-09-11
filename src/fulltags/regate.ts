import type { ArchiveState } from "../archive/state";
import {
  goldDir,
  loadGoldSet,
  type GoldAnnotation,
} from "../../fulltags/src/gold";
import {
  runRegate,
  type GateResult,
  type GateObservation,
} from "../../fulltags/src/gates";

export interface RegateResult {
  command: "regate";
  detector: string;
  matched: number;
  unmatched: number;
  gate: GateResult;
  ok: boolean;
  error?: string;
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

export function regate(
  state: ArchiveState,
  dimension: string,
  detector = "ledger",
  dir?: string,
): RegateResult {
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
  if (dimension !== "bpm") {
    const gate = runRegate({ dimension, observations: [] });
    return {
      command: "regate",
      detector,
      matched: 0,
      unmatched: 0,
      gate,
      ok: false,
      error: `${dimension} reference ledger is not populated; use the reusable runRegate harness with fixture/reference observations`,
    };
  }
  return regateBpm(
    state,
    dir ?? goldDir(process.env.MEGADJ_MUSIC_DIR ?? ""),
    detector,
  );
}
