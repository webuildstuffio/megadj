# megadj documentation

**Status:** ✅ CURRENT — canonical navigation and documentation ownership map.

This index lists every maintained document under `docs/`. Start with the
[current product state](product-state-2026-09-07.md), then follow the owning
document for the topic you are changing.

## The four products, one paragraph each

- **GetDat** — the intake pipeline: `megadj sync` pulls new music,
  `megadj drop` runs the one-shot download → ingest → fetch → analyze →
  organize → tag-check chain, `megadj shelf-archive`/`shelf-sync` land
  everything on the SHELF1 archive master (additive, junk-filtered,
  MD5-verified). The shelf is the collection SSOT.
- **FullTags** — the enrichment engine: format-specific atomic tag
  writers, the art/year/genre ladders, beats/mood/cues/embeddings
  ledgers, and the ≥65%-gated kNN genre readout. Genre comes from a
  weighted multi-source vote (#173) with the full breakdown persisted
  per track; `megadj audit` is the ground-truth gate.
- **MegaSet** — the co-pilot: turns measured data (beats, key, mood,
  energy, embeddings, 8-bar phrase cues) into a Camelot-compatible
  ordered mix proposal with cue-window handoffs — propose-only, the DJ
  keeps every creative decision; `megadj rb-playlist` is the gated
  write-off.
- **CrateDeck** — mission control for DJ USB drives: every drive a card
  (mounted or ghost), deep verify down to ANLZ beatgrid math, dual-DB
  agreement, mirror parity, bench anomaly + role-aware checks, and the
  rekordbox interlock that refuses everything while rekordbox runs.

## Ownership and status

- `AGENTS.md` owns agent rules and safety invariants.
- [Product principles](PRINCIPLES.md) own product decisions.
- [Product state](product-state-2026-09-07.md) owns the qualitative shipped,
  active, and blocked summary. Its dated filename is retained for stable
  inbound links; the status header carries the actual as-of date.
- **GitHub is the single source of truth for roadmap work**: issues own
  executable work, priority, and status; product PRDs and plan docs own the
  WHY and the measured numbers. The former ideas/roadmap-index pages are
  archived (`archive/ideas-2026-09-15.md`,
  `archive/roadmap-index-2026-09-15.md`) — file and triage work on GitHub.
- [Features](FEATURES.md) owns the durable product map.
- [Surface parity](surface-parity.md) owns exact CLI, HTTP, MCP, and UI census
  numbers. Other docs link there instead of copying them.
- [Data stores and schemas](getdat/data-model.md) owns schema navigation,
  the state-dir retention map (which backups exist and who may sweep them),
  the sacred rekordbox-backup rules, and the honest library-size
  decomposition. Executable schema definitions remain in their code producers.
  The operational loop for storage/cleanup questions is the
  `storage-intake-census` skill.
- [Agent playbook](agent-playbook.md) owns durable failure mechanics. The local
  `docs/usb-sync-log.md` is append-only operator evidence and is intentionally
  gitignored; it is not a repository link or a second status store.
- [Runbook 0e](runbooks/0e-full-pipeline.md) owns the drive-day full-pipeline
  command (`ops/full-pipeline.sh`): the Sep 20 serial analysis chain, its
  gate math, and the pre-flight/verification checklist.

Status vocabulary: ✅ `CURRENT`/`COMPLETE`/`SHIPPED`, 📚 `REFERENCE`, 🧭
`ACTIVE`, 🟡 `BLOCKED`, 🗄️ `ARCHIVED`, and 🗄️ `SHELVED` (retained on
purpose by an owner decision — the runbook/procedure stays for a
revisited decision).

## Roadmap on GitHub

Product-categorized backlog lives in GitHub issues (labels `type:*`,
`priority:*`, `effort:*`; product is in the title prefix). Notable
umbrellas: the [parked ledger](https://github.com/webuildstuffio/megadj/issues/178)
(deliberately-unbuilt register) and #178's rejection register
for the ideas closed NOT_PLANNED (the former #175 hardware-checks
tracker is one of those — the recipes stay in the acceptance doc).

## Product and decision references

- [Product state](product-state-2026-09-07.md) — current product-level status
  and the next safe outcomes.
- [Features and projects](FEATURES.md) — GetDat, FullTags, MegaSet, and
  CrateDeck responsibilities.
- [Product principles](PRINCIPLES.md) — decision authority and non-goals.
- GitHub issues — the roadmap and backlog; see the "Roadmap on GitHub"
  section above.
- [Archived ideas backlog](archive/ideas-2026-09-15.md) — historical idea
  catalog; superseded by GitHub issues.
- [Data stores and schemas](getdat/data-model.md) — database roles, schema producers,
  state-dir retention ownership, and the library-size honesty rules.
- [Surface parity](surface-parity.md) — live interface contract and exemptions.
- [Agent playbook](agent-playbook.md) — failure history and reusable lessons.

## Product documentation

### GetDat

- [Data stores and schemas](getdat/data-model.md) — schema roles, ownership, and
  producer boundaries.
- [SoundCloud downloads plan (SHIPPED Sep 19)](getdat/soundcloud-downloads-plan.md) —
  the link-first acquisition design record; SC is a first-class download
  source (#255–#259, 256k-Plus/160k-anonymous ladder, surface census rev-44–47).
- [Playing USB boundary](getdat/usb-sync.md) — SHELF1-to-USB handoff rules and
  user-managed export limits.
- [Shelf hygiene snapshot](getdat/shelf-hygiene-2026-09-09.md) — Sep 9–10
  detect/restore record; the quarantine loop closed Sep 19 (#35/#36),
  remaining detectors tracked in #37.

### FullTags and analysis

- [FullTags roadmap](fulltags/fulltags-roadmap.md) — gate outcomes and analysis roadmap.
- **Tags comparison surface (Sep 15)** — FullTags ⌗ Tags now shows
  FullTags ↔ rekordbox ↔ live-file tag sources side by side: pure-DB
  census (`archive_tag_census`) + per-track three-source read
  (`archive_tag_compare`); read-only, files never read on the census path.
- [Genre audit](fulltags/genre-audit.md) — inclusion and source-precedence
  policy; v3 statistical revalidation (CIs, McNemar, duration guards).
  MegaSet consumes it family-level only.
- [Embedding model benchmark](fulltags/embedding-models.md) — tower
  evaluation and decision; v2 rerun (effnet confirmed on both metrics),
  fusion sweep settled (+1.1 pt — not adopted). Feeds MegaSet's similarity
  prior (B10p).
- [Genre taxonomy sources](fulltags/genre-taxonomy-sources.md) — external
  authorities and the family map.
- [Embedding research review (Sep 14)](archive/embedding-research-2026-09-14.md)
  — external deep-read (archived): tower landscape, probe/readout ladder,
  compute + licence audit, adoption verdicts.
- [Tier-0 diagnostics, first live run (Sep 15)](archive/tier0-diagnostics-2026-09-15.md)
  — the battery implemented + measured on the full library (archived;
  verdicts live in the FullTags roadmap revs): random label
  noise, no artist leakage, hub tail confirmed, `edm↔house` is the error
  block, probe loses to kNN. Re-ranked the genre plan.
- [Genre refold (Sep 15)](fulltags/genre-audit.md) — `edm` umbrella
  arbitration + label canonicalization SHIPPED: LOO gated 61.7% → 69.2%
  (+7.4 pts), ≥65% post-refold target PASS (§5b.3 step 1). Demote-and-flag
  (§5b.3 step 2) shipped: 96/2982 disputed labels flagged + excluded from
  seeding; Tier-0 battery re-ran clean post-flag.
- **Bandcamp arm (Sep 15, rev 7.8)** — the fetch ladder's third catalog
  vote (`src/fulltags/sources/bandcamp.ts`, W2b): hard-artist-gated search +
  one page fetch voting genre/year/label/art, on the shared
  name-matching SSOT (`src/fulltags/sources/name-match.ts`). Same-day
  consolidation: #66 masterDbPath (11/11 callers), #67 NFC+casefold
  name key, #82 errorText SSOT — all pinned by tests; #67/#82/#75/#100
  issues closed with evidence.
- [Genre pipeline architecture (Sep 16, rev 6)](fulltags/genre-pipeline.md) —
  how the genre system processes a track end to end: **§2 is the full
  write-source inventory** (every path that can put a genre in the DB —
  sync/fetch-SC/fetch-BP/**fetch-imprint (W7)**/fetch-Bandcamp/AI/MusicBrainz/
  ingest/kNN — including the two
  commonly forgotten: `megadj enrich` and `megadj ingest`), then hygiene
  passes, **the dispute review surface (`genre --disputes` +
  `--agree`/`--keep`, #64)**, inference discipline, scoring read path, the ≥65%
  gate, the tag census/compare surfaces, 11 invariants, design
  rationale, and live state. Start here for "where does genre come from?"
- [FullTags + GetDat merge proposal (Sep 20)](fulltags/fulltags-getdat-merge-2026-09-20.md) —
  📋 measured merge proposal (not owner-approved, nothing moved): one
  directional module graph, ~−430 LOC projection, phased plan with
  census pins.
- **Weighted genre vote ladder (Sep 16, #173)** — the fetch ladder no
  longer writes first-win: every rung (SC / Beatport / Bandcamp /
  imprint prior / AI / MusicBrainz / file tags / sync category) casts a
  vote — genre + weight + provenance — with the weights versioned in
  code (`GENRE_VOTE_WEIGHTS`, `src/fulltags/genre/genre-vote.ts`, mirroring
  the pipeline doc's W-table). Highest total weight elects; ties break
  deterministically toward the harder single gate; the full per-track
  breakdown persists in `tracks.genre_votes`, so any stored genre is
  explainable from its row ("why Techno?" needs no code reading). Hard
  gates stay absolute upstream (artist gate, numeric/`Music` refusal) —
  a vote only exists for a claim that already passed its rung's gates.
- **Genre explainability + the live run (Sep 17, #215)** — `megadj
genre-why <id>` (CLI, MCP `archive_genre_why`, HTTP
  `/api/archive/genre-why`, FullTags ⌗ Genre Why tab) replays the
  write path's exact election seam over a row's stored breakdown; a
  drifted row reports `matches_db:false` (CLI exit 1). The Genre tab's
  **Run view** streams the ladder live: `fetch` is a job kind (the
  shared JobEngine — interlock, cancel), the CLI's stderr `@event`
  protocol feeds a server ring buffer, and the tab renders every
  track's votes, the election, and a rung tally as they happen.
- **Regate extends to genre (Sep 16, #169)** — `megadj regate genre
--json` runs the same leave-one-out harness as `genre --eval` against
  the ≥65% ship gate; `regate effnet` reports unavailable honestly
  until its reference ledger exists (never a manufactured pass).
- [Grid audit, repair, and auto-cue plan](fulltags/grid-audit-plan.md) — active grid and
  cue program.
- [rekordbox WAV artwork](fulltags/rekordbox-wav-artwork.md) — resolved format decision
  retained as a reference.

### MegaSet

- [PRD](megaset/01-prd.md) — scope, shipped v0, and product contract.
- [Architecture](megaset/02-architecture.md) — variables, ownership, and data
  flow.
- [Competitive analysis](megaset/03-competitive-analysis.md) — comparator
  research and the re-ranked roadmap.
- [Consolidated findings & next steps](megaset/10-findings.md) — every
  measured verdict across the doc set, critical-bug list, prioritized next
  3–5 actions.
- [Migration plan (archived)](archive/set-09-migration-plan-2026-09-15.md) —
  the executed `setbuild → megaset` identifier rename; superseded 2026-09-15
  (the product name is MegaSet) and archived with the Sequencing benchmarks
  ([archive/set-04-sequencing-benchmarks-2026-09-14.md](archive/set-04-sequencing-benchmarks-2026-09-14.md)).
- [Master architecture v2](megaset/11-master-architecture-v2.md) — the v2
  synthesis (📐 proposal): cross-shop invariants, the four evidenced v2
  layers, and the reject list (all 19 DIV diversity experiments dead —
  diversity ships as hard caps only).
- [Playlist generator v3](megaset/12-playlist-generator-v3.md) — 📐 deep
  re-architecture proposal: two-stage plan-and-fill, the transition grammar,
  a strict quality contract, and resumable sessions; absorbs #107 and v2's
  open layers.
- [Audit and plan](megaset/08-audit-and-plan.md) — per-item
  implementation sketches, delta-pinned against the re-ranked roadmap;
  current conclusions link to the owners above.
- **Embeddings similarity prior (Sep 16, #171)** — `transitionScore`
  gains a capped bonus (`MEGASET_SIMILARITY_WEIGHT` 0.1) from the
  cosine similarity of both tracks' stored embedding vectors,
  rescaled 0..1. Precedence is untouched: the tempo/key/anchor gates
  run first, so timbre only breaks ties among already-mixable
  candidates — it never rescues a clash. Tracks without stored vectors
  get no bonus, never a penalty (honest-gap rule).
- [Embedding learnings from megamem (Sep 17)](megaset/embedding-learnings-from-megamem-2026-09-17.md)
  — cross-pollination review of the megamem dev-docs corpus (2,003
  experiments at the Sep 18 v2 re-census, 127 model-swap MDLs) for
  MegaSet's embedding prior: whitening/hubness convergence with our
  tier-0 results, prior-weight and A/B methodology (Wilcoxon), what
  doesn't transfer, and a ranked top-10 of actions (ledger model
  column, pre-registered A/B, spectral diagnostic).

### CrateDeck

- [PRD](cratedeck/02-prd.md) — product requirements.
- [Architecture](cratedeck/03-architecture.md) — current runtime structure.
- [Acceptance](cratedeck/acceptance.md) — verified code gates and the three
  hardware-check recipes (their tracker closed NOT_PLANNED; run them from
  the doc when the drives are at hand).

## Operations and incident references

- [Playing USB boundary](getdat/usb-sync.md) — SHELF1 preparation, user-owned export,
  and read-only verification.
- [Intake and cue postmortem](fulltags/intake-cue-postmortem.md) — executed incident
  analysis and remaining follow-up.
- [Shelf hygiene snapshot](getdat/shelf-hygiene-2026-09-09.md) — Sep 9–10 record
  with detector and restore-surface limits; the loop closed Sep 19 (#35/#36);
  live work is #37.
- [Source-layout refactor](archive/src-layout-refactor.md) — completed proposal
  and migration receipt, archived 2026-09-14; historical paths in the proposal
  are labeled as such.

### Hardware-gated runbooks

- [0a — evacuate Extra](runbooks/0a-evacuate-extra.md) — blocked until the
  volume mounts.
- [0b — cold backup](runbooks/0b-cold-backup.md) — SHELVED: the shelf is
  the backup (owner call, #2 closed NOT_PLANNED Sep 20); the rclone
  procedure is retained for a revisited decision.
- [0c — BACKUP2 verdict](runbooks/0c-orphan-verdict.md) — completed decision;
  procedure retained for evidence.
- [0d — rekordbox write-path spike](runbooks/0d-write-path-spike.md) — harness
  shipped; hardware observations remain.
- [0e — drive-day full pipeline](runbooks/0e-full-pipeline.md) — the one
  command (`ops/full-pipeline.sh`) encoding the Sep 20 analysis chain.

## Package entry points

- [`README.md`](../README.md) — repository overview and setup.
- [`cratedeck/README.md`](../cratedeck/README.md) and
  [`deckctl.md`](../cratedeck/deckctl.md) — CrateDeck operator entry points.
- [`src/fulltags/README.md`](../src/fulltags/README.md) — FullTags package reference.
- [`plugin/README.md`](../plugin/README.md) — plugin packaging and symlinked
  skill ownership.
- CrateDeck UI implementation notes:
  [`web/ui/DESIGN-NOTES.md`](../cratedeck/web/ui/DESIGN-NOTES.md) and
  [`web/products/fulltags/DESIGN-NOTES.md`](../cratedeck/web/products/fulltags/DESIGN-NOTES.md).

## Archive

Archived files are historical evidence, not current instructions:

- [Executed roadmap proposal](archive/roadmap-proposal.md)
- [Archived ideas backlog](archive/ideas-2026-09-15.md) — the pre-GitHub-SSOT
  idea catalog, archived 2026-09-15; its trackers and parking block moved to
  GitHub issues (#104–#178).
- [Archived roadmap index](archive/roadmap-index-2026-09-15.md) — the former
  product-categorized issue index; superseded by GitHub labels/search.
- [Codebase quality snapshot](archive/codebase-quality-report.md)
- [Code quality progress report (Sep 17 → Sep 20)](code-quality-2026-09-17.md) — measured
  push summaries (60 issues/3 days, then the Sep 20 scorecard: reorg program
  closed 6/7, gates at best-ever, 8 issues open) and the honest 75k-census
  verdict; the live trend lives in the megadj-quality-trend canvas.
- [Source-layout refactor receipt](archive/src-layout-refactor.md) — moved
  2026-09-14; the old-path redirect stub was removed 2026-09-15, so this
  archive path is the only reference.
- [MegaSet sequencing benchmarks](archive/set-04-sequencing-benchmarks-2026-09-14.md)
  and [MegaSet migration plan](archive/set-09-migration-plan-2026-09-15.md) —
  measured evidence + executed rename receipt, archived 2026-09-15.
- [Tier-0 diagnostics](archive/tier0-diagnostics-2026-09-15.md) and
  [embedding research review](archive/embedding-research-2026-09-14.md) —
  completed measurement runs retained as evidence.
