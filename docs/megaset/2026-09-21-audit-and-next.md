# MegaSet — Full Honest Audit (Sep 21) and What To Improve Next

**Date:** 2026-09-21 (evening audit, ~18:00–20:00 ET)
**Scope:** live measured analysis + scoring review of the #283 megaset work, with every found defect fixed, saving/logging UX hardened, and this doc as the improve-next record.
**Status:** SHIPPED (fix commit `46adc385`; gates: `check` exit 0, 2,051 tests / 0 fail, `check:full` exit 0 at ~19:40 ET). **Improvement pass (same evening, ~19:30–20:30 ET):** three #107 items implemented fully on top of the audit fixes — **B6 diversity guard** (`megasetArtistRepeatPenalty` + `same_artist_pairs` wire counter; same head-credit artist back-to-back ranks last, never walled), **B8 half/double-time lane** (pairings near ×2/×½/×1.5/×⅔ score 0.75 instead of 0, × `MEGASET_HALFTIME_PENALTY` 0.9), **S13 landmark pins** (`--landmark <id>` repeatable on CLI/web/MCP/HTTP; engine repair pass inserts each pin at its first arc-legal position; unplaceable pins → `excluded` + `landmarks_missing`), plus dedupe v4 (uploader-channel fold) found live during the proof sets. Proof builds: peak-90 house (15 tracks, avg 1.131, 0 same-artist pairs), afterhours-60 (18 tracks), peak-75 house with 3 pins (2 landed — one at 23.7m — ghost pin honestly reported). Gates: `check` exit 0, full suite 2,068 tests / 0 fail.

---

## 1. The audit method

No remembered numbers: two fresh live builds against the real archive DB
(peak 60 min unfiltered; warmup 30 min `--genre "tropical house"`), the
JSON payloads diffed for defects, the chain read track-by-track for
dedupe/quality problems, and the archive DB probed directly
(`sqlite3` over `~/.local/state/megadj/archive.db`) to separate "engine
bug" from "library state".

Live baseline (Sep 21, ~18:15 ET): 4,033 downloaded rows → 3,690 pool,
**3,665 metadata-only** (shelf unmounted — mirror-built proposals are
correct B1 behavior, not a bug), 342 aliases collapsed pre-fix, freshness
beats/mood ≈ 20 h. Genre spread of the downloaded library: EDM 683,
House 633, Techno 501, Tech House 328, Pop 213, blank 198, Hip-Hop 179,
Progressive House 157, Deep House 134, Afro House 75.

## 2. Defects found live (all fixed in `46adc385`)

| #   | Defect                                                                                    | Evidence (live)                                                                                       | Fix                                                                                              |
| --- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | Dedupe v2 misses: same recording twice in ONE chain                                       | Azzecca "Other Side (Extended)" + "(Extended Mix)" back-to-back (peak); HUGEL "Morenita" ×2 (tropical) | dedupe v3: bare release forms strip, multi-credit artists collapse to HEAD credit, in-title `.mp3` strips (pinned in `pool.test.ts`) |
| 2   | `excluded_groups` bucketed by RAW reason string — noise, not shape                        | 130 buckets for 3,681 exclusions ("68.2-min…" and "68.6-min…" separate rows)                          | `megasetReasonClass` → 8 stable classes; live re-run: 3 buckets; CLI gained the exclusion-shape line |
| 3   | Mix pill dead column: fixed cut-offs predate the B2 anchor + #171 similarity bonuses      | every live blend 1.10–1.19, all read "clean" (≥0.75)                                                  | bands derived in the shared seam (`MEGASET_TIGHT_FLOOR` 0.5 / `MEGASET_CLEAN_FLOOR` 1.05), row tone follows |
| 4   | Web ReproLine dropped `--genre`                                                           | a filtered build's "same build from the terminal" silently rebuilt unfiltered                          | `--genre` rides the repro line; regression-pinned                                             |
| 5   | Draft save violated the dated-artifact rule and was request-blind                          | `set-peak-64.5min-draft.json` — no date, no genre/search/limit/opener anywhere                        | dated filename + `request{}` block with the exact CLI repro line                               |
| 6   | CLI header never mentioned the genre filter                                                | `--genre "tropical house"` run printed a header indistinguishable from unfiltered                      | `· genre pool N tracks` in the header line                                                     |
| 7   | Exclusions copy lie: "save the JSON draft for the full list" — the draft held the same capped 40 | wire `excluded[]` cap ≠ draft content                                                            | copy now states the group counts cover the full total (groups derive engine-side from the FULL list) |

Not a defect (checked and cleared): metadata-only 3,665 = shelf offline +
mirror tempo, exactly the B1 design; `avg_transition` 1.176 on peak is the
bonus-era scale, not score inflation (see #3); the 125 "too long" exclusions
are DJ mixes/sets/albums correctly parked.

## 3. Scoring honesty review (the "full honest analysis scoring" ask)

The scoring chain (tempo ±6% → Camelot → anchor budget ±12% → arc
direction → weighted blend + similarity) is **sound and measured** — E6/E7
benchmark evidence stands, and the live chains demonstrate it (warmup
house: Bbm→Fm glide, arousal 4.3→5.0 climb; every exclusion accounted).
The honest gaps are UX-truth gaps, not math gaps, and all are now fixed
or filed (§4):

- **Transition scores are not comparable ACROSS builds** (pool composition
  changes the scale) — `avg_transition` is honest within a build only.
  Filed as [#284](https://github.com/webuildstuffio/megadj/issues/284).
- **The score's magnitude is invisible** (bands say clean/ok/tight but the
  web shows the number only in hover) — CLI carries it per-step; web now
  agrees via band + hover. Deeper per-component breakdown filed as #286
  stretch.
- **Budget-fill dominance**: 3,541 of 3,679 exclusions are "set budget
  filled" — true but uninformative; the real quality signal lives in the
  125 too-long / 13 too-short / future compatibility buckets. The class
  grouping makes this shape visible at a glance for the first time.

## 4. What to improve next (ordered, owner-decision ready)

**Status note (2026-09-22):** items 1, 4, 5, 6 have since shipped or been
superseded — item 1 shipped in `23379c2c` (#284, with #291/#290/#294 in the
same burn-down); item 4's CLI half shipped in `23379c2c` (#290
`genre_suggestion`; the web datalist remains open as #285); item 5 is open as
[#286](https://github.com/webuildstuffio/megadj/issues/286); item 6 is open as
[#288](https://github.com/webuildstuffio/megadj/issues/288). Item 2 shipped
Sep 21 (`3437a574`, #282). The list below is the original Sep 21 text, kept
verbatim for the audit record.

1. **[#284](https://github.com/webuildstuffio/megadj/issues/284) — per-step scoring evidence on the wire** (`tempo`/`key`/`arc`/
   `anchor`/`similarity` per transition): makes every blend auditable and
   cross-build comparison honest. Small wire change, engine already
   computes the parts.
2. **#282 — rb-playlist reconcile scoping** (carried from Sep 20): the
   whole-DB scan still flags ~180 RB-managed playlists as missing XML
   twins. Agent-subtree scoping is the fix; block on a design call.
3. **Superseded-set cleanup at the next write session**: the two known
   broken tropical sets (`v2 tropical house 60min`, `v3 …62min` from the
   Sep 20 session report §7) still sit in the master next to the clean
   `v3 …65min`. Delete through the rb seam with dated backups.
4. **Genre filter UX** ([#285](https://github.com/webuildstuffio/megadj/issues/285)): free-form input matches literally — "afro" hits
   the afrohouse family via synonym, but "gqom" builds an honest empty
   pool. A family-suggest dropdown (from `MEGASET_GENRE_FAMILIES` keys)
   on the web Genre step would prevent dead-end builds.
5. **Build-time telemetry** ([#286](https://github.com/webuildstuffio/megadj/issues/286)): the 15–19 s whole-shelf build has no
   server-side timing split (the web phase list is a fixed schedule, not
   measurement). One `Date.now()` pair per census stage in
   `setCandidates` → honest phases on the wire.
6. **N-candidates compare mode (#107 item 4, S14)**: still the biggest
   missing product capability — the engine is deterministic, so N chains
   need only seeded/strategy variants + a compare view. Split into the
   actionable slice as
   [#288](https://github.com/webuildstuffio/megadj/issues/288).
7. **Analysis freshness action**: beats/mood at 21 h with new imports
   waiting — the freshness line says "run `megadj beats` + `megadj mood`";
   the web could link the run instead of telling. One catch-up gap pass:
   [#289](https://github.com/webuildstuffio/megadj/issues/289).
   **SHIPPED Sep 23**: `megadj catch-up` (one beats→mood gap pass,
   ledgered == analyzed unless `--force`); the web freshness line now
   names the one verb.

## 4b. Issue batch from this audit (Sep 21, filed same evening)

- [#287](https://github.com/webuildstuffio/megadj/issues/287) — superseded-set
  cleanup (the two broken tropical sets), the §4 item 3 write-session op.
- [#288](https://github.com/webuildstuffio/megadj/issues/288) — N-candidates
  compare mode, actionable slice of #107 item 4 (§4 item 6).
- [#289](https://github.com/webuildstuffio/megadj/issues/289) — one beats/mood
  catch-up gap pass; ledgered==analyzed short-circuit respected (§4 item 7).
- [#290](https://github.com/webuildstuffio/megadj/issues/290) — CLI unknown
  `--genre` guard: nearest-family suggestion instead of silent empty pool
  (CLI twin of #285, same `MEGASET_GENRE_FAMILIES` source).
- [#291](https://github.com/webuildstuffio/megadj/issues/291) — "set budget
  filled" is a status, not an exclusion: 3,541 uninformative rows currently
  drown the 138 real quality exclusions; report it outside `excluded_groups`.
- [#292](https://github.com/webuildstuffio/megadj/issues/292) — plain M3U8
  export for a finished chain (non-RB booths, USB-key players, sharing).
- [#293](https://github.com/webuildstuffio/megadj/issues/293) — load a saved
  draft back into the web builder (save→load→rebuild round-trip).
- [#294](https://github.com/webuildstuffio/megadj/issues/294) — transition
  score magnitude inline in the web chain, not hover-only (stopgap until
  #284's per-component evidence).
- [#295](https://github.com/webuildstuffio/megadj/issues/295) — genre-cohort
  builder runs: one reusable command for warmup/peak pairs per family, from
  the measured genre spread in §1.
- [#296](https://github.com/webuildstuffio/megadj/issues/296) — genre backfill
  for the 198 blank-genre downloaded rows via the #173 vote ladder (real
  sources only, missing stays missing).

## 5. Receipts

- Fix commit: `46adc385` (14 files, +385/−45; LOC bypass audit-logged —
  growth is regression pins for live-found defects)
- Live proof pre/post: Azzecca twin out of the chain, `duplicate_files`
  342 → 344, `excluded_groups` 130 → 3 buckets, genre header line on
  filtered builds, exclusions-shape line on terminal
- Gates at push: `bun run check` exit 0 · `bun test` 2,051 pass / 0 fail ·
  `bun run check:full` exit 0 (100% typecov + ruff + mypy strict)
- New regression pins: `pool.test.ts` (3 dedupe v3 cases),
  `megaset.test.ts` (reason classes, band floors),
  `megaset/engine.test.ts` (class-coverage invariant),
  `fulltags-similar-ux.test.tsx` (repro `--genre`, capped-preview copy)
