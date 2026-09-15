# megadj — Roadmap Index by Product

**Status:** 🧭 ACTIVE — categorized index of every OPEN GitHub issue mapped to
its owning roadmap row, plus the superseded/done receipts. GitHub issues are
the execution tracker; this page is the cross-product view, refreshed by the
Sep 15 roadmap-sync audits (issues #104–#157). Live state per product lives in
[product-state-2026-09-07.md](product-state-2026-09-07.md).

Priority shown is the issue label. 🟢 = physical/hardware-gated.

## 🎧 GetDat — download & archive

| Issue                                                       | Pri | Item                                 | Roadmap row   |
| ----------------------------------------------------------- | --- | ------------------------------------ | ------------- |
| [#109](https://github.com/webuildstuffio/megadj/issues/109) | p1  | SoundCloud as a download source      | ideas K57     |
| [#127](https://github.com/webuildstuffio/megadj/issues/127) | p2  | "Since last gig" auto-playlist       | ideas D29     |
| [#110](https://github.com/webuildstuffio/megadj/issues/110) | p2  | 1001tracklists discovery queue       | ideas K59     |
| [#131](https://github.com/webuildstuffio/megadj/issues/131) | p2  | Auto DJ-friendly renamer             | ideas M65     |
| [#132](https://github.com/webuildstuffio/megadj/issues/132) | p2  | Archive integrity cron (blake2b)     | ideas D30     |
| [#119](https://github.com/webuildstuffio/megadj/issues/119) | p3  | DJ USB format command (+XDJ profile) | ideas M69/N77 |
| [#137](https://github.com/webuildstuffio/megadj/issues/137) | p3  | Streaming-linked source tracking     | ideas E32     |

## 🏷️ FullTags — perfect metadata

| Issue                                                          | Pri    | Item                                                | Roadmap row       |
| -------------------------------------------------------------- | ------ | --------------------------------------------------- | ----------------- |
| [#147](https://github.com/webuildstuffio/megadj/issues/147) 🟢 | **p0** | RUN the GA-07 write-path spike — gates every repair | grid plan GA-07   |
| [#155](https://github.com/webuildstuffio/megadj/issues/155)    | p2     | Alias depth: 241 labels → the 105×90% target        | genre-pipeline §5 |
| [#128](https://github.com/webuildstuffio/megadj/issues/128)    | p2     | Imprint prior auto-labelling                        | ideas P96         |
| [#129](https://github.com/webuildstuffio/megadj/issues/129)    | p2     | Projection head (learned metric)                    | ideas P93         |
| [#130](https://github.com/webuildstuffio/megadj/issues/130)    | p2     | Tempogram/rhythm-feature concat                     | ideas P97         |
| [#125](https://github.com/webuildstuffio/megadj/issues/125)    | p2     | Ranking metrics + A/B judgment harness              | ideas P100        |
| [#113](https://github.com/webuildstuffio/megadj/issues/113)    | p2     | Transition-window similarity                        | ideas P98         |
| [#123](https://github.com/webuildstuffio/megadj/issues/123)    | p3     | Composer/producer + TMED tags                       | ideas J53/D26     |
| [#157](https://github.com/webuildstuffio/megadj/issues/157)    | p3     | Active-labelling pass (~600 lowest-margin)          | ideas P95         |

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
| [#107](https://github.com/webuildstuffio/megadj/issues/107) | p2  | B6 diversity · B8 half-time · landmarks · N-candidates | audit roadmap #3/6/7/8 |

## 📼 CrateDeck — organize, sync, verify

| Issue                                                       | Pri | Item                                     | Roadmap row   |
| ----------------------------------------------------------- | --- | ---------------------------------------- | ------------- |
| [#116](https://github.com/webuildstuffio/megadj/issues/116) | p2  | HIST history harvest (unblocks M64/P101) | ideas B10/B11 |
| [#117](https://github.com/webuildstuffio/megadj/issues/117) | p2  | Differential mirror                      | ideas C21     |
| [#118](https://github.com/webuildstuffio/megadj/issues/118) | p2  | "Sync everything" composite job          | ideas C22     |
| [#148](https://github.com/webuildstuffio/megadj/issues/148) | p2  | New-music radar                          | PRD F10       |
| [#150](https://github.com/webuildstuffio/megadj/issues/150) | p2  | Assisted legacy-export runbook           | ideas C18a    |
| [#126](https://github.com/webuildstuffio/megadj/issues/126) | p2  | Snapshot "what changed" diffs            | ideas B10     |
| [#149](https://github.com/webuildstuffio/megadj/issues/149) | p3  | Age & wear estimates                     | PRD F10       |
| [#134](https://github.com/webuildstuffio/megadj/issues/134) | p3  | Port map & loan tracking                 | ideas B13     |
| [#135](https://github.com/webuildstuffio/megadj/issues/135) | p3  | Playlist → folder exporter               | ideas M74     |
| [#136](https://github.com/webuildstuffio/megadj/issues/136) | p3  | Weekly digest                            | ideas F39     |
| [#152](https://github.com/webuildstuffio/megadj/issues/152) | p3  | Sleep/wake drive-mace                    | ideas M72     |
| [#153](https://github.com/webuildstuffio/megadj/issues/153) | p3  | Voice/Shortcuts verdict route            | ideas F38     |
| [#154](https://github.com/webuildstuffio/megadj/issues/154) | p3  | QR / Dymo labels                         | ideas B15     |
| [#151](https://github.com/webuildstuffio/megadj/issues/151) | p3  | Counterfeit-capacity test                | ideas G42     |

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
readout rung, behind #125/#129/#130).
