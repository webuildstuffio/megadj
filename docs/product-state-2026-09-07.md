# megadj — Current Product State

**Status:** ✅ CURRENT — qualitative product state as of 2026-09-29. The dated
filename is retained for stable inbound links; live library counts come from
commands and database ledgers, never this document.

megadj is a four-product pipeline on one Mac for Pioneer hardware:

```text
GetDat ──▶ FullTags ──▶ MegaSet ──▶ CrateDeck ──▶ the booth
archive     enrich       propose      stage and     play
music       and audit    the mix      verify
```

The shelf is the archive master beneath the whole flow. The rekordbox
collection database lives on the configured shelf, while `archive.db` remains
the pipeline ledger. See [Data stores and schema ownership](getdat/data-model.md).

## State by product

| Product   | State                           | Shipped                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Active or blocked outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Live truth                                                                                            |
| --------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| GetDat    | ✅ SHIPPED                      | YouTube Music sync, **SoundCloud as a download source (Sep 19, #255–#259: link-first, sets/user sources, 256k-Plus/160k-anonymous ladder, source-aware floors)**, URL/folder drop, scored ingest, container-truth repair, dedupe/quarantine, quality upgrades, and archive-to-shelf sync. **Sep 20: `src/ops/full-pipeline.sh` encodes the drive-day analysis chain; `fetch --revote` re-runs the vote ladder over the old first-win rows (live: 2,794 vote-elected). Sep 29: drive-day pipeline ran shelf-sync (332 files, 4.7 GB), rb-adopt (3,819 linked), rb-comment-sync (3,819 comments + genre sync)** | Additional download sources were closed NOT_PLANNED (#110/#124, Sep 19); AI genre fallback remains opt-in; remaining liked-videos backlog is #250                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `megadj status --json`, `megadj audit --json`                                                         |
| FullTags  | ✅ SHIPPED / 🧭 ACTIVE v3       | One schema, verified format-specific atomic writers, source-first metadata/artwork, Beatport identity fields, fingerprints, key/mood/energy analysis, and gated audit. **Sep 19–20: `fetch --revote` (#260) ran the vote ladder at library scale. Sep 28–29: rb-comment-sync writes Key·Energy·Mood comments to RB, enrichment fills partials from RB KeyID, genre sync writes vote-winner to RB GenreID. Artwork extraction: 1,196 embedded→RB artwork paths. Sep 29: parallel mood/embedding workers (`--jobs N`), groundTruth cache, FullTags v3 rebench plan landed**                                                                                                                    | BPM tag writes remain blocked; structure, vocal-density, and cue work continue through the grid plan. **Sep 29 analysis coverage: mood 4,553 / beats 4,536 / embeddings 3,823 (730 gap being closed) / genre 4,861 (96.5%)**. FullTags v3 plan (`docs/fulltags/fulltags-v3-rebench-and-build-plan-2026-09-29.md`) gates every threshold move on `megadj bench` re-measurement                                                                                                                                                                                                                                                             | `megadj audit --json`; [FullTags roadmap](fulltags/fulltags-roadmap.md)                               |
| MegaSet   | ✅ SHIPPED v0 / 🧭 ACTIVE v1    | Deterministic propose-only mix builder, whole-library pool, CLI/HTTP/MCP/web surfaces, M3U8 export, and DB/XML-twinned rekordbox playlist write-off                                                                                                                                                                                                                                                                                                                | Re-ranked improvements include small-pool search, diversity, richer arcs, alternatives, and phrase-aware handoffs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | [PRD](megaset/01-prd.md), [benchmarks (archived)](archive/set-04-sequencing-benchmarks-2026-09-14.md) |
| CrateDeck | ✅ SHIPPED v0.1                 | Drive registry/ghosts, scans, verify and preflight, fleet coverage, checksums, job orchestration, local web UI, deckctl, and MCP. **Sep 22: cratedeck/ folded into src/deck/ (#193-pattern atomic migration, 433 files). Sep 23: TS7 toolchain, dedup arc (#322/#317)**                                                                                                                                                                                              | The three manual hardware checks were closed NOT_PLANNED with [#175](https://github.com/webuildstuffio/megadj/issues/175) (Sep 16); differential mirror SHIPPED (#117, Sep 16); assisted legacy export stays planned (#150)                                                                                                                                                                                                                                                                                                                                                                                                              | `deckctl status --json`; [Acceptance](deck/acceptance.md)                                             |

Exact interface counts are deliberately absent here. They are derived from
source and pinned in [Surface parity](surface-parity.md) §1.

## Storage and safety state

The safety invariants — the shelf as archive master with additive,
hash-verified intake, the user-managed playing USB, rekordbox-closed
`master.db` writes with dated backups, role-aware health checks, and
quarantine-over-delete — live once in [`AGENTS.md`](../AGENTS.md); the
surface-by-surface write boundary lives in
[the playing USB boundary](getdat/usb-sync.md). This page does not
restate them.

Operational evidence belongs in `archive.db`, CrateDeck state, command JSON,
and the intentionally gitignored local `docs/usb-sync-log.md`. Durable failure
mechanics belong in the [Agent playbook](agent-playbook.md), not repeated here.

## Next outcomes

The order below summarizes outcomes, not issue status. GitHub issues are the
execution tracker and the roadmap SSOT (the former ideas catalog is archived
at [archive/ideas-2026-09-15.md](archive/ideas-2026-09-15.md)).

1. Complete the hardware-gated safety work: evacuate the failing Extra
   volume (runbook 0a). Cold backup is SHELVED by owner decision (#2
   closed NOT_PLANNED Sep 20): the shelf IS the backup — `shelf-sync`
   to SHELF1 keeps every track on two physical copies.
2. Run the rekordbox write-path spike and record its four observations before
   any automated grid-repair route is selected.
3. Finish the gold annotations that unlock calibrated grid, structure, and cue
   gates; keep all unpassed writers blocked.
4. Exercise CrateDeck's acceptance checks on real gig hardware when the
   drives are at hand (the #175 tracker closed NOT_PLANNED Sep 16; the
   three check recipes live in `docs/deck/acceptance.md`).
5. Advance MegaSet v1 from measured evidence: small-pool search first, then
   diversity/arc controls and phrase-aware handoffs.

## Canonical evidence

- [Features and projects](FEATURES.md) — durable product responsibilities.
- [Surface parity](surface-parity.md) — exact current interface census and
  exemptions.
- [Data stores and schemas](getdat/data-model.md) — database roles and executable
  schema owners.
- [FullTags roadmap](fulltags/fulltags-roadmap.md) and
  [grid/cue plan](fulltags/grid-audit-plan.md) — analysis gates and remaining stages.
- [Set documentation](megaset/01-prd.md) — PRD, architecture, comparator
  research, benchmarks, genre policy, and embedding evidence.
- [CrateDeck acceptance](deck/acceptance.md) — completed and manual
  acceptance checks.
- [Hardware runbooks](runbooks/) — executable procedures for blocked physical
  work.
