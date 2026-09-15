# megadj documentation

**Status:** ✅ CURRENT — canonical navigation and documentation ownership map.

This index lists every maintained document under `docs/`. Start with the
[current product state](product-state-2026-09-07.md), then follow the owning
document for the topic you are changing.

## Ownership and status

- `AGENTS.md` owns agent rules and safety invariants.
- [Product principles](PRINCIPLES.md) own product decisions.
- [Product state](product-state-2026-09-07.md) owns the qualitative shipped,
  active, and blocked summary. Its dated filename is retained for stable
  inbound links; the status header carries the actual as-of date.
- [Features](FEATURES.md) owns the durable product map; [Ideas](ideas.md) owns
  backlog rationale; GitHub issues own executable work and priority.
- [Surface parity](surface-parity.md) owns exact CLI, HTTP, MCP, and UI census
  numbers. Other docs link there instead of copying them.
- [Data stores and schemas](getdat/data-model.md) owns schema navigation. Executable
  schema definitions remain in their code producers.
- [Agent playbook](agent-playbook.md) owns durable failure mechanics. The local
  `docs/usb-sync-log.md` is append-only operator evidence and is intentionally
  gitignored; it is not a repository link or a second status store.

Status vocabulary: ✅ `CURRENT`/`COMPLETE`/`SHIPPED`, 📚 `REFERENCE`, 🧭
`ACTIVE`, 🟡 `BLOCKED`, and 🗄️ `ARCHIVED`.

## Product and decision references

- [Product state](product-state-2026-09-07.md) — current product-level status
  and the next safe outcomes.
- [Features and projects](FEATURES.md) — GetDat, FullTags, MegaSet, and
  CrateDeck responsibilities.
- [Product principles](PRINCIPLES.md) — decision authority and non-goals.
- [Ideas and future backlog](ideas.md) — rationale and parked possibilities;
  issue state lives on GitHub.
- [Data stores and schemas](getdat/data-model.md) — database roles, schema producers,
  and migration ownership.
- [Surface parity](surface-parity.md) — live interface contract and exemptions.
- [Agent playbook](agent-playbook.md) — failure history and reusable lessons.

## Product documentation

### GetDat

- [Data stores and schemas](getdat/data-model.md) — schema roles, ownership, and
  producer boundaries.
- [Playing USB boundary](getdat/usb-sync.md) — SHELF1-to-USB handoff rules and
  user-managed export limits.
- [Shelf hygiene snapshot](getdat/shelf-hygiene-2026-09-09.md) — Sep 9–10
  detect/restore limits and current operator receipts.

### FullTags and analysis

- [FullTags roadmap](fulltags/fulltags-roadmap.md) — gate outcomes and analysis roadmap.
- [Genre audit](fulltags/genre-audit.md) — inclusion and source-precedence
  policy; v3 statistical revalidation (CIs, McNemar, duration guards).
  MegaSet consumes it family-level only.
- [Embedding model benchmark](fulltags/embedding-models.md) — tower
  evaluation and decision; v2 rerun (effnet confirmed on both metrics),
  fusion sweep settled (+1.1 pt — not adopted). Feeds MegaSet's similarity
  prior (B10p).
- [Genre taxonomy sources](fulltags/genre-taxonomy-sources.md) — external
  authorities and the family map.
- [Embedding research review (Sep 14)](fulltags/embedding-research-2026-09-14.md)
  — external deep-read: tower landscape, probe/readout ladder, compute +
  licence audit, adoption verdicts.
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
- [Sequencing benchmarks](megaset/04-sequencing-benchmarks.md) — algorithm and
  benchmark evidence.
- [**Consolidated findings & next steps**](megaset/10-findings.md) — every
  measured verdict across the doc set, critical-bug list, prioritized next
  3–5 actions.
- [Migration plan](megaset/09-migration-plan.md) — setbuild → megaset
  identifier rename (planned, atomic).
- [Audit and plan](megaset/08-audit-and-plan.md) — per-item
  implementation sketches, delta-pinned against the re-ranked roadmap;
  current conclusions link to the owners above.

### CrateDeck

- [PRD](cratedeck/02-prd.md) — product requirements.
- [Architecture](cratedeck/03-architecture.md) — current runtime structure.
- [Acceptance](cratedeck/acceptance.md) — verified code gates and remaining
  hardware checks.

## Operations and incident references

- [Playing USB boundary](getdat/usb-sync.md) — SHELF1 preparation, user-owned export,
  and read-only verification.
- [Intake and cue postmortem](fulltags/intake-cue-postmortem.md) — executed incident
  analysis and remaining follow-up.
- [Shelf hygiene snapshot](getdat/shelf-hygiene-2026-09-09.md) — Sep 9–10 record
  with current detector and restore-surface limits.
- [Source-layout refactor](archive/src-layout-refactor.md) — completed proposal
  and migration receipt, archived 2026-09-14; historical paths in the proposal
  are labeled as such.

### Hardware-gated runbooks

- [0a — evacuate Extra](runbooks/0a-evacuate-extra.md) — blocked until the
  volume mounts.
- [0b — cold backup](runbooks/0b-cold-backup.md) — blocked on the cloud target.
- [0c — BACKUP2 verdict](runbooks/0c-orphan-verdict.md) — completed decision;
  procedure retained for evidence.
- [0d — rekordbox write-path spike](runbooks/0d-write-path-spike.md) — harness
  shipped; hardware observations remain.

## Package entry points

- [`README.md`](../README.md) — repository overview and setup.
- [`cratedeck/README.md`](../cratedeck/README.md) and
  [`deckctl.md`](../cratedeck/deckctl.md) — CrateDeck operator entry points.
- [`fulltags/README.md`](../fulltags/README.md) — FullTags package reference.
- [`plugin/README.md`](../plugin/README.md) — plugin packaging and symlinked
  skill ownership.
- CrateDeck UI implementation notes:
  [`web/ui/DESIGN-NOTES.md`](../cratedeck/web/ui/DESIGN-NOTES.md) and
  [`web/products/fulltags/DESIGN-NOTES.md`](../cratedeck/web/products/fulltags/DESIGN-NOTES.md).

## Archive

Archived files are historical evidence, not current instructions:

- [Executed roadmap proposal](archive/roadmap-proposal.md)
- [Codebase quality snapshot](archive/codebase-quality-report.md)
- [Source-layout refactor receipt](archive/src-layout-refactor.md) — moved
  2026-09-14; a one-line redirect stub remains at the old path.
