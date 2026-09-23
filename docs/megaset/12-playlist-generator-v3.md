# MegaSet v3 — Playlist Generator Re-architecture (ultra-deep proposal)

**Status:** 🧭 ACTIVE — approved 2026-09-22 (owner decision on #298); numbered moves become owning issues and land through normal gates. Deep re-architecture of the set generator, written
2026-09-20 at main `0d2575f9`. Every claim is linked to the existing doc set
([01-prd](01-prd.md), [02-architecture](02-architecture.md),
[03-competitive-analysis](03-competitive-analysis.md),
[08-audit-and-plan](08-audit-and-plan.md),
[10-findings](10-findings.md), [11-master-architecture-v2](11-master-architecture-v2.md))
or measured live against the code at HEAD. Approved 2026-09-22 (#298); the
per-move owning issues were filed 2026-09-22 (M1→#325, M2→#326, M3→#327,
M4→#328, M5→#329, M6→#330 — see §8's issue column). "Nothing is built" refers
to the v3 architecture itself; the absorbed pre-reqs (B6, B8, landmarks) DID
ship Sep 21 and are marked as such in §0.

**What this doc is:** NOT a rewrite of the engine — the engine's core verdicts
are measured law (E6 frozen weights, E7 beam, the 7 cross-shop invariants).
It IS a re-architecture of everything *around* the engine: what the generator
consumes, what it plans, what it explains, and what it refuses. v2
([11](11-master-architecture-v2.md)) added evidence-backed layers; v3
reorganizes the generator into a **two-stage plan-and-fill architecture** with
a typed transition grammar, a strict quality contract, and a session
(resumable, editable, attributable) — the three things the 30-comparator
analysis says the market pays for and MegaSet still lacks.

---

## 0. Where MegaSet actually is today (measured, HEAD `0d2575f9`)

| Thing | State | Source of truth |
| --- | --- | --- |
| Engine | Pure, deterministic, 6 ms @ 3.6k; greedy + beam-B8 auto-pick (`searchOverride` A/B hook) | `src/deck/megaset/engine.ts` + `megaset/scoring.ts` + `megaset/search.ts` (1,090 LOC total with CLI/report) |
| Weights | Frozen `0.45/0.30/0.25` + anchor 0.15 + similarity 0.1 (E6 law) | `MEGASET_TRANSITION_WEIGHTS`, `shared/megaset.ts` |
| Tempo anchor + drift budget | **Shipped** (B2): ±12% anchor budget, half/double-time branch lane at ±6% (B8 partially in: the *branch lane* exists in `withinAnchorBudget`, but `bpmScore` itself still scores 0 for a raw 87↔174 pair outside the branch window) | `megaset/scoring.ts` |
| Phrase handoffs (Phase D item 16) | **Shipped** (#106): `mixInCue`/`mixOutCue` per step, `#EXTREM` in M3U8, dry-run rows, hover cards | `megasetMixInCue`/`megasetMixOutCue` |
| Embedding prior (B10p) | **Shipped** (#171): capped 0.1 tie-break, gates-first precedence, honest-gap both ways | `similarityScore` |
| Offline mirror pool (B1), preview cap (B11), grouped exclusions (B13), minutes validation (B7) | **Shipped** (#104/#105) | 08 header receipts |
| B6 diversity, landmarks `--track`, 0–100 quality score, N-candidates | **B6 + landmarks SHIPPED Sep 21** (`46adc385`): artist-repeat penalty + `same_artist_pairs` counter; `--landmark` repair pass + `landmarks_missing` — see the [Sep 21 audit](2026-09-21-audit-and-next.md). **N-candidates + quality score NOT built** — open [#107](https://github.com/webuildstuffio/megadj/issues/107) item 4, actionable slice [#288](https://github.com/webuildstuffio/megadj/issues/288); consolidations (#59 → #107, #172 → #107) are tracking folds, not ships | `megaset/scoring.ts` (B6), `megaset/engine.ts` (S13), [#288](https://github.com/webuildstuffio/megadj/issues/288) |
| B8 half/double-time scoring | **Half-shipped Sep 21**: pair lane 0.75 × 0.9 exists for ×2/×½/×1.5/×⅔ (`MEGASET_HALFTIME_PENALTY`), but `bpmScore` still scores 0 for a raw 87↔174 pair OUTSIDE the lane, and the family gate (#107 box 2) is NOT wired — tracked in [#326](https://github.com/webuildstuffio/megadj/issues/326) (v3 move M2) | `megaset/scoring.ts` `bpmScore` + `withinAnchorBudget` |
| Failure taxonomy (v2 §4e), coverage counters (v2 §4f), ledger `model` column (v2 action #1), pre-registered B10p A/B (v2 §4b) | **NOT built** — v2 is still 📐 proposal | [11 §4](11-master-architecture-v2.md) |
| Tests | 131 megaset tests across 7 files (engine + contract + pool + scoring + surface + sweep + shared) — grew from 87 with the Sep 21 B6/B8/landmark/evidence passes | `src/deck/megaset/*.test.ts` + `src/deck/test/megaset-contract.test.ts` |

The honest read (updated 2026-09-22): **v1's Phase A, Phase D item 16, B10p,
B6, B8 (pair lane), and S13 landmarks have all landed; the remaining gaps are
N-candidates + quality score (#288), the B8 completion inside `bpmScore` +
family gate (#311), and v2's ops hardening.** A v3 re-architecture must
*absorb* those, not re-propose them.

## 1. The diagnosis — why re-architect at all

Three structural limits that no single feature fixes:

1. **The generator is order-only.** It outputs an ordered list with per-step
   cue windows, but has no model of the *transition itself* — type (long
   blend vs cut-on-the-4th vs double-drop), energy cost, vocal risk, EQ
   shape. PulseGrid/cuefield prove this is buildable; DJ.Studio sells it.
   Our cues ledger is the deepest phrase dataset in the comparison set and
   the generator uses ~2% of it (nearest-cue-to-a-target).
2. **The generator is single-shot and stateless.** Every request rebuilds
   from the full census. There is no session: you cannot say "keep that,
   swap this, regenerate the middle" (open-crate's lock-and-regenerate —
   the most-praised workflow feature in the comparator reviews), and a
   proposal cannot be attributed, diffed, or improved across nights.
   `rb-playlist` writes a playlist, not a session.
3. **Quality is unmeasured by the generator.** The payload has honest
   counters but no 0–100 verdict, so "was this set actually good?" and
   "which of three candidates is better?" have no answer. SetFlow grades
   every transition; HarmonySet scores the set. This blocks the entire
   candidates/compare lane (#107 item 4).

Everything else in this doc hangs off fixing those three.

## 2. The v3 shape — two-stage plan-and-fill

Today: `candidates → score each transition → chain`. v3 inserts an explicit
**plan** stage between pool and fill, and a **session** store after it:

```
 ledgers (unchanged; + v2's model column, coverage counters)
      │
      ▼
 setCandidates() ────────── unchanged pool census (B1 mirror mode intact)
      │
      ▼
 ┌─ NEW: buildPlan() ─────────────────────────────────────────────┐
 │  arc → slots: {role, window, bpmTarget, keyRegion, energyRange,│
 │                transitionType}                                  │
 │  from: preset envelope + landmarks (#107.3) + opener trifecta   │
 │  output: Plan (pure, deterministic, serializable, diffable)     │
 └─────────────────────────────────────────────────────────────────┘
      │
      ▼
 fillPlan(plan, candidates) ─── the existing engine, per-slot:
      │            hard gates → weights → similarity tie-break (unchanged math)
      │            NEW: transitionGrammar gates slot.transitionType legality
      │            NEW: per-slot quality contribution → SetQuality 0–100 (#107.4)
      ▼
 MegasetSession ─── NEW persisted proposal: id, plan, chain, quality,
      │             exclusions, ledger-freshness snapshot, edit ops
      ▼
 surfaces (unchanged four) + session verbs: megaset-keep / megaset-swap
      └─▶ rb-playlist unchanged (propose-only, full gate stack)
```

Why two stages: the plan is where landmark placement (#107.3), arc
segmentation (B3's segments become first-class), and transition-typing live
— all *sequencing decisions that don't need track data*. The fill stays the
measured engine, untouched where it is proven. This is also the only shape
that makes N-candidates cheap: build ONE plan, fill it N ways with seeded
anchor variations — candidates are comparable because they share a plan
(#107.4's "quality score ranks them" falls out for free).

## 3. The transition grammar (the differentiator, deep bet)

Phase D positioned handoffs; v3 types them. A `TransitionType` is a small
closed set, each with legality rules and cue-window semantics:

| Type | Meaning | Legality (grammar) | Data needed (all exists) |
| --- | --- | --- | --- |
| `long-blend` | 32–64 bar beat-matched blend | tempo within ±2%, keys compatible, both tracks high phrase density | cues + downbeats + BPM |
| `cut` | hard cut on a phrase boundary | outgoing track post-peak (outro third), key clash allowed ≤0.9 | cues + arc position |
| `double-drop` | climaxes aligned then cut | BOTH tracks in top energy quartile, max 1 per set, never adjacent to another | mood arousal percentiles |
| `breakdown-mix` | outgoing breaks down, incoming builds | outgoing has a detected low-energy phrase run; incoming intro arousal < set median | mood + cues |
| `hold` | DJ holds/loops out (no clean blend window) | fallback: emitted honestly with `no-cue` when window math fails | — |

Rules: the grammar is a **pure function** `legalTransitions(slot, prev, next)
→ TransitionType[]`; the engine picks deterministically (first legal by a
fixed preference order — no weights, E6 discipline); a step with no legal
type falls back to `hold` with an honest marker, never an invented window
(invariant 5, unchanged). The M3U8 `#EXTREM` comment gains the type name —
readable at the booth (competitive-analysis §3.6). Max one `double-drop` and
its position is a plan property, not a scoring afterthought.

This is scoped to stay propose-only: types are *labels on windows*, not
playback automation. If the room ever automates a handoff, cuefield's
fail-closed gating is the prior art and the rb-playlist gate stack stands.

## 4. The quality contract (#107.4, made strict)

`SetQuality` is a pure function of the SAME payload — one pass, no second
scoring (issue acceptance):

```
quality = 100 × ( 0.35·meanTransition   // existing per-step score mean
                + 0.20·arcAdherence     // measured deviation vs plan envelope
                + 0.15·diversity        // 1 − penalty (artist runs, family runs)
                + 0.10·grammarFit       // share of steps with a non-hold legal type
                + 0.10·budgetFit        // |elapsed − requested| / requested
                + 0.10·coverage )       // pool coverage + freshness of ledgers
```

Deterministic, integer-rounded, travels on every surface payload. Weights
are engine constants (E6 law — they are not knobs; they are documented and
frozen). N-candidates (#107.3+4): `megadj megaset --candidates 3` builds one
plan, fills 3 times (seeded anchor + opener rotation from the tempo-neighbor
set — S18's `seed` finally earns existence because candidates need it), ranks
by `SetQuality`, renders as tabs. The web panel gets the compare view; MCP
gains megaset_candidates (one new PROPOSED tool, docs-surface census updated in the
same commit).

## 5. The session (statefulness, the missing product layer)

A `MegasetSession` is a JSON row in a new megaset_sessions table (proposed schema) (archive.db
— MegaSet finally gets one small store; v2 §4f rules apply: honest payload,
no silent retention):

- `id` (dated, e.g. `2026-09-20-2200-warmup`), `plan`, `steps[]`, `quality`,
  `excluded_groups`, `ledger_freshness` snapshot, `created_at`, `source`
  (CLI/HTTP/MCP/web).
- **Edit verbs** (all propose-only, all operate on a stored session):
  - megadj megaset-keep <id> <step#>… (proposed verb, not built) — pin steps (the lock half of
    lock-and-regenerate).
  - megadj megaset-swap <id> <step#> <video_id> (proposed) — substitute a track;
    the engine re-fills ONLY affected slots (plan is segment-local).
  - megadj megaset-regen <id> [--from N] (proposed) — regenerate the tail after the
    last kept step, holding the plan.
- Sessions are the training-labels hook the competitive analysis flagged
  (§3.5): a kept/played session is evidence, opt-in only, nothing auto-flows
  anywhere.
- `rb-playlist` gains `--session <id>` so the write-off consumes exactly what
  was reviewed, not a re-build (determinism would allow re-builds, but
  review-what-you-write is the safer contract).

This is deliberately NOT a timeline editor (DJ.Studio's moat — explicitly
"deliberately not planned" in 03 Part 5). Keep/swap/regen is three verbs,
not a canvas.

## 6. Absorbing the open work (no orphaned proposals)

| Open item | Disposition under v3 |
| --- | --- |
| #107 B6 diversity (artist/family run penalties) | **SHIPPED Sep 21** (`46adc385`) — artist half landed; the grammar's `double-drop` gating and `SetQuality.diversity` consume it. Family-run caps (≤3) remain open under [#107](https://github.com/webuildstuffio/megadj/issues/107) |
| #107 B8 half/double-time scoring | **Half-landed Sep 21** (pair lane); v3 completes it inside `bpmScore` (×2/×½ at 0.9×), family-gated by B6 — owning issue [#311](https://github.com/webuildstuffio/megadj/issues/326) (M2) |
| #107 landmarks `--track` | **SHIPPED Sep 21** (`46adc385`, repair pass + `landmarks_missing`); v3 builds on it: landmarks pin slots at arc-appropriate positions during `buildPlan`, fill respects pins — owning issue [#327](https://github.com/webuildstuffio/megadj/issues/327) (M3) |
| #107 N-candidates + quality | §4 above — the reason v3 exists — owning issue [#328](https://github.com/webuildstuffio/megadj/issues/328) (M4) |
| v2 §4a ledger `model` column | Unchanged, still first (hours, blocks nothing); v3's sessions snapshot ledger freshness, making it more urgent — owning issue [#325](https://github.com/webuildstuffio/megadj/issues/325) (M1) |
| v2 §4a ledger `model` column | Unchanged, still first (hours, blocks nothing); v3's sessions snapshot ledger freshness, making it more urgent |
| v2 §4b pre-registered B10p A/B | Still the gate for ANY similarity-weight touch; v3 does not move the weight |
| v2 §4e failure taxonomy | Lands with sessions (the taxonomy aggregates `excluded_groups` per session — the PAR-197 loop gets real data) |
| v2 Phase D remainder (typed windows, full math in dry-run, consumer contract) | Superseded by §3's grammar — one spec, one implementation |
| LUFS (#172 → #107) | Stays parked; grammar types don't need it; `hold` covers loud-mess transitions honestly |

## 7. What v3 refuses (the reject list still binds)

Everything in [11 §5](11-master-architecture-v2.md) stays rejected — solvers,
soft diversity, learned readouts, post-fusion reordering, second towers, co-
occurrence reranks, timeline editing, cloud anything. v3 adds three refusals
of its own:

1. **No transition *synthesis/rendering*** — types describe windows; no audio
   generation (03 §3.9 stays out of scope, propose-only).
2. **No automatic grammar learning** — the type set is closed and hand-written;
   "learn transition types from data" is the co-occurrence trap again (INF-169
   class: measured 0.00pp).
3. **No session sharing/sync** — sessions are local, single-DJ; federation
   (03 §3.8) stays a door the M3U8 contract keeps open, not a feature.

## 8. Build order (dependency-honest)

| # | Move | Owning issue | State |
| --- | --- | --- | --- |
| 1 | v2 action #1: embeddings `model` column (M1) | [#310](https://github.com/webuildstuffio/megadj/issues/325) | open — hours, blocks nothing |
| 2 | #107 B6 family-run caps + B8 completion in `bpmScore` with the B6 family gate (M2) | [#311](https://github.com/webuildstuffio/megadj/issues/326) | open — artist penalty + pair lane already shipped Sep 21 |
| 3 | `buildPlan()` extraction (M3) — refactor-only, byte-identical-chain pinned; landmarks become plan inputs | [#312](https://github.com/webuildstuffio/megadj/issues/327) | open — the careful one |
| 4 | `SetQuality` + N-candidates (M4) — #107.4 + #59's scope | [#313](https://github.com/webuildstuffio/megadj/issues/328) | open (actionable slice [#288](https://github.com/webuildstuffio/megadj/issues/288) folds here or ships first) |
| 5 | Transition grammar (M5) — types + `legalTransitions` + `#EXTREM` type names | [#314](https://github.com/webuildstuffio/megadj/issues/329) | open |
| 6 | Sessions table + keep/swap/regen verbs + `rb-playlist --session` (M6) | [#315](https://github.com/webuildstuffio/megadj/issues/330) | open |
| 7 | v2 §4e taxonomy on sessions (M7) — read it before building anything else downstream | folds into [#330](https://github.com/webuildstuffio/megadj/issues/330) acceptance | — |
| 8 | Only on evidence: the §4b A/B for any prior-weight change; MERT question untouched | no issue until evidence | — |

Sizes: 1–2 are a session each; 3 is the careful one (pure refactor, census
pins); 4–6 are a session each, parallelizable after 3 lands.

## 9. Gates

- Determinism pins survive every move: same inputs → byte-identical chain (v0
  law), now also byte-identical Plan and Session.
- `genre --eval` ≥65% ship gate untouched; surface-parity rows for every new
  payload field and the megaset_candidates MCP tool in the same commits.
- Grammar: ≥95% of chained steps carry a legal non-`hold` type on the 100-mix
  test corpus, honest `no-cue` markers on the rest (v2 §4c's bar, now per-step).
- Quality: monotone with human plausibility on a 20-set hand review before
  weights freeze — one calibration pass, then constants (E6 discipline).
- Every move: `bun run check && bun test`, `check:full` before push, census
  updates same-commit.

## 10. Relationship to the doc set

[11-master-architecture-v2](11-master-architecture-v2.md) remains the
evidence synthesis and its invariants are v3 law; this doc supersedes its §4c
*shape* (typed windows) with the grammar, and extends its build order — it
does not contradict any measured verdict. [02-architecture](02-architecture.md)
§2 gains a `plan` row-set when §3 lands (variables P1–P8); this doc does not
pre-twin them. [10-findings](10-findings.md) stays the verdict entry point;
its §3 next-actions list gains one line: "v3 build order (§8 here) re-ranks
the roadmap" — pending owner approval, exactly like this doc's Status line.
