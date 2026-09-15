# Tier-0 diagnostics — first live run (2026-09-15)

The [research review](embedding-research-2026-09-14.md) §5 ranked the Tier-0
diagnostics first ("they decide whether the rest of this page is worth 20
points or 5"). They are now **implemented and run live** (n = 2982, the full
guarded eval population; `genre --eval --diagnostics --artist-disjoint`).

## Verdict table

| #    | Diagnostic                                                          | Result                                                                                   | Verdict                                                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0.1  | Label-error clustering (top-10 artists' share of LOO disagreements) | **8.4%** across 760 artists; worst single artist 3.3% (mostly `unknown`/`UnknownArtist`) | **RANDOM** — label noise is not concentrated; the "systematic mislabel" escape hatch is closed. Refold/active-labelling (P95/P96) buys real points; relabelling a few imprints does not.                     |
| 0.2  | Same-artist share of top-5 neighbours                               | **4.2%** mean; only 12/2982 rows majority-same-artist                                    | **NO ARTIST LEAKAGE** — effnet is not fingerprinting artists on this library. Plain LOO numbers stand as audio-driven.                                                                                       |
| 0.2b | `--artist-disjoint` LOO rerun                                       | **61.8%** vs 62.6% plain (Δ −0.8%)                                                       | Confirms 0.2: agreement survives the disjoint control. The v2 tower table needs no asterisk.                                                                                                                 |
| 0.3  | Hubness (k-occurrence, top-5 membership)                            | **408/2643 tracks appear in ≥10 lists; max 31**; p50 = 4, p90 = 12, p99 = 23             | **HEAVY TAIL CONFIRMED** — whitening + CSLS is worth testing on the retrieval side (now shipped, see below).                                                                                                 |
| 0.4  | Confusion mass in the house/techno/trance triangle                  | **17.7%** of disagreements; top-2 accuracy **79.3%**                                     | The triangle is NOT the main error mass. The real story in the matrix: `edm→house` 276 and `house→edm` 84 — the `edm` umbrella (B1, P94) is the single biggest error block, exactly as the review predicted. |

## Readouts that changed the plan

1. **The `edm` umbrella arbitration (P94) is now THE highest-value genre
   fix** — the confusion matrix's biggest single cell pair is
   `edm↔house` (360 of 896 disagreements), bigger than the entire
   triangle. Expected +6–12 LOO points stands.
2. **Label noise is random ⇒ the ≥65% gate is reachable by refold +
   readout fixes**, not by chasing "systematic" label corruption that
   does not exist (0.1 verdict).
3. **No artist leakage ⇒ all published v2 LOO numbers stay valid**
   (0.2/0.2b) — no `--artist-disjoint` asterisks needed anywhere.
4. **Linear probe (P90, `--probe`)**: 5-fold CV accuracy **51.5%, Δ
   −11.1 pts vs the kNN gate** — the probe does NOT beat kNN on this
   library (contrary to the literature prior R3). kNN stays the
   production readout; the probe's gate (kNN+3 pts) fails. Re-test only
   after the `edm` refold changes the label distribution.
5. **Whitening + CSLS (P91)**: shipped flag-gated on every retrieval
   surface (`megadj similar --space whitened`, `/api/archive/similar?space=`,
   MCP `archive_similar_tracks`). Measured top-5 family coherence on a
   200-row sample: raw 0.462 vs whitened 0.454 — family coherence is
   flat, BUT the qualitative A/B is decisive: raw scores are saturated
   (0.90+ for everything, junk "gym mix" hubs in every top-5) while
   whitened+CSLS spreads 0.70→0.05 and demotes hub junk. The A/B
   judgment (P100's 100-mix test) should decide, not the coherence
   proxy alone.

## Where the numbers live

All four diagnostics + the probe + the disjoint rerun are one command:

```sh
megadj genre --eval --diagnostics --artist-disjoint --probe --json
```

JSON keys: `diagnostics.{labelErrors,artistOverlap,hubness,confusion}`,
`artist_disjoint`, `probe` (with `protocol`: `5-fold-cv` or `loo`).

Engine: `src/fulltags/genre-diagnostics.ts` (pure),
`src/fulltags/linear-probe.ts` (pure, deterministic zero-init
softmax + full-batch GD), `evalLeaveOneOutArtistDisjoint` in
`src/archive/similar.ts`. Shared retrieval space math:
`cratedeck/shared/vector-space.ts` (all-but-the-top + CSLS, import-leaf
clean — no cross-boundary imports).
