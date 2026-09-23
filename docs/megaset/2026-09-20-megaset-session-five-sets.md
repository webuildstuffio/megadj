# MegaSet Session — 5 DJ Sets, Built, Scored, and Landed in Rekordbox

**Date:** 2026-09-20 (evening session, ~22:00–23:30 ET; round 2 "10x" pass ~03:00–04:00 ET)
**Scope:** genre-filtered set building end-to-end — new feature, 5 sets built + scored + evaluated, all 5 written into the SHELF1 rekordbox master as the `MegaSets` group, 4 live defects found and fixed along the way. Round 2: quality stats on the wire, `--search` un-noop'd, pool parity + dedupe v2, five cleaner v2/v3 sets applied.
**Status:** SHIPPED (round 2 sets are the live ones — see §7)

---

## 1. The five sets (all in rekordbox under `MegaSets`)

| #   | Playlist name                                       | Preset     | Genre filter   | Tracks | Runtime  | Complete | Pool  | Avg transition | Post-verify  |
| --- | --------------------------------------------------- | ---------- | -------------- | ------ | -------- | -------- | ----- | -------------- | ------------ |
| 1   | `megaset warmup house 60min 2026-09-20`             | warmup     | house          | 10     | 60.3 min | ✅       | 1,355 | 1.121          | 10/10 linked |
| 2   | `megaset tropical house 60min 2026-09-20` (the ask) | peak       | tropical house | 11     | 66.5 min | ✅       | 1,354 | —              | 11/11 linked |
| 3   | `megaset warmup deep house 60min 2026-09-20`        | warmup     | deep house     | 10     | 60.3 min | ✅       | 1,355 | —              | 10/10 linked |
| 4   | `megaset peak tech house 60min 2026-09-20`          | peak       | tech house     | 12     | 64.0 min | ✅       | 319   | —              | 12/12 linked |
| 5   | `megaset afterhours house 60min 2026-09-20`         | afterhours | house          | 13     | 60.6 min | ✅       | 1,355 | —              | 13/13 linked |

Every set: whole-track chain from the beats/mood ledgers, Camelot-key compatible (±6% tempo window, drift budget), arousal arc scored against the preset envelope, phrase-aware mix-in/mix-out windows from the cues ledger. Dry-run predicted the link count read-only; `--apply --yes` wrote with dated DB+XML backups and post-verified row counts.

### Set 2 — the requested "60 min house, tropical house, nice with buildup" (peak arc)

| at min | artist                         | title                                          | key | transition |
| ------ | ------------------------------ | ---------------------------------------------- | --- | ---------- |
| 5.6    | Piem, Cessle Innit             | Colours Of House (Original Mix)                | Abm | —          |
| 11.7   | Black Loops                    | Higher                                         | Abm | 1.19       |
| 17.9   | Saison                         | Man Of Soul                                    | Ebm | 1.18       |
| 24.6   | Dan Ghenacia                   | Close to the Edge                              | 2A  | 1.18       |
| 30.7   | Weiss                          | Feel My Needs (Original Mix)                   | Ebm | 1.17       |
| 34.9   | Purple Disco Machine           | Every Body Dance Now (DAN:ROS Edit)            | Bbm | 1.17       |
| 39.8   | Black V Neck                   | Like Whoa                                      | 4A  | 1.17       |
| 44.8   | Shiba San                      | I Wanna (Tchami Extended Remix)                | Fm  | 1.17       |
| 52.0   | Fresh And Low                  | New Life                                       | Cm  | 1.16       |
| 58.7   | Akulav                         | Sa Good (Original Mix)                         | Fm  | 1.16       |
| 66.5   | Tortured Soul vs. Black Coffee | I Know What's on Your Mind (Ethan White remix) | Fm  | 1.15       |

Arc shape: opens sunny/mid-energy, holds groove through the middle, lands on the deepest cuts (Tortured Soul remix) — the "peak" preset keeps arousal 5.5→8 lifted while the tempo anchor pins 125 BPM; the buildup is the energy envelope, not a BPM ramp (deliberate: anchor budget caps drift at ±12%).

### Set 1 — warmup house (the textbook build)

| at min | artist                 | title                                | key | transition |
| ------ | ---------------------- | ------------------------------------ | --- | ---------- |
| 3.5    | Wamdue Project         | King of My Castle                    | Bbm | —          |
| 9.4    | Ultra Naté             | Free                                 | 4A  | 1.13       |
| 18.1   | CeCe Peniston          | He Loves Me 2 (Silk's 12" Mix)       | 4A  | 1.13       |
| 24.6   | Folamour               | Nights Over You                      | Bbm | 1.13       |
| 31.6   | Technasia              | I Am Somebody                        | Fm  | 1.13       |
| 36.8   | SecondCity             | History of Groove                    | Fm  | 1.12       |
| 43.4   | Supernova              | Tuyo                                 | Cm  | 1.12       |
| 49.0   | John Summit feat. Nica | Witch Do                             | Fm  | 1.12       |
| 55.1   | Will Taylor (UK)       | The Way (John Summit & Kaysin Remix) | Fm  | 1.12       |
| 60.3   | adam port, stryv       | move (laureano, fede meyer remix)    | Fm  | 1.11       |

Classic 4/4 warm-up: 125 BPM throughout, key glide Bbm→4A→Fm, arousal climbs 4.3→5.2 across the hour. The climax is the Keinemusik-leaning "move" — exactly where a warm-up should hand over.

---

## 2. How the sets were scored and evaluated

Scoring is the shared engine (`src/deck/megaset/engine.ts` + `scoring.ts`), same code path for CLI, web, MCP and rb-playlist:

- **transitionScore** = tempo (0.45) + key (0.30) + arc fit (0.25), plus a #171 embeddings similarity bonus (0.1) when both tracks have vectors
- **BPM**: ±2% perfect, linear to 0 at ±6%; anchor drift budget ±12% on the whole chain (half/double-time branch exempt)
- **Key**: Camelot-compatible glide; the warmup house set runs Bbm→4A→Fm (energy-compatible Camelot moves)
- **Energy arc**: arousal (1–9 mood scale) + danceability sampled per slot against the preset envelope, with within-third reversal penalty (ε=0.6)
- **Sequencer**: greedy on big pools, beam (width 8) under 250 candidates — pool 319 for tech house still ran greedy
- **Handoffs**: mix-in/mix-out 8-bar phrase windows from the cues ledger, carried as m3u comments and per-step evidence (e.g. "mix-in 43s @ bar 57")

Evaluation numbers quoted above are from the live archive ledger (freshness: beats + mood both Sep 21 01:25 UTC). Nothing is hand-scored.

---

## 3. The new feature: genre pool filter (wired into UX, all surfaces)

**One shared matcher** (`src/deck/shared/megaset.ts`):

- `MEGASET_GENRE_FAMILIES` — 14 families (house, techno, tropical house, deep house, tech house, progressive house, edm, hip-hop, pop, trance, dnb, dubstep, disco, afrohouse), each with synonyms; `"tropical"` resolves to the tropical-house family
- `MEGASET_GENRE_FALLBACKS` — starvation widening: strict `tropical house` matched only **10 rows** (beam dead-end at 1 track); below the 250-row beam threshold the pool widens to `house` → **1,440 rows**, tropical-labelled tracks included via OR
- `genre_filtered` rides the wire so a filtered build is always visible (never a silent subset)

**Surfaces wired:**

| Surface | How                                                                                                                                                |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP    | `GET /api/archive/megaset?genre=tropical%20house` (m3u8 export carries it too)                                                                     |
| CLI     | `megadj megaset --genre "tropical house"` / `megadj rb-playlist /Volumes/SHELF1 --genre house …`                                                   |
| MCP     | `megaset_propose` tool `genre` param                                                                                                               |
| Web     | MegaSet panel — new **Genre** step (3): typeahead-free search field, live matched-count ("pool narrowed to N tracks"), build/export links carry it |

**Pool hygiene found live and fixed in the same pass:** the same audio sat at two different paths (`York · On The Beach · …Kryder….mp3` vs `York/On The Beach/on the beach….mp3`) and both landed in one set. Pool dedupe is now two-stage: NFC/casefold path key (existing) + artist|title key with release-form suffix stripping (`(original mix)`, `(extended mix)`, `(radio edit)`… — remix attributions stay, they're different playable tracks).

Issue: [#283](https://github.com/webuildstuffio/megadj/issues/283)

---

## 4. Bugs found and fixed during this session

| #   | Bug                                                                                                                                | Root cause                                                                                           | Fix                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | rb-playlist dry-run always failed `NameError: unicodedata` then `NameError: os`                                                    | `playlist-predict.kit.py` used kit fragments requiring both imports but never imported them          | added `import os` + `import unicodedata`                           |
| 2   | every `rb-playlist --apply --yes` died "malformed JSON" and auto-rolled back (DB+XML restored from backup — the safety net worked) | `playlist-write.kit.py` called `rid()` (from `pyNewPlaylist`) without the `@kit(PY_RID_FN)` fragment | added `# @kit(PY_RID_FN)`                                          |
| 3   | reconcile never parsed its own scan: "playlist DB scan returned an invalid payload"                                                | scan emitted a bare JSON array + `parentId: "root"`; parser requires `{"db":[…]}` + numeric-id regex | scan now wraps `{"db":[…]}` and maps root→`0`                      |
| 4   | same song twice in one proposal (path-level dedupe can't see shelf-rescue strays)                                                  | two DB rows, two real paths, one physical recording                                                  | two-stage pool dedupe (path key + title key with suffix stripping) |

## 5. New issue filed (not fixed — needs a design call)

**[#282](https://github.com/webuildstuffio/megadj/issues/282)** — `rb-playlist reconcile` scopes to the **whole DB**, so it reports ~180 RB-managed playlists (user's own + key folders + CUE Analysis) as "missing XML twins". The XML sidecar intentionally carries only agent-written playlists (DJ-Imports, SC intakes, MegaSets). Reconcile needs to scope to agent-managed subtrees. One orphan NODE left by the diagnosis (old tropical playlist id) was removed by hand with a dated backup.

---

## 6. Hard state receipts

- Playlists verified in master.db **and** `masterPlaylists6.xml` (twin rule: both or neither): `MegaSets` group + 5 children (9/10/10/12/13 tracks)
- Dated backups written by the apply legs: `master.db.bak-20260921T032327` … `T032623`, plus `masterPlaylists6.xml.bak-*` for each mutation and one manual pre-edit backup
- rekordbox was closed for every write (pgrep gate); re-export reminder: **green master ≠ hardware sees it** — the USB needs a fresh export at the next drive day
- Pool numbers quoted live: house family 1,436 rows (1,406 fully analyzed), tech house 319, strict tropical 10 → widened 1,440
- Regression tests: `src/deck/shared/megaset.test.ts` (matcher: 7 cases) — the SQL/pool leg is pinned by the live acceptance runs above; web fixture updated for the new `genre_filtered` wire field

## 7. Round 2 — the 10x pass (late Sep 20, same session)

Audit of round 1 found the sets **unevaluable** (no set-level quality stats)
and dug out two more live defects. All fixed; five **v2/v3** sets rebuilt and
applied on top of round 1's, every one verified 12/12-style zero-unmatched.

**Feature deltas (wired to every surface):**

- `avg_transition` + `min_transition` now ship on the megaset payload
  (engine → CLI `--json` → web result card → report line): sets are
  comparable without hand-deriving from `steps[]`.
- `rb-playlist` gained `--search` (greedy/beam force) — and the audit caught
  that it had been a **silent no-op**: the flag parsed but never reached the
  engine. Measured effect: identical warmup args built an **18-track** chain
  via rb-playlist vs **23** via the megaset CLI. After the fix both produce
  the same 23-track chain.
- `rb-playlist` now passes the configured shelf Contents root to the archive
  reader — a bare reader resolved relocated strays as missing and silently
  shrank the pool (same 18-vs-23 incident).
- **Dedupe v2** (the 3×-Epoch incident): one Cristoph "Epoch" recording
  landed **three times** in the applied tropical set — a tagged row, a
  truncated shelf-rescue stray (`…[Pryda Prese`, unclosed bracket), and a
  lost-tag stray (`artist=UnknownArtist`, real artist riding the title).
  `poolTitleKey` now strips unclosed bracket suffixes and **lends the
  title-embedded artist back** to the key for unknown-artist rows; all four
  DB variants of the recording collapse to one key
  (pinned in `src/deck/megaset/pool-contract.test.ts`).

**The five sets (v2/v3, all in rekordbox under `MegaSets`, all DB+XML twins,
zero unmatched):**

| Set                              | Preset     | Genre          | Tracks | Runtime   | avg blend | worst blend | search |
| -------------------------------- | ---------- | -------------- | ------ | --------- | --------- | ----------- | ------ |
| `v2 warmup house 90min`          | warmup     | house          | 23     | 95.0 min  | 1.110     | 0.920       | beam   |
| `v3 tropical house 65min`        | peak       | tropical house | 12     | ~65 min   | 1.174     | 1.156       | beam   |
| `v2 deep house afterhours 90min` | afterhours | deep house     | 19     | 92.7 min  | 1.157     | 1.096       | greedy |
| `v2 afro house 60min`            | peak       | afro house     | 11     | 66.5 min  | 1.173     | 1.158       | greedy |
| `v2 peak marathon 120min`        | peak       | house          | 19     | 120.4 min | 1.176     | 1.160       | greedy |

A/B evidence captured live: tropical 60min beam beat greedy on runtime
(62.2 vs 66.5 min) at equal avg transition; deep 90min greedy beat beam on
runtime (92.7 vs 95.8) at equal quality — beam only pays on sparse pools,
matching the `MEGASET_BEAM_POOL_MAX` design.

**Known artifacts to clean at the next write session** (never hand-edit the
master outside the seam): `megaset v2 tropical house 60min 2026-09-20`
(10/11 linked, pre-dedupe-fix) and `megaset v3 tropical house 62min
2026-09-20` (11/12, one `[archive 2]` stray with no master row) are
superseded by the clean `v3 …65min` set. Delete both after the dated-backup
gate; the `GOAT X Rakever Latzfon` `[archive N]` strays still lack master
rows (import the stray batch or exclude the family).

## 8. What's still open (owner decisions)

- Quarantine judging (1.2 GB / 71 files) — QuarantinePanel
- The Paro 70 purchase-links decision — `megadj surfaced-note <id>` or `--force-rip`
- Hygiene 304 open findings — listen-through or #37 detectors
- `booth-fix --apply` — 10 file renames awaiting go-ahead (quickest win)
- Write-path spike #147 — 30 min at rekordbox, gates the grid/cue repair chain
- Genre refold + apply (66.6% agreement, passes the 65% gate) — ~900 refused rows would get labels
