/**
 * megaset-fixtures — the shared megaset test doubles (#573). The
 * SetCandidate / MegasetStep factories and the surface pool stub were
 * byte-identical across 7+ test files (jscpd clusters, issue #223's
 * follow-up); this is the ONE copy. Import with a local alias to keep
 * the suite bodies unchanged: `import { fakeTrack as cand } from …`.
 *
 * Assertion pins that were hand-copied between engine and scoring
 * suites (the double-exclusion census, the F2 wire-exactness recompute)
 * also live here so a future engine change updates one seam.
 */
import { expect } from "bun:test";
import { transitionScore, type SetCandidate, type SetPreset } from "../deck/megaset/scoring";
import type { MegasetResult, MegasetStep } from "../deck/shared/megaset";
import type {
  ArchiveSetCandidate,
  ArchiveSetCandidates,
} from "../deck/shared/archive-wire";
import type { ArchiveReader } from "../deck/db/reader";

/** The analyzed-track default every megaset suite builds from. Null
 *  overrides still win (spread order), like the per-file twins it
 *  replaces. */
export function fakeTrack(over: Partial<SetCandidate> = {}): SetCandidate {
  return {
    videoId: "x",
    title: "X",
    artist: null,
    durationS: 300,
    bpm: 128,
    key: "8A",
    valence: 5,
    arousal: 5,
    dance: 0.7,
    cues: [],
    embedding: null,
    genreFamily: "house",
    ...over,
  };
}

/** N tracks; the override callback receives the row index so a pool can
 *  ladder bpm/keys/arousal deterministically. */
export function fakeTrackList(
  n: number,
  over: (i: number) => Partial<SetCandidate> = () => ({}),
): SetCandidate[] {
  return Array.from({ length: n }, (_, i) => fakeTrack(over(i)));
}

/** The set-step default (sessions/set-quality/transition-types twins). */
export function fakeStep(over: Partial<MegasetStep> = {}): MegasetStep {
  return {
    videoId: "x",
    title: "Track",
    artist: "DJ",
    bpm: 128,
    key: "8A",
    arousal: 5,
    atMin: 5,
    transition: 0.8,
    evidence: null,
    landmark: false,
    mixOutCue: null,
    mixInCue: null,
    ...over,
  };
}

/** The no-double-exclusion regression pin (#105-era): every candidate
 *  lands in exactly one bucket — chain or excluded — and exclusions are
 *  never duplicated. `poolSize` is the candidate count the build saw. */
export function expectNoDoubleExclusion(
  result: Pick<MegasetResult, "steps" | "excluded">,
  poolSize: number,
): void {
  const ids = result.steps.map((s) => s.videoId);
  const seen = new Set<string>();
  for (const e of result.excluded) {
    expect(seen.has(e.videoId)).toBe(false);
    expect(ids).not.toContain(e.videoId);
    seen.add(e.videoId);
  }
  expect(ids.length + seen.size).toBe(poolSize);
}

/** F2 (d740df84) wire-exactness pin: every chain hop's wire transition
 *  equals a from-scratch transitionScore evaluation at the step's TRUE
 *  slot position (t = elapsed through the predecessor) — a repair pass
 *  (or future refactor) that scores hops at t=0 fails here. Wire rounds
 *  to 3 decimals; so does the comparison. */
export function expectTransitionsRecomputeFromScratch(
  steps: MegasetStep[],
  preset: SetPreset,
  anchorBpm: number,
  minutes: number,
): void {
  const budgetS = minutes * 60;
  for (let i = 1; i < steps.length; i++) {
    const s = steps[i]!;
    const prev = steps[i - 1]!;
    const t = Math.min(1, (prev.atMin * 60) / budgetS);
    const fresh = transitionScore(
      fakeTrack({ videoId: prev.videoId, arousal: prev.arousal, bpm: prev.bpm, key: prev.key }),
      fakeTrack({ videoId: s.videoId, arousal: s.arousal, bpm: s.bpm, key: s.key }),
      preset,
      t,
      anchorBpm,
      prev.arousal,
    );
    expect(s.transition).toBeCloseTo(fresh, 3);
  }
}

/** The pool wire-track default (surface.test.ts's inline candidate
 *  twins): ArchiveSetCandidate with the same measured shape the engine
 *  suites use, plus the pool-only fields (filePath/metadataOnly). */
export function fakePoolTrack(
  over: Partial<ArchiveSetCandidate> & { videoId: string },
): ArchiveSetCandidate {
  return {
    title: "Test Track",
    artist: "Test Artist",
    durationS: 300,
    bpm: 128,
    key: "8A",
    valence: 5,
    arousal: 6,
    dance: 0.8,
    filePath: null,
    cues: [],
    embedding: null,
    genreFamily: "house",
    metadataOnly: false,
    ...over,
  };
}

/** The ArchiveReader double behind the megaset HTTP surface tests: a
 *  fully-analyzed pool whose census matches pool.ts's shape. The reader
 *  probes `available: true` (the JSON build path requires it; the M3U8
 *  export path never calls it). Census numbers default to the pool
 *  itself — pass `over` for deliberately missing/metadata-only rows. */
export function fakePoolArchive(
  candidates: ArchiveSetCandidate[],
  over: Partial<ArchiveSetCandidates> = {},
): ArchiveReader {
  const stub = {
    available: () => true,
    setCandidates: () => ({
      available: true,
      sourceTotal: candidates.length,
      total: candidates.length,
      missingFiles: 0,
      metadataOnly: 0,
      duplicateFiles: 0,
      keyReads: 0,
      keyReadFailures: 0,
      freshness: { beatsAt: null, moodAt: null },
      candidates,
      ...over,
    }),
  };
  return stub as unknown as ArchiveReader;
}
