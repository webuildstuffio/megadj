# MegaSet Improvement Pass + Super-Sure Verification — Full Report

**Date:** Sep 21, 2026 (evening session, ~19:30–21:15 ET; burn-down pass 21:30–22:30 ET)
**Commits:** `95a1e0ca` (improvement pass) → `d740df84` (super-fix) → `23379c2c` (queue burn-down: #284/#291/#290/#294), all pushed to `main`
**Gates at push:** `check` exit 0 · `check:full` exit 0 (type-coverage success 100%, ruff clean, mypy strict clean) · full suite **2,082 pass / 0 fail** (post-`23379c2c`)
**Status:** SHIPPED + VERIFIED + QUEUE BURNED. This doc is the deep walkthrough (what/why/how), the learnings record, and the next-steps queue. The defect-level audit from earlier the same day lives in [`2026-09-21-audit-and-next.md`](2026-09-21-audit-and-next.md); the architecture truth lives in [`02-architecture.md`](02-architecture.md).

---

## 0. Queue burn-down (Sep 21, ~22:00 ET, `23379c2c`)

Four of the seven "what to improve next" items from §7 shipped in one pass:

- **#284 per-step scoring evidence — SHIPPED.** Every transitioned step now carries a `MegasetEvidence` breakdown on the wire: weight-scaled `tempo/key/arcFit/anchor/similarity`, the B6 `artistPenalty`, a `total` that EXACTLY equals the wire blend, and a B8 `halftime` flag. `transitionEvidence()` (scoring.ts) is the one seam; the engine recomputes at the search's exact full-precision slot clock (a first draft keyed off the rounded `atMin` field and drifted — caught by the new sum==blend pins, which is the feature working as designed). CLI step lines render it (`[t 0.45 · k 0.30 · arc 0.20 · anch 0.10 · sim 0.10 · B6 −3+1]`), the web hover carries it, the MCP description documents it. The B6 penalty initially escaped the breakdown (0.01 blend vs 0.91 component sum) — now structurally impossible: the pins force total == blend through the penalty path.
- **#291 budget-fill as status — SHIPPED.** `excluded_groups` carries only genuine quality reasons; the count moved to `budget_filled` on the wire. CLI: `pool 150 → chain kept the rest · set budget filled for 114 · quality exclusions (31): 28 too long · 3 too short`. Web `ExcludedBreakdown` renders the status note. The 3.5k-row drowning shape is gone.
- **#290 genre guard + fallback bug — SHIPPED (+1 bug found and fixed in-pass).** `megasetNearestGenreFamily` (bounded edit distance ≤3 over the SAME family table, no twin list) suggests the nearest family when `--genre` matches 0 rows; `genre_suggestion` rides the CLI JSON and the HTTP payload. **Bug:** the starvation fallback keyed on the RAW genre string — `--genre tropical` (synonym-resolves to tropical house) never widened to house while `--genre "tropical house"` did. `megasetGenreFallbackTerms` now resolves by family; live-proven byte-identical 17-track sets for both spellings.
- **#294 inline score magnitude — SHIPPED (stopgap).** The web mix pill shows the score inline (`1.12 clean`) instead of the information-free band label alone; the full hover-panel UX remains future work under #284's web rendering.

**Live proof (22:00 ET):** peak/30-min/250-pool build — every step's evidence sums to its blend (e.g. Mau P hop 1.149 = t .45 + k .30 + arc .20 + anch .10 + sim .10); warmup build shows the status line; gqom suggests edm with `genre_suggestion` on the wire; tropical ≡ "tropical house" fallback parity. Tests: +10 pins across scoring/engine/shared/CLI/web; full suite 2,072 → 2,082.

---

## 1. What was asked, what shipped

Three asks, executed in order:

1. **"Make improvements and generate 3 new sets that are way way better and implement 3 improvements on it fully"** — three #107 roadmap items implemented end-to-end (engine → shared types → CLI → HTTP → MCP → web UI → docs → tests) and proven with three live-generated sets. Shipped in `95a1e0ca`.
2. **`/super-sure`** — the verification pass. Ran the hard gate (`check:full`) that the feature pass had not run, plus a line-by-line audit of the new scoring/repair code. Found **4 real defects the green gates could not see**.
3. **`/super-fix`** — all four defects fixed with regression pins, plus two follow-up issues filed ([#303](https://github.com/webuildstuffio/megadj/issues/303), [#304](https://github.com/webuildstuffio/megadj/issues/304)). Shipped in `d740df84`.

The three improvements (owner-selected from the #107 scope):

| Item | What it does | Where it lives |
| --- | --- | --- |
| **B6 — diversity guard** | Same head-credit artist back-to-back loses the slot to any fresh-named peer (penalty 3 > weighted core ceiling ~1.25). A ranking penalty, never a hard gate: an artist-only pool still chains. Wire reports `same_artist_pairs` as the honest census. | `megasetArtistRepeatPenalty` + `megasetArtistKey` in `src/deck/shared/megaset.ts`; consumed in `transitionScore` (`src/deck/megaset/scoring.ts`) |
| **B8 — half/double-time lane** | A pairing near ×2/×½/×1.5/×⅔ (within 6%) scores 0.75 × `MEGASET_HALFTIME_PENALTY` (0.9) where the ±6% direct window scored 0 — an 87↔174 DnB mix-out or the 87-trap-under-130-house "feel" pairing now competes. | `isMegasetHalfTimePair` + constants in `src/deck/shared/megaset.ts`; consumed via `megasetTempoLane` in `scoring.ts` |
| **S13 — landmark pins** | `--landmark <videoId>` (repeatable) on CLI, `?landmark=` on HTTP, `landmarks` array on MCP, "Must-play tracks" field on the web builder. The engine runs a repair pass that inserts each unplaced pin at its first arc-legal position; `landmark: true` marks wire steps; unplaceable pins are excluded honestly and listed in `landmarks_missing`. | Repair pass in `src/deck/megaset/engine.ts`; surfaces in `src/fulltags/cli/cli-commands.ts`, `src/deck/api/routes-archive.ts` + `tools.ts`, `src/deck/web/products/fulltags/megaset-*` |

Plus a fourth fix found **live during the proof runs** (not planned):

- **Dedupe v4** — YouTube re-uploads put the *uploader channel* ("Trap City" vs "Trap Nation") in the artist slot, so the same SHAKED remix appeared twice under different "artists". `poolTitleKey` now folds the channel name and trusts the title's embedded `Artist - Title` split when the credited name is uploader-ish (`UPLOADER_NAME_RE`, 8 channels measured live). Pinned in `src/deck/megaset/pool-contract.test.ts`.

---

## 2. How each improvement works (the deep walkthrough)

### 2a. B6 diversity guard — penalty, not gate

The constraint: stop one artist dominating a 90-minute set, without ever dead-ending a chain. The design that satisfies both:

- `megasetArtistKey` normalizes to the **head credit** ("A, B & C" → "a"), case-folded, en-US. This is deliberately the *same* normalization the pool's dedupe uses for credit lists — the diversity guard and the dedupe cannot disagree about who an artist is.
- `megasetArtistRepeatPenalty` returns `MEGASET_ARTIST_REPEAT_WINDOW` (3) when prev and candidate share the key, 0 otherwise. **Unknown artists (null) are never penalized** — absence of a name is not a name.
- In `transitionScore`, the penalized score is `Math.max(0.01, raw − penalty + 1)`. The arithmetic is the whole design:
  - The weighted core's ceiling is ~1.25 (0.45 + 0.3 + 0.25 + 0.15 anchor + 0.1 similarity).
  - `raw − 3 + 1` ≈ `raw − 2` puts the penalized step at **< 0.3** — below every fresh-named peer that shares its gates. The fresh peer *always* wins the slot.
  - The `+1` floor and the 0.01 clamp keep the score **strictly positive**, so a pool of only-that-artist still chains (the greedy/beam loops treat ≤ 0 as a wall). Honesty: the census *counts* what happened (`same_artist_pairs: 2` on an artist-only set) rather than pretending diversity happened.

Live proof (set 1, peak/house/90m): 15 tracks, `same_artist_pairs: 0`.

### 2b. B8 half/double-time lane — one lane, one discount, no tax

The problem: mixability is geometric (`|a−b|/max(a,b) ≤ 6%`), which makes an 87 BPM trap cut and a 174 BPM DnB cut *unmixable by definition* — but any DJ knows they pair (the DnB plays at the trap's double-time feel). The lane:

- `isMegasetHalfTimePair(a, b)` checks b/a against the factor set **[2, 0.5, 1.5, 2/3]** within `MEGASET_HALFTIME_TOLERANCE` (0.06). The ×1.5 / ×⅔ lanes are the *feel* lanes: 87 trap under a 130 house set is a 1.49× relationship in raw BPM.
- `megasetTempoLane(a, b)` (post-super-fix) returns the direct `bpmScore` slope when it is > 0 — **untouched** — and only outside the window offers the flat `0.75 × MEGASET_HALFTIME_PENALTY` pair value. So a pair lane hop scores at most `0.45 × 0.675 = 0.30` of tempo contribution while a perfect direct match scores 0.45: **half-time never beats an equal-everything direct match**, which was the plan-of-record contract (03-competitive-analysis item 6, penalty 0.9).

The super-fix discovery matters here (see §3, F1+F3): before `d740df84` the discount was applied to *every* hop (a silent ~10% tax on all direct matches), and the anchor gate's branch exemption only covered ×2/×½ — which made the advertised ×1.5 feel lane mathematically unreachable. Both fixed with pins.

### 2c. S13 landmark pins — repair, not search rewrite

The search functions score *compatibility*, not *importance* — they cannot know a track is a must-play. Rather than thread a priority weight through greedy/beam (and re-litigate every benchmark), the engine keeps search pure and adds a **repair pass** after it:

1. Collect pins: deduped, first-requested order. A pin the search already picked (or that won the opener slot) is satisfied.
2. A pin not in the scored pool at all (unknown id, not downloaded, no measured tempo) → `excluded` with "landmark not placeable — not in the candidate pool (unknown id, or not downloaded/analyzed)" + `landmarks_missing`.
3. Otherwise, walk the built chain slot by slot; at each slot score **both hops** (predecessor→pin at the pin's slot position, pin→successor at the successor's new position) through the full `transitionScore`. First slot where both hops are arc-legal wins; the pin is spliced in, the displaced successor's stale transition is recomputed from the pin, and the wire step gets `landmark: true`.
4. A pin with no legal slot anywhere → excluded with "landmark not placeable — no arc-legal position in this set (key clash, tempo outside ±6%, or drift budget)" + `landmarks_missing`. Never silently dropped.
5. Bucket-integrity invariant: the leftover accounting skips pin-explained ids (`pinExplained`), so every candidate still lands in exactly one bucket (chain XOR excluded) — pinned by test.

Post-super-fix, the pass scores **position-true**: `t` comes from the elapsed clock at the insertion slot, not a hardcoded 0 (see §3, F2).

Live proof (set 3, peak/house/60m, pin `rb-240471064`): the search never picked it; the repair pass slotted it at position 4/12 with an arc-legal 1.18 transition, `landmarks_missing: []`.

### 2d. Dedupe v4 — the uploader-channel fold

`poolTitleKey` builds the identity key per pool row. The v4 rule: when the row's credited artist is an uploader-ish channel name (`UPLOADER_NAME_RE`: trap city, trap nation, chill nation, mrrevillz, selected, cloudx, house city, future classic, magic club — the 8 seen live) **and** the title self-describes (`Artist - Title …` split), the embedded artist replaces the channel in the key. A real credited artist is never overridden — "John Summit vs Nova" stays authoritative even when the title also self-describes. Matching runs on the raw name (readable list), identity keys stay normalized.

---

## 3. Super-sure: what the verification pass found

The feature pass ended green on `check` + `bun test`. The super-sure pass runs the hard gate (`check:full`) and audits the diff against the documented contracts. Result: **`check:full` was green** (type-coverage 100%, ruff, mypy strict), but the audit found 4 defects — two of them contradicting the shipped docs' own promises. All fixed in `d740df84`:

| # | Defect | Why the gates missed it | Fix + pin |
| --- | --- | --- | --- |
| **F1** | `MEGASET_HALFTIME_PENALTY` (0.9) scaled **every** hop's tempo term — a silent ~10% tax on direct matches too, contradicting the constant's own doc ("0.9× = the plan-of-record value") and the code comment ("half-time never beats an equal-everything direct match" — it didn't, but only because *both* were taxed). | Test asserted `> 0` on a pair lane; nothing pinned the direct lane's magnitude. Doc and code agreed with each other and were both wrong about intent. | `megasetTempoLane`: discount rides the pair lane only. Pins: lane value `0.75×0.9` exact; direct 128→134 equals bare `bpmScore`; full-weight direct outscores pair through `transitionScore`. |
| **F3** | `withinAnchorBudget` exempted only ×2/×½ branches → the advertised 87↔130 (×1.49) pairing died at the anchor gate *before* `isMegasetHalfTimePair` ran. The feel lane shipped as **dead code** — provable by constraint analysis (no `(anchor, prev, c)` triple satisfies both the gate and the lane while using the ×1.5 factor). | The B8 test used 87↔174, which the ×2 branch exemption admitted — the test suite exercised a different path than the docs advertised. | The budget gate now defers to the pairing predicate. Pin: 87↔130 with `withinAnchorBudget === false` yet `transitionScore > 0`. |
| **F2** | The S13 repair pass scored both pin hops at **t=0** — the arc's start. Wrong fit/anchor inputs, stale successor recomputes, and — the real risk — for any future preset with a non-climbing arousal third, it would force-insert a pin through a B3 direction wall the search itself can never commit. | All three shipped presets have monotonically climbing arousal thirds, so the direction gate is t-invariant today — the bug was latent, visible only in wrong `fit`/`anchor` magnitudes. | Repair scores position-true (`t` from the elapsed clock; successor recomputed at its new slot). Pin: every wire transition recomputes from scratch at its true slot (3-decimal wire rounding). Follow-up tripwire: [#304](https://github.com/webuildstuffio/megadj/issues/304). |
| **F4** | CLI `landmarkIds: [...repeatedOf(...), ...manyOf(...)]` double-collected `--landmark=X` — `repeatedOf` already parses eq-form inline (its own doc says so). Benign only because the engine dedupes pins. | No CLI-level test pins flag collection; the engine's dedupe swallowed the duplicate downstream. | Single `repeatedOf(rest, "landmark")`; `manyOf` import dropped. |

Post-fix state: net +134 LOC (audit-logged bypass — fixes plus their regression pins outweigh), `check` exit 0, `check:full` exit 0, 2,072 pass / 0 fail, pushed, pre-push suite green.

---

## 4. The three sets, before and after the super-fix

All generated live against the real archive DB via `bun run src/cli.ts megaset … --json`.

| Set | Command | Pre-super-fix (`95a1e0ca`) | Post-super-fix (`d740df84`) | What it proves |
| --- | --- | --- | --- | --- |
| **1 · peak house 90** | `megaset --preset peak --minutes 90 --genre house` | 15 steps, complete, avg 1.131, min 1.110, `same_artist_pairs: 0` | 15 steps, complete, **avg 1.176, min 1.155**, `same_artist_pairs: 0` | B6 census at 0 on a filtered pool; F1's untaxed direct matches lift every blend score ~4% — the honest scale |
| **2 · afterhours 60** | `megaset --preset afterhours --minutes 60` | 18 steps, complete, avg 1.062, 18/18 unique titles | 18 steps, complete, **avg 1.106**, 18/18 unique titles | Dedupe v4 (no uploader twins); unfiltered pool; F1 lift again |
| **3 · peak house 60 + pin** | `megaset --preset peak --minutes 60 --genre house --landmark rb-240471064` | pin at 4/12, transition 1.147, `landmarks_missing: []` | pin at 4/12, **transition 1.180**, `landmarks_missing: []`, every wire transition > 0 | S13 repair inserts the unpicked pin mid-chain at an arc-legal slot; position-true scoring on the wire |

Also exercised in-test (not just live): unplaceable-pin honesty (`ghost` + `clasher` → `landmarks_missing`, each self-explaining in `excluded[]`), bucket integrity with pins active, artist-only pools chaining through B6, and the ×1.5 lane through the budget gate (F3).

---

## 5. Process learnings (the "why it happened" layer)

1. **`check` green hid nothing this time — but `check:full` was never run on the feature pass.** The rule ("claim the hard gate only after `check:full`") exists because typecov and mypy see what tsc doesn't; this session it was clean, but running it *only* in the verification pass means the window between feature-commit and hard-gate was unverified. The super-sure command now effectively owns that step; feature passes should run it before pushing, not after.
2. **A doc-comment contract can be wrong in both directions at once.** F1's comment *and* constant doc both promised "half-time never beats direct" while the code taxed both lanes equally — internally consistent, externally wrong. The only thing that catches this is a magnitude pin (exact value or comparative inequality), not a sign pin. Rule of thumb going forward: **pin the inequality the comment promises, not just the sign.**
3. **Reachability is a test surface, not a given.** F3 shipped a lane that no input could reach — every test used the one BPM pair the *other* exemption admitted. When adding a lane below a gate, the pin must construct the input that *only* the new lane admits (87↔130 for the feel lane), not the convenient example (87↔174).
4. **Live proof runs are defect detectors, not celebrations.** Dedupe v4 was found by reading set 2's chain, not by any test — the twins were real rows in the real DB, which no synthetic fixture had modeled. Keep the loop: implement → live-generate → read the chain track-by-track → fix what the read finds → pin it.
5. **The file-length hook forced a genuinely better test layout.** `engine.test.ts` at 1,028 lines (900 limit) pushed the B6/B8/S13 behavior block into `scoring.test.ts` (co-located with the scoring subject it exercises — census-legal). The alternative (`GIT_SKIP_FILE_LENGTH_CHECK=1`) was available and wrong; the split now gives scoring-level pins a natural home.
6. **Two audit-logged bypasses in one session** (`MEGADJ_LOC_BYPASS` ×2, `GIT_ALLOW_LARGE_COMMIT` ×1) is the honest cost of a feature + verification cycle in a net-reduction budget. Both reasons are typed into the bypass env var and live in the commit messages; the LOC debt (+700, +134) is the number to claw back in the next cleanup pass.
7. **Concurrent-agent hygiene held**: staged-as-edited throughout, no `git add -A`, no reset/checkout on the shared tree, commit blocked → read the block log → fixed the *cause* (file split) rather than reaching for `--no-verify`.

---

## 6. Technical learnings (reusable facts)

- **Transition scores moved ~4% upward after F1** (1.131 → 1.176 avg on set 1). Any cross-build comparison quoting pre-`d740df84` blends against post-`d740df84` blends is comparing different scales on top of the already-known cross-build caveat (#284). Note it when diffing old drafts.
- **`megasetTempoLane` is now the one seam for "how does this hop score on tempo"** — direct slope inside the window, `0.75 × 0.9` on the pair lanes, 0 otherwise. `transitionScore` and the tests both consume it; a future UI showing per-step tempo evidence (#284) should read it too.
- **The anchor gate and the pairing lane are coupled by design now**: `!withinAnchorBudget(c.bpm, anchorBpm) && !isMegasetHalfTimePair(anchorBpm, c.bpm)` is the single admission condition. Any future drift-budget change must re-check the ×1.5/×⅔ lanes remain reachable (the F3 pin does exactly this).
- **Repair-pass slot clock convention**: a hop into step *k* is scored at `t = elapsed-through-(k−1) / budget` — the same convention greedy/beam use. The exactness pin encodes it; don't "fix" it to the entered step's own `atMin` (that convention mismatch cost two test iterations to find).
- **`repeatedOf` covers BOTH flag forms** (`--k v` and `--k=v`); pairing it with `manyOf` on the same key double-collects eq-form values. One helper per flag, always.
- **Wire rounding**: `transition` values on the wire are rounded to 3 decimals (`Math.round(x*1000)/1000`); exactness assertions use `toBeCloseTo(fresh, 3)`.
- **`UPLOADER_NAME_RE` is a measured list, not a solved problem** — the long tail of promotion channels is tracked as [#303](https://github.com/webuildstuffio/megadj/issues/303) with a weekly-diff evidence shape.

---

## 7. What to improve next

The standing queue from the audit doc (§4 there) is unchanged in its ordering; the items touched or newly created by this session:

**Direct follow-ups from this session**

1. **[#303](https://github.com/webuildstuffio/megadj/issues/303) — dedupe v4 vs the uploader long tail.** The 8-channel regex is honest about being measured, not complete. Owner call between reactive extension (cheap), pool-derived uploaderishness (self-maintaining, needs a measurement pass), or ingest-time normalization (risky). Recommended: option 2, gated on the weekly-diff evidence shape in the issue.
2. **[#304](https://github.com/webuildstuffio/megadj/issues/304) — non-monotone-preset tripwire.** Zero work today; becomes a hard requirement the moment a plateau/double-hump preset (cooldown is the obvious candidate) is proposed. The F2 exactness pin is the standing guard until then.
3. ~~#284 per-step scoring evidence~~ — **SHIPPED in `23379c2c`** (§0).
4. **#288 N-candidates compare** — unchanged as the biggest product gap; the deterministic engine + seeded variants design is untouched by this session's changes. **Now the top engineering item in the queue.**
5. **#295 genre-cohort builder runs** — the three live sets this session were hand-run one-offs; the reusable command this issue describes is how they become a routine. Note the #303 weekly-diff evidence shape wants this command to exist.

**Also ride-along-able**

- ~~#291~~ / ~~#290~~ / ~~#294~~ — **SHIPPED in `23379c2c`** (§0); #285 (web family dropdown) remains, and can now consume the same `genre_suggestion`/family-table seam.
- **#297 (RB gauntlet at next drive mount)** — not megaset, but the highest-cost-of-wait item in the queue; the 3,131 TKEY writes evaporate if rekordbox re-analyzes first.

**Deliberately not queued**

- Superseded-set cleanup (#287) and the genre backfill (#296) stay parked behind their write-session/analyzer prerequisites as ordered in the audit doc.
- No new preset work (including the cooldown idea from #304) should start before #288's compare mode — N-candidates is the evaluation harness every future preset change will want.

---

## 8. Receipts

- Feature commit `95a1e0ca`: 25 files, +755/−46. LOC bypass audit-logged (feature growth requested by owner). Fix commit `d740df84`: 4 files, +159/−25. LOC bypass audit-logged (fixes + pins).
- `check:full` exit 0 at ~21:00 ET: `type-coverage success` (100%, `--at-least 100`), ruff clean, mypy strict clean, 2,072 pass / 0 fail.
- Push to `main` twice, both pre-push full-suite runs green (2,069 → 2,072 tests).
- Test delta this session: 2,051 (pre-audit) → 2,072 (post-super-fix), +21 pins, all pinning behavior the docs promise rather than the code happens to do.
- Issues filed: [#303](https://github.com/webuildstuffio/megadj/issues/303) (uploader long tail, `type:feature`/p3/m), [#304](https://github.com/webuildstuffio/megadj/issues/304) (preset tripwire, `type:chore`/p3/xs).
- Docs updated in-pass: [`02-architecture.md`](02-architecture.md) (B8 lane, B6 penalty, S13 repair, dedupe v4, S13/S17 shipped markers), [`FEATURES.md`](../FEATURES.md) (megaset status + `--landmark` example), [audit doc](2026-09-21-audit-and-next.md) status header.
