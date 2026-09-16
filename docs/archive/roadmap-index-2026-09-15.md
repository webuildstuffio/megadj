# megadj — Roadmap Index by Product

> **🗄️ ARCHIVED 2026-09-15** — superseded by GitHub as the source of truth
> (issues + labels + Project board). Retained as historical evidence; do not
> update. Open work lives in [issues](https://github.com/webuildstuffio/megadj/issues).
**Status:** 🗄️ ARCHIVED (was 🧭 ACTIVE) — categorized index of every OPEN GitHub issue mapped to
its owning roadmap row, plus the superseded/done receipts. GitHub issues are
the execution tracker; this page is the cross-product view, refreshed by the
Sep 15 roadmap-sync audits (issues #104–#174). Live state per product lives in
[product-state-2026-09-07.md](product-state-2026-09-07.md).

**Source hierarchy (Sep 15 decision):** product PRDs, the grid-audit plan, the
genre-pipeline doc, the Set audit, and the intake postmortem are the
authoritative roadmap sources; `ideas.md` is the least authoritative (random
capture, not focused scope). The three top ideas-sourced items from earlier
rounds were closed on that basis (#109, #126, #151); batch 4 (#163–#174) is
sourced from the authoritative docs only.

Priority shown is the issue label. 🟢 = physical/hardware-gated.

## 🎧 GetDat — download & archive

| Issue                                                       | Pri | Item                                 | Roadmap row   |
| ----------------------------------------------------------- | --- | ------------------------------------ | ------------- |
| [#127](https://github.com/webuildstuffio/megadj/issues/127) | p2  | "Since last gig" auto-playlist       | ideas D29     |
| [#110](https://github.com/webuildstuffio/megadj/issues/110) | p2  | 1001tracklists discovery queue       | ideas K59     |
| [#131](https://github.com/webuildstuffio/megadj/issues/131) | p2  | Auto DJ-friendly renamer             | ideas M65     |
| [#132](https://github.com/webuildstuffio/megadj/issues/132) | p2  | Archive integrity cron (blake2b)     | ideas D30     |
| [#119](https://github.com/webuildstuffio/megadj/issues/119) | p3  | DJ USB format command (+XDJ profile) | ideas M69/N77 |
| [#137](https://github.com/webuildstuffio/megadj/issues/137) | p3  | Streaming-linked source tracking     | ideas E32     |

**Closed by source decision:** #109 (ideas K57 — closed Sep 15; re-file from
the GetDat PRD if prioritized).

## 🏷️ FullTags — perfect metadata

| Issue                                                          | Pri    | Item                                                | Roadmap row            |
| -------------------------------------------------------------- | ------ | --------------------------------------------------- | ---------------------- |
| [#147](https://github.com/webuildstuffio/megadj/issues/147) 🟢 | **p0** | RUN the GA-07 write-path spike — gates every repair | grid plan GA-07        |
| [#163](https://github.com/webuildstuffio/megadj/issues/163)    | p2     | F11 rb-import dupe gate + NFC idempotency key       | postmortem F11         |
| [#165](https://github.com/webuildstuffio/megadj/issues/165)    | p2     | AC-07 cue_feedback ledger                           | grid plan AC-07        |
| [#166](https://github.com/webuildstuffio/megadj/issues/166)    | p2     | GA-05b bucket-threshold calibration                 | grid plan GA-05b       |
| [#173](https://github.com/webuildstuffio/megadj/issues/173)    | p2     | Weighted vote ladder (supersede first-win)          | genre-pipeline §5b.3.6 |
| [#169](https://github.com/webuildstuffio/megadj/issues/169)    | p2     | Regate harness → genre + effnet ledgers             | roadmap §4 gap 2       |
| [#155](https://github.com/webuildstuffio/megadj/issues/155)    | p2     | Alias depth: 241 labels → the 105×90% target        | genre-pipeline §5      |
| [#128](https://github.com/webuildstuffio/megadj/issues/128)    | p2     | Imprint prior auto-labelling                        | ideas P96              |
| [#129](https://github.com/webuildstuffio/megadj/issues/129)    | p2     | Projection head (learned metric)                    | ideas P93              |
| [#130](https://github.com/webuildstuffio/megadj/issues/130)    | p2     | Tempogram/rhythm-feature concat                     | ideas P97              |
| [#125](https://github.com/webuildstuffio/megadj/issues/125)    | p2     | Ranking metrics + A/B judgment harness              | ideas P100             |
| [#113](https://github.com/webuildstuffio/megadj/issues/113)    | p2     | Transition-window similarity                        | ideas P98              |
| [#164](https://github.com/webuildstuffio/megadj/issues/164)    | p2     | F12 dot-file receipts → archive.db                  | postmortem F12         |
| [#167](https://github.com/webuildstuffio/megadj/issues/167)    | p2     | GA-05c grid-health CrateDeck card                   | grid plan GA-05c       |
| [#123](https://github.com/webuildstuffio/megadj/issues/123)    | p3     | Composer/producer + TMED tags                       | ideas J53/D26          |
| [#157](https://github.com/webuildstuffio/megadj/issues/157)    | p3     | Active-labelling pass (~600 lowest-margin)          | ideas P95              |
| [#174](https://github.com/webuildstuffio/megadj/issues/174)    | p3     | Ledger-freshness ages on tag/compare surfaces       | AGENTS freshness rule  |
| [#170](https://github.com/webuildstuffio/megadj/issues/170)    | p3     | License ledger per model                            | roadmap §4 risk 4      |
| [#168](https://github.com/webuildstuffio/megadj/issues/168)    | p3     | GA-08 verify + staged rollout                       | grid plan GA-08        |

**Tracked in older issues (still the live trackers):** #62 cluster-proposed
labels (p1) · #63 ranked secondaries · #64 disputed-label review · #65 LLM
residue pass · #37 hygiene detector slice 2 · #35 validate receipts · #36
restore API. **Closed receipts:** #61 Music unstrand, #108 `sc_genre_ids`
drop (dated backup + census test), #114/#115 duplicates withdrawn.

## 🎚️ Set — propose the mix

| Issue                                                       | Pri | Item                                                   | Roadmap row            |
| ----------------------------------------------------------- | --- | ------------------------------------------------------ | ---------------------- |
| [#104](https://github.com/webuildstuffio/megadj/issues/104) | p1  | B1 offline mirror pool (+B13 groups)                   | audit roadmap #1       |
| [#105](https://github.com/webuildstuffio/megadj/issues/105) | p1  | B2 anchor / B3 arc / B7+B9 honesty                     | audit roadmap #2       |
| [#106](https://github.com/webuildstuffio/megadj/issues/106) | p1  | Phase D phrase-aware handoffs                          | audit roadmap #4       |
| [#171](https://github.com/webuildstuffio/megadj/issues/171) | p2  | Embeddings similarity prior (pool scoring)             | audit Phase B item 10  |
| [#107](https://github.com/webuildstuffio/megadj/issues/107) | p2  | B6 diversity · B8 half-time · landmarks · N-candidates | audit roadmap #3/6/7/8 |
| [#172](https://github.com/webuildstuffio/megadj/issues/172) | p3  | LUFS pass + extreme-transition trim                    | audit Phase B item 11  |

## 📼 CrateDeck — organize, sync, verify

| Issue                                                       | Pri | Item                                     | Roadmap row   |
| ----------------------------------------------------------- | --- | ---------------------------------------- | ------------- |
| [#116](https://github.com/webuildstuffio/megadj/issues/116) | p2  | HIST history harvest (unblocks M64/P101) | ideas B10/B11 |
| [#117](https://github.com/webuildstuffio/megadj/issues/117) | p2  | Differential mirror                      | ideas C21     |
| [#118](https://github.com/webuildstuffio/megadj/issues/118) | p2  | "Sync everything" composite job          | ideas C22     |
| [#148](https://github.com/webuildstuffio/megadj/issues/148) | p2  | New-music radar                          | PRD F10       |
| [#150](https://github.com/webuildstuffio/megadj/issues/150) | p2  | Assisted legacy-export runbook           | ideas C18a    |
| [#149](https://github.com/webuildstuffio/megadj/issues/149) | p3  | Age & wear estimates                     | PRD F10       |
| [#134](https://github.com/webuildstuffio/megadj/issues/134) | p3  | Port map & loan tracking                 | ideas B13     |
| [#135](https://github.com/webuildstuffio/megadj/issues/135) | p3  | Playlist → folder exporter               | ideas M74     |
| [#136](https://github.com/webuildstuffio/megadj/issues/136) | p3  | Weekly digest                            | ideas F39     |
| [#152](https://github.com/webuildstuffio/megadj/issues/152) | p3  | Sleep/wake drive-mace                    | ideas M72     |
| [#153](https://github.com/webuildstuffio/megadj/issues/153) | p3  | Voice/Shortcuts verdict route            | ideas F38     |
| [#154](https://github.com/webuildstuffio/megadj/issues/154) | p3  | QR / Dymo labels                         | ideas B15     |

**Closed by source decision:** #126 (ideas B10 snapshot diffs — closed by a
concurrent agent Sep 15) · #151 (ideas G42 counterfeit-capacity — closed
Sep 15; re-file from the CrateDeck PRD if prioritized).

## 🔒 Physical / hardware-gated (issues exist; runs need the gear)

| Issue                                                       | Pri    | Outcome                                                      |
| ----------------------------------------------------------- | ------ | ------------------------------------------------------------ |
| [#2](https://github.com/webuildstuffio/megadj/issues/2)     | **p0** | 0b — first verified cold backup (rclone remote unconfigured) |
| [#147](https://github.com/webuildstuffio/megadj/issues/147) | **p0** | GA-07 spike run — the four rekordbox observations            |
| [#111](https://github.com/webuildstuffio/megadj/issues/111) | p1     | GA-00 — hand-annotate the 30-track gold set                  |
| [#112](https://github.com/webuildstuffio/megadj/issues/112) | p2     | AC-01/02 structure + stems pass (MPS benchmarks)             |
| [#138](https://github.com/webuildstuffio/megadj/issues/138) | p2     | GA-02 DBN tempo priors + measured re-gate                    |
| acceptance.md ☐                                             | —      | Three manual hardware checks (F5/F4/F9) on real gig drives   |

## Deliberately not tracked (parked/struck, verified Sep 15)

K56 lyrics · K60 setlist.fm · C18b/c pdb writes · B16 menu bar · E31/E44
(Pioneer-only strikes) · I52 · M64 + P101 (blocked on #116's first real
harvest) · gig-mode shell (halves live in #116/#126) · P99 rerank (last
readout rung, behind #125/#129/#130) · K57 SoundCloud download + G42
counterfeit test (closed with source, Sep 15 — re-file from PRDs if
prioritized).

## Batch-4 sourcing receipts (Sep 15, PRD/plan docs only)

| Issue | Authoritative source           | Verified-missing evidence (Sep 15)                                         |
| ----- | ------------------------------ | -------------------------------------------------------------------------- |
| #163  | intake-cue postmortem F11 (P2) | rb-import skip-check is path/basename-only; no dupe gate, no NFC key       |
| #164  | intake-cue postmortem F12 (P1) | all 4 receipt dot-files + `.cue-engine-prototype.py` live in `~/Music/`    |
| #165  | grid-audit plan AC-07          | no `cue_feedback` table/writer in src/ or fulltags/                        |
| #166  | grid-audit plan GA-05b         | execution log has one row; no calibration table                            |
| #167  | grid-audit plan GA-05c         | no grid-health card in cratedeck/web                                       |
| #168  | grid-audit plan GA-08          | untracked; plan status 🧭 ACTIVE                                           |
| #169  | fulltags roadmap §4 gap 2      | usage lists only `regate bpm`; genre/effnet reported unavailable           |
| #170  | fulltags roadmap §4 risk 4     | no license manifest anywhere in the repo                                   |
| #171  | Set audit Phase B item 10      | no embeddings term in Set scoring (#107 covers other items)                |
| #172  | Set audit Phase B item 11      | no `loudness` command, no `lufs` ledger column                             |
| #173  | genre-pipeline §5b.3.6         | doc says "issue-tracked" but no ladder issue existed (dangling pointer)    |
| #174  | AGENTS ledger-freshness rules  | FreshnessLine exists only on the Set panel; comment-sync/compare have none |

