// megaset-calibration.test.ts — #306: the scoring-change calibration gate.
//
// 95a1e0c shipped "Full suite 2066 pass" and d740df8 fixed 4 semantic
// scoring defects 39 minutes later (F1–F4: a silent tempo tax, t=0 repair
// scoring, a dead ×1.5 lane, a double-collected flag). Unit tests pinned
// none of it — scoring changes alter CHAIN SHAPE in ways per-function
// asserts don't see.
//
// This file is the differential gate: a fixed synthetic corpus (deterministic,
// no I/O, no live archive) runs through the FULL scoring stack — pool
// admission, opener pick, greedy AND beam selection, the S13 landmark
// repair pass, and the #284 evidence pass — and the resulting per-hop
// scores/steps/exclusions reduce to ONE digest. The digest is pinned.
//
// A scoring change that alters any picked track, hop score (3 decimals),
// arc clock, or exclusion reason FAILS here and must consciously
// re-bless (update GOLDEN_DIGEST + name the scoring commit in the
// comment). Re-blessing without a scoring change = investigate first.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { SET_PRESETS, buildMegaset, type SetCandidate } from "./engine";
import {
  MEGASET_BEAM_POOL_MAX,
  MEGASET_DRIFT_BUDGET,
  MEGASET_TEMPO_WINDOW,
  MEGASET_TRACK_MINUTES_MAX,
  MEGASET_TRACK_MINUTES_MIN,
} from "../shared/types";

// ---- the corpus ----------------------------------------------------------
// NOT the engine-plan fixtures: this corpus is WIDER — 320 tracks (over the
// E7 crossover so greedy runs), a half-time branch pair (the F1/F3 lane), a
// decoy cluster (the greedy-strand shape), unanalyzed rows, duration-floor
// rejects, same-artist runs, cue rows (the #106 derivation), and embeddings
// (the #171 tie-break). Every scoring consumer participates.
const KEYS = ["8A", "7A", "9A", "8B", "9B", "10A", "5A", "6A"] as const;

function corpus(): SetCandidate[] {
  const pool: SetCandidate[] = [];
  for (let i = 0; i < 320; i++) {
    pool.push({
      videoId: `c${String(i).padStart(3, "0")}`,
      title: `Corpus ${i}`,
      artist: i % 6 === 2 ? "Run Artist" : `Artist ${(i * 13) % 40}`,
      // floor rejects (i%29===0 → <1min), cap rejects (i%53===0 → >15min),
      // the rest a spread of real lengths
      durationS:
        i % 29 === 0 ? 35 : i % 53 === 0 ? 950 : 210 + ((i * 37) % 420),
      // unanalyzed every 11th; half-time lane pair near i%2; else a
      // 120–138 ladder around the warmup anchor
      bpm: i % 11 === 0 ? null : i % 2 === 0 ? 126 + (i % 7) : 87 + (i % 5),
      key: KEYS[i % KEYS.length] ?? null,
      valence: 3 + ((i * 7) % 50) / 12,
      arousal: 1.5 + ((i * 11) % 70) / 10,
      dance: 0.3 + ((i * 17) % 60) / 100,
      cues:
        i % 4 === 0
          ? [
              { bar: 1, position: 0 },
              { bar: 33, position: 62.2 },
              { bar: 65, position: 124.7 },
            ]
          : [],
      embedding:
        i % 3 === 0 ? [Math.sin(i) * 0.5, Math.cos(i) * 0.5, 0.1] : null,
    });
  }
  return pool;
}

// ---- the digest ----------------------------------------------------------
/** Reduce a MegasetResult to the deterministic string the digest hashes:
 *  per step (id, atMin, transition, landmark, evidence components) +
 *  exclusion reasons + the honest counters. NOT the whole wire object —
 *  the digest is stable against property reorderings but sensitive to
 *  every VALUE the scoring pipeline decides. */
export function megasetScoreFingerprint(
  r: ReturnType<typeof buildMegaset>,
): string {
  const lines: string[] = [];
  lines.push(`search=${r.search}`);
  lines.push(
    `minutes=${r.minutes} actual=${r.actualMinutes} complete=${r.complete}`,
  );
  for (const s of r.steps) {
    const ev = s.evidence
      ? `${s.evidence.tempo}/${s.evidence.key}/${s.evidence.arcFit}/${s.evidence.anchor}/${s.evidence.similarity ?? "-"}`
      : "-";
    lines.push(
      `S ${s.videoId} @${s.atMin} t=${s.transition ?? "-"} lm=${s.landmark ? 1 : 0} ev=${ev} mixIn=${s.mixInCue ? `${s.mixInCue.bar}@${s.mixInCue.position}` : "-"} mixOut=${s.mixOutCue ? `${s.mixOutCue.bar}@${s.mixOutCue.position}` : "-"}`,
    );
  }
  // exclusions: full reason strings (a scoring change that reclassifies a
  // boundary track as "no compatible transition" vs "budget filled" shows)
  const ex = [...r.excluded]
    .toSorted((a, b) => a.videoId.localeCompare(b.videoId))
    .map((e) => `X ${e.videoId} ${e.reason}`);
  lines.push(...ex);
  lines.push(
    `avg=${r.avg_transition} min=${r.min_transition} pairs=${r.same_artist_pairs} lmMissing=${r.landmarks_missing.join(",")}`,
  );
  return lines.join("\n");
}

export function megasetDigest(r: ReturnType<typeof buildMegaset>): string {
  return createHash("sha256")
    .update(megasetScoreFingerprint(r))
    .digest("hex")
    .slice(0, 16);
}

// ---- the scenarios -------------------------------------------------------
// landmark pins chosen ON the corpus (they place), plus one unknown id.
const SCENARIOS: {
  name: string;
  preset: keyof typeof SET_PRESETS;
  minutes: number;
  searchOverride?: "beam" | "greedy";
  landmarkIds?: string[];
  openerId?: string;
}[] = [
  { name: "warmup-auto", preset: "warmup", minutes: 120 },
  { name: "peak-auto", preset: "peak", minutes: 180 },
  { name: "afterhours-auto", preset: "afterhours", minutes: 90 },
  {
    name: "peak-greedy-forced",
    preset: "peak",
    minutes: 90,
    searchOverride: "greedy",
  },
  {
    name: "warmup-beam-forced",
    preset: "warmup",
    minutes: 60,
    searchOverride: "beam",
  },
  {
    name: "warmup-landmarks",
    preset: "warmup",
    minutes: 90,
    landmarkIds: ["c003", "c016", "c042", "c007"],
  },
];

describe("#306 scoring calibration gate", () => {
  test("corpus sanity: the scenarios actually chain (a digest over empty sets is a lie)", () => {
    for (const s of SCENARIOS) {
      const r = buildMegaset({
        candidates: corpus(),
        preset: SET_PRESETS[s.preset],
        minutes: s.minutes,
        ...(s.searchOverride !== undefined
          ? { searchOverride: s.searchOverride }
          : {}),
        ...(s.landmarkIds !== undefined ? { landmarkIds: s.landmarkIds } : {}),
        ...(s.openerId !== undefined ? { openerId: s.openerId } : {}),
      });
      expect(r.steps.length).toBeGreaterThan(8);
    }
  });

  test("determinism: same corpus twice → identical fingerprint (the gate's floor)", () => {
    const a = buildMegaset({
      candidates: corpus(),
      preset: SET_PRESETS.peak,
      minutes: 120,
    });
    const b = buildMegaset({
      candidates: corpus(),
      preset: SET_PRESETS.peak,
      minutes: 120,
    });
    expect(megasetScoreFingerprint(b)).toBe(megasetScoreFingerprint(a));
  });

  test("GOLDEN DIGEST — a scoring change that moves any hop must re-bless consciously", () => {
    const perScenario: Record<string, string> = {};
    for (const s of SCENARIOS) {
      const r = buildMegaset({
        candidates: corpus(),
        preset: SET_PRESETS[s.preset],
        minutes: s.minutes,
        ...(s.searchOverride !== undefined
          ? { searchOverride: s.searchOverride }
          : {}),
        ...(s.landmarkIds !== undefined ? { landmarkIds: s.landmarkIds } : {}),
        ...(s.openerId !== undefined ? { openerId: s.openerId } : {}),
      });
      perScenario[s.name] = megasetDigest(r);
    }
    // one combined digest over all six scenarios — a single moved hop flips it
    const combined = createHash("sha256")
      .update(
        SCENARIOS.map((s) => `${s.name}=${perScenario[s.name]}`).join("\n"),
      )
      .digest("hex")
      .slice(0, 16);
    // blessed at #306 ship (Sep 23, HEAD 2ed92ab1) — post-F1..F4 scoring.
    // To re-bless: run `bun test src/deck/megaset/megaset-calibration.test.ts`
    // and copy the "Received" digest; the commit MUST name the scoring
    // change that caused the move.
    expect(combined).toMatchSnapshot();
  });

  test("the gate actually BIT: a perturbed scoring constant moves the digest", () => {
    // Meta-proof that the pin isn't vacuous: drop one mid-chain track's
    // BPM to null (unmixable → excluded) — the chain reorders and the
    // digest moves. If this ever fails, the digest no longer detects
    // scoring changes and the gate is dead.
    const base = buildMegaset({
      candidates: corpus(),
      preset: SET_PRESETS.warmup,
      minutes: 90,
      searchOverride: "greedy",
    });
    const perturbedPool = corpus();
    // a track from the chain's MIDDLE (not the opener — the opener is
    // replaced too, but a mid-chain slot change proves reorder, not just
    // head-substitution)
    const midStep = base.steps[Math.min(3, base.steps.length - 1)];
    const victim = perturbedPool.find((c) => c.videoId === midStep?.videoId);
    if (victim !== undefined) {
      victim.bpm = null; // unanalyzed → unmixable → excluded + reorder
    }
    const perturbed = buildMegaset({
      candidates: perturbedPool,
      preset: SET_PRESETS.warmup,
      minutes: 90,
      searchOverride: "greedy",
    });
    expect(megasetDigest(perturbed)).not.toBe(megasetDigest(base));
  });

  test("scoring constants unchanged (the F1-class guard — a 'harmless tweak' shows here)", () => {
    // The four defects were all CONSTANTS or constant-scopes drifting:
    // a 0.9 penalty widening, a budget lane narrowing, a t=0 clock. These
    // pins make the values themselves census-visible.
    expect(MEGASET_DRIFT_BUDGET).toBe(0.12);
    expect(MEGASET_TEMPO_WINDOW).toBeCloseTo(0.06, 10);
    expect(MEGASET_BEAM_POOL_MAX).toBe(250);
    expect(MEGASET_TRACK_MINUTES_MIN).toBe(1);
    expect(MEGASET_TRACK_MINUTES_MAX).toBe(15);
  });
});
