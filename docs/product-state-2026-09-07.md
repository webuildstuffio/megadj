# megadj — Current Product State

**Status:** ✅ CURRENT — qualitative product state as of 2026-09-15. The dated
filename is retained for stable inbound links; live library counts come from
commands and database ledgers, never this document.

megadj is a four-product pipeline on one Mac for Pioneer hardware:

```text
GetDat ──▶ FullTags ──▶ Set ──▶ CrateDeck ──▶ the booth
archive     enrich       propose      stage and     play
music       and audit    the mix      verify
```

The shelf is the archive master beneath the whole flow. The rekordbox
collection database lives on the configured shelf, while `archive.db` remains
the pipeline ledger. See [Data stores and schema ownership](getdat/data-model.md).

## State by product

| Product   | State                           | Shipped                                                                                                                                                               | Active or blocked outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Live truth                                                                                        |
| --------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| GetDat    | ✅ SHIPPED                      | YouTube Music sync, URL/folder drop, scored ingest, container-truth repair, dedupe/quarantine, quality upgrades, and archive-to-shelf sync                            | Additional download sources remain backlog items; AI genre fallback remains opt-in                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `megadj status --json`, `megadj audit --json`                                                     |
| FullTags  | ✅ SHIPPED / 🧭 ACTIVE ANALYSIS | One schema, verified format-specific atomic writers, source-first metadata/artwork, Beatport identity fields, fingerprints, key/mood/energy analysis, and gated audit | BPM tag writes remain blocked; structure, vocal-density, and cue work continue through the grid plan. **Sep 15: Tier-0 diagnostics ran live, the `edm` umbrella refold SHIPPED — LOO gated 61.7% → 69.2% (+7.4), ≥65% target PASS — the demote-and-flag pass flagged 96/2982 disputed labels (excluded from seeding), and the fetch ladder gained its third catalog vote: the Bandcamp arm (hard-artist-gated page fetch voting genre/year/label/art) on the shared name-matching SSOT — [verdicts](fulltags/tier0-diagnostics-2026-09-15.md), [refold](fulltags/genre-audit.md), [pipeline](fulltags/genre-pipeline.md)** | `megadj audit --json`; [FullTags roadmap](fulltags/fulltags-roadmap.md)                           |
| Set       | ✅ SHIPPED v0 / 🧭 ACTIVE v1    | Deterministic propose-only mix builder, whole-library pool, CLI/HTTP/MCP/web surfaces, M3U8 export, and DB/XML-twinned rekordbox playlist write-off                   | Re-ranked improvements include small-pool search, diversity, richer arcs, alternatives, and phrase-aware handoffs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | [PRD](set/01-prd.md), [benchmarks (archived)](archive/set-04-sequencing-benchmarks-2026-09-14.md) |
| CrateDeck | ✅ SHIPPED v0.1                 | Drive registry/ghosts, scans, verify and preflight, fleet coverage, checksums, job orchestration, local web UI, deckctl, and MCP                                      | Three manual hardware checks remain; the release policy closed with the `v0.2.0` tag (Sep 15); differential mirror (#117) and assisted legacy export (#19) stay planned                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `deckctl status --json`; [Acceptance](cratedeck/acceptance.md)                                    |

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

1. Complete the hardware-gated safety work: evacuate the failing Extra volume
   and establish the first verified cold backup using the committed runbooks.
2. Run the rekordbox write-path spike and record its four observations before
   any automated grid-repair route is selected.
3. Finish the gold annotations that unlock calibrated grid, structure, and cue
   gates; keep all unpassed writers blocked.
4. Exercise CrateDeck's remaining acceptance checks on real gig hardware
   (the release policy closed with the `v0.2.0` tag, Sep 15).
5. Advance Set v1 from measured evidence: small-pool search first, then
   diversity/arc controls and phrase-aware handoffs.

## Canonical evidence

- [Features and projects](FEATURES.md) — durable product responsibilities.
- [Surface parity](surface-parity.md) — exact current interface census and
  exemptions.
- [Data stores and schemas](getdat/data-model.md) — database roles and executable
  schema owners.
- [FullTags roadmap](fulltags/fulltags-roadmap.md) and
  [grid/cue plan](fulltags/grid-audit-plan.md) — analysis gates and remaining stages.
- [Set documentation](set/01-prd.md) — PRD, architecture, comparator
  research, benchmarks, genre policy, and embedding evidence.
- [CrateDeck acceptance](cratedeck/acceptance.md) — completed and manual
  acceptance checks.
- [Hardware runbooks](runbooks/) — executable procedures for blocked physical
  work.
