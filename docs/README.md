# megadj documentation

**Status:** ✅ CURRENT — navigation index for repository documentation.

Start here:

- [Product state](product-state-2026-09-07.md) — current shipped state and queue.
- [Features](FEATURES.md) — product-level map.
- [Principles](PRINCIPLES.md) — decision authority.
- [Agent playbook](agent-playbook.md) — detailed failure history behind `AGENTS.md`.
- [Ideas](ideas.md) — ordered backlog; open work is tracked as GitHub issues.

Ownership rules:

- `AGENTS.md` owns agent rules and invariants; this index owns navigation.
- `PRINCIPLES.md` owns product decisions; product state owns current status
  and metrics; GitHub issues own executable work.
- `agent-playbook.md` owns durable failure mechanics; `usb-sync-log.md` is
  append-only evidence. Do not copy either into other docs.
- Avoid volatile file trees, machine-local paths, and session-only counts in
  durable docs. Link to a command, test, DB ledger, or current-state entry.

Operational references:

- [USB pipeline](usb-sync.md) and [USB sync log](usb-sync-log.md)
- [Shelf hygiene snapshot](shelf-hygiene-2026-09-09.md)
- [Runbooks](runbooks/)
- [Rekordbox WAV artwork](rekordbox-wav-artwork.md)

Product references:

- [FullTags roadmap](fulltags-roadmap.md)
- [Grid audit plan](grid-audit-plan.md)
- [CrateDeck acceptance](cratedeck/acceptance.md)
- [CrateDeck PRD](cratedeck/02-prd.md)
- [CrateDeck architecture](cratedeck/03-architecture.md)
- [Surface parity](surface-parity.md)
- [Source-layout refactor](src-layout-refactor.md)

Project entry points:

- [`cratedeck/README.md`](../cratedeck/README.md)
- [`fulltags/README.md`](../fulltags/README.md)
- [`plugin/README.md`](../plugin/README.md)
- [Archived roadmap proposal](archive/roadmap-proposal.md)
