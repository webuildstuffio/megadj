import {
  evalLeaveOneOut,
  evalLeaveOneOutArtistDisjoint,
  type GenreSeed,
} from "../../core/similar";
import { setExit, writeJson } from "../../shared/cli-output";
import { tier0Diagnostics } from "./genre-diagnostics";
import { probeLeaveOneOut, type ProbeRow } from "../analysis/linear-probe";
import { scoringFamily } from "./genre-refold";
import type { GenreOptions, RefoldEvalBlock } from "./genre-run-types";
import { parseEvalPopulation } from "./genre-run-population";

type CommandLog = (message: string) => void;
type EvalSummary = ReturnType<typeof evalLeaveOneOut>;
type Durations = { videoId: string; durationS: number | null }[];
type Diagnostics = ReturnType<typeof tier0Diagnostics>;
interface ArtistDisjointBlock {
  evaluated: number;
  agreement: number;
  refusal: number;
  delta: number;
}
interface ProbeBlock {
  protocol: string;
  evaluated: number;
  accuracy: number;
  deltaVsKnn: number;
}

const pct = (share: number): string => `${(share * 100).toFixed(1)}%`;
const rounded = (value: number): number => Math.round(value * 1000) / 1000;

function runRefoldReadout(
  enabled: boolean,
  seeds: GenreSeed[],
  durations: Durations,
  summary: EvalSummary,
  k: number,
  minAgreement: number,
  log: CommandLog,
): RefoldEvalBlock | undefined {
  if (!enabled) return undefined;
  const result = evalLeaveOneOut(
    seeds,
    k,
    minAgreement,
    durations,
    scoringFamily,
  );
  const refold = {
    evaluated: result.evaluated,
    abstained: summary.evaluated - result.evaluated,
    agree: result.agree,
    disagree: result.disagree,
    refused: result.refused,
    agreement: rounded(result.agreement),
    refusal: rounded(result.refusal),
    deltaVsBaseline: rounded(result.agreement - summary.agreement),
  };
  log(
    `  refold (umbrella arbitration): ${result.evaluated} scored (${refold.abstained} plain-umbrella rows abstain) · gated ${pct(result.agreement)} (Δ ${refold.deltaVsBaseline >= 0 ? "+" : ""}${pct(result.agreement - summary.agreement)} vs baseline) · refusal ${pct(result.refusal)}`,
  );
  return refold;
}

function logTarget(
  refold: RefoldEvalBlock | undefined,
  baselineAgreement: number,
  log: CommandLog,
): boolean {
  const gatedValue = refold?.agreement ?? baselineAgreement;
  const pass = gatedValue >= 0.65;
  log(
    `  target (genre-audit §5b.3): gated ≥65% post-refold — ${pass ? "PASS" : "below target (see audit for the refold plan)"} (${refold !== undefined ? `refold arm ${pct(refold.agreement)}` : `baseline ${pct(baselineAgreement)}`})`,
  );
  return pass;
}

function runDiagnosticsReadout(
  enabled: boolean,
  seeds: GenreSeed[],
  artists: Map<string, string>,
  summary: EvalSummary,
  k: number,
  log: CommandLog,
): Diagnostics | undefined {
  if (!enabled) return undefined;
  const familyPopulation = summary.rows.map((row) => {
    const seed = seeds.find((candidate) => candidate.videoId === row.videoId)!;
    return {
      videoId: row.videoId,
      genre: "",
      vec: seed.vec,
      artist: artists.get(row.videoId) ?? "unknown",
      family: row.family,
    };
  });
  const diagnostics = tier0Diagnostics(familyPopulation, summary.rows, k);
  log(
    `  diagnostics: label errors ${diagnostics.labelErrors.verdict} (top-10 artists hold ${pct(diagnostics.labelErrors.top10Share)} of disagreements) · same-artist top-5 ${pct(diagnostics.artistOverlap.meanTop5SameArtist)}${diagnostics.artistOverlap.rerunNeeded ? " — RERUN ARTIST-DISJOINT" : ""} · hubs≥10 ${diagnostics.hubness.hubs10}/${diagnostics.hubness.tracks} (max ${diagnostics.hubness.maxOccurrence}) · triangle share ${pct(diagnostics.confusion.triangleShare)} · top-2 ${pct(diagnostics.confusion.top2Accuracy)}`,
  );
  return diagnostics;
}

function runArtistDisjointReadout(
  enabled: boolean,
  seeds: GenreSeed[],
  artists: Map<string, string>,
  durations: Durations,
  summary: EvalSummary,
  k: number,
  minAgreement: number,
  log: CommandLog,
): ArtistDisjointBlock | undefined {
  if (!enabled) return undefined;
  const result = evalLeaveOneOutArtistDisjoint(
    seeds,
    artists,
    k,
    minAgreement,
    durations,
  );
  const block = {
    evaluated: result.evaluated,
    agreement: rounded(result.agreement),
    refusal: rounded(result.refusal),
    delta: rounded(result.agreement - summary.agreement),
  };
  log(
    `  artist-disjoint LOO: ${pct(result.agreement)} (Δ ${block.delta >= 0 ? "+" : ""}${pct(result.agreement - summary.agreement)} vs plain) — ${result.agreement >= summary.agreement * 0.95 ? "audio-driven, plain LOO stands" : "artist fingerprinting suspected: plain LOO is inflated"}`,
  );
  return block;
}

function runProbeReadout(
  enabled: boolean,
  rows: ProbeRow[],
  baselineAgreement: number,
  log: CommandLog,
): ProbeBlock | undefined {
  if (!enabled) return undefined;
  const result = probeLeaveOneOut(rows);
  const probe = {
    protocol: result.protocol,
    evaluated: result.evaluated,
    accuracy: rounded(result.accuracy),
    deltaVsKnn: rounded(result.accuracy - baselineAgreement),
  };
  log(
    `  linear probe ${result.protocol}: ${pct(result.accuracy)} (Δ ${probe.deltaVsKnn >= 0 ? "+" : ""}${pct(result.accuracy - baselineAgreement)} vs kNN gate)${probe.deltaVsKnn >= 0.03 ? " — probe beats the gate by ≥3 pts: promote to production readout" : ""}`,
  );
  return probe;
}

function optionalBlocks(
  diagnostics: Diagnostics | undefined,
  artistDisjoint: ArtistDisjointBlock | undefined,
  probe: ProbeBlock | undefined,
  refold: RefoldEvalBlock | undefined,
): Record<string, unknown> {
  return {
    ...(diagnostics !== undefined ? { diagnostics } : {}),
    ...(artistDisjoint !== undefined
      ? { artist_disjoint: artistDisjoint }
      : {}),
    ...(probe !== undefined ? { probe } : {}),
    ...(refold !== undefined ? { refold } : {}),
  };
}

export async function runGenreEval(
  opts: GenreOptions,
  log: CommandLog,
  k: number,
  minAgreement: number,
): Promise<void> {
  const { seeds, durations, artists, probeRows } = parseEvalPopulation(
    opts.state,
    "eval",
  );
  const guardedDurations = opts.durationGuard === false ? [] : durations;
  const summary = evalLeaveOneOut(seeds, k, minAgreement, guardedDurations);
  log(
    `genre eval: ${summary.evaluated} evaluated · gated agreement ${pct(summary.agreement)} · refusal ${pct(summary.refusal)} · ungated ${pct(summary.ungatedAgreement)} (k=${k}, minAgreement ${minAgreement}${opts.durationGuard === false ? ", no duration guard" : ", 90–480s guard"})`,
  );
  const refold = runRefoldReadout(
    opts.refold === true,
    seeds,
    guardedDurations,
    summary,
    k,
    minAgreement,
    log,
  );
  const pass = logTarget(refold, summary.agreement, log);
  const diagnostics = runDiagnosticsReadout(
    opts.diagnostics === true,
    seeds,
    artists,
    summary,
    k,
    log,
  );
  const artistDisjoint = runArtistDisjointReadout(
    opts.artistDisjoint === true,
    seeds,
    artists,
    guardedDurations,
    summary,
    k,
    minAgreement,
    log,
  );
  const probe = runProbeReadout(
    opts.probe === true,
    probeRows,
    summary.agreement,
    log,
  );
  await writeJson({
    command: "genre",
    mode: "eval",
    k,
    minAgreement,
    durationGuard: opts.durationGuard !== false,
    evaluated: summary.evaluated,
    agree: summary.agree,
    disagree: summary.disagree,
    refused: summary.refused,
    agreement: rounded(summary.agreement),
    refusal: rounded(summary.refusal),
    ungated_agreement: rounded(summary.ungatedAgreement),
    target: 0.65,
    pass,
    ...optionalBlocks(diagnostics, artistDisjoint, probe, refold),
  });
  setExit(pass ? 0 : 1);
}
