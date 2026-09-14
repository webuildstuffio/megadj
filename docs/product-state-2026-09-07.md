# megadj — Current Product State

**Status:** ✅ CURRENT — qualitative product state as of 2026-09-14. The dated
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
the pipeline ledger. See [Data stores and schema ownership](data-model.md).

## State by product

| Product   | State                           | Shipped                                                                                                                                                               | Active or blocked outcome                                                                                           | Live truth                                                                  |
| --------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| GetDat    | ✅ SHIPPED                      | YouTube Music sync, URL/folder drop, scored ingest, container-truth repair, dedupe/quarantine, quality upgrades, and archive-to-shelf sync                            | Additional download sources remain backlog items; AI genre fallback remains opt-in                                  | `megadj status --json`, `megadj audit --json`                               |
| FullTags  | ✅ SHIPPED / 🧭 ACTIVE ANALYSIS | One schema, verified format-specific atomic writers, source-first metadata/artwork, Beatport identity fields, fingerprints, key/mood/energy analysis, and gated audit | BPM tag writes remain blocked; structure, vocal-density, and cue work continue through the grid plan                | `megadj audit --json`; [FullTags roadmap](fulltags-roadmap.md)              |
| MegaSet   | ✅ SHIPPED v0 / 🧭 ACTIVE v1    | Deterministic propose-only mix builder, whole-library pool, CLI/HTTP/MCP/web surfaces, M3U8 export, and DB/XML-twinned rekordbox playlist write-off                   | Re-ranked improvements include small-pool search, diversity, richer arcs, alternatives, and phrase-aware handoffs   | [PRD](megaset/01-prd.md), [benchmarks](megaset/04-sequencing-benchmarks.md) |
| CrateDeck | ✅ SHIPPED v0.1                 | Drive registry/ghosts, scans, verify and preflight, fleet coverage, checksums, job orchestration, local web UI, deckctl, and MCP                                      | Four manual hardware checks and the release tag remain; differential mirror and assisted legacy export stay planned | `deckctl status --json`; [Acceptance](cratedeck/acceptance.md)              |

Exact interface counts are deliberately absent here. They are derived from
source and pinned in [Surface parity](surface-parity.md) §1.

## Storage and safety state

- The shelf is the archive master. `megadj shelf-archive` is additive,
  junk-filtered, hash-verified, and preserves divergent same-name recordings.
- The playing USB is user-managed. Agents and automated flows do not sync,
  export, or write playlist/database state to it.
- rekordbox must be closed before any `master.db` mutation. Every mutation
  takes a dated backup and verifies the complete affected surface by re-read.
- The shelf's `PIONEER/rekordbox/` tree may correctly be empty; shelf health
  and gig-stick health use different checks from one role-aware matrix.
- Hygiene, duplicate, and unreferenced-file decisions quarantine for review;
  they do not delete archive bytes.

Operational evidence belongs in `archive.db`, CrateDeck state, command JSON,
and the intentionally gitignored local `docs/usb-sync-log.md`. Durable failure
mechanics belong in the [Agent playbook](agent-playbook.md), not repeated here.

## Next outcomes

The order below summarizes outcomes, not issue status. GitHub issues are the
execution tracker and [Ideas](ideas.md) owns backlog rationale.

1. Complete the hardware-gated safety work: evacuate the failing Extra volume
   and establish the first verified cold backup using the committed runbooks.
2. Run the rekordbox write-path spike and record its four observations before
   any automated grid-repair route is selected.
3. Finish the gold annotations that unlock calibrated grid, structure, and cue
   gates; keep all unpassed writers blocked.
4. Exercise CrateDeck's remaining acceptance checks on real gig hardware and
   create the release tag only after those checks pass.
5. Advance MegaSet v1 from measured evidence: small-pool search first, then
   diversity/arc controls and phrase-aware handoffs.

## Canonical evidence

- [Features and projects](FEATURES.md) — durable product responsibilities.
- [Surface parity](surface-parity.md) — exact current interface census and
  exemptions.
- [Data stores and schemas](data-model.md) — database roles and executable
  schema owners.
- [FullTags roadmap](fulltags-roadmap.md) and
  [grid/cue plan](grid-audit-plan.md) — analysis gates and remaining stages.
- [MegaSet documentation](megaset/01-prd.md) — PRD, architecture, comparator
  research, benchmarks, genre policy, and embedding evidence.
- [CrateDeck acceptance](cratedeck/acceptance.md) — completed and manual
  acceptance checks.
- [Hardware runbooks](runbooks/) — executable procedures for blocked physical
  work.
