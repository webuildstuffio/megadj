# MegaSet — PRD

v1 · 2026-09-13 · graduated to its own doc set (Sep 14) · **PRD** → [Architecture](02-architecture.md) (variable inventory) · [Analysis](03-competitive-analysis.md) (30 comparators) · [Benchmarks](04-sequencing-benchmarks.md) · [Genre audit](../fulltags/genre-audit.md) · [Audit & plan](08-audit-and-plan.md)

> First read of the doc set? Start here, then [10-findings](10-findings.md)
> (distilled verdicts + the glossary for every acronym: Camelot, LOO, beam,
> effnet, MCP, …).

**Status:** ✅ SHIPPED — v0 graduated propose-only on 2026-09-12; greedy
Camelot/energy-arc engine, whole-library pool, CLI + HTTP +
M3U8 export + MCP + web panel, gated `megadj rb-playlist` write-off. v1 plan = the
[re-ranked roadmap](03-competitive-analysis.md#part-5--prioritized-roadmap-re-ranked-across-all-30)
(plan of record); the [audit's Part 3](08-audit-and-plan.md) keeps the
per-item sketches, delta-pinned to the measured verdicts. (An earlier plan
to rename every identifier `setbuild → megaset` was superseded 2026-09-15:
the product is **Set**, and the verb `megadj setbuild` stays — see
[09-migration-plan.md](09-migration-plan.md)'s superseded header.)

Set (roadmap §M66) is the set-building product:
it turns megadj's measured library data — beats-ledger BPM, mood-ledger
valence/arousal/dance, file TKEY, effnet embeddings, 8-bar phrase cues —
into an ordered mix proposal you can trust on a booth. **It proposes; it
never plays and never writes without the rb-playlist gates.**

---

## The problem, honestly

A DJ prepping a set from a 3,600-track archive has three bad options:

1. Hand-build the order in rekordbox, checking keys and BPM by ear — an
   hour of squinting per set.
2. Trust an all-in-one "AI DJ" SaaS that scores from Spotify metadata and
   knows nothing about the actual files.
3. Run a random playlist shuffler and hope the wheels don't clash.

The library is already _measured_ — FullTags analyzed every track for BPM,
mood, key, and phrase structure. What was missing is the brain that turns
those measurements into an order, with every decision inspectable and
nothing written behind the DJ's back.

## Vision

> Describe the set you need — `megadj setbuild --preset warmup --minutes 45`
> — and get an honest, deterministic, key-compatible chain with a visible
> energy arc, a quality score you can compare across alternatives, and a
> one-gate path into rekordbox. The DJ keeps every creative decision; the
> tedium is gone.

## Who it's for

One working DJ (megadj §1) preparing warm-ups, peak sets, and after-hours
closures from their own measured archive — in a terminal, on the web panel,
or through an agent speaking MCP.

## Personality & feel

Propose-only co-pilot: **it drafts, you decide**. Honest counters everywhere
(`pool`, `missing_files`, `key_reads`, freshness ages) — a proposal explains
itself. Terse confident copy, no black boxes, no silent fallbacks. The
rekordbox write path stays behind its dry-run-first gate, always.

## Kill criteria

If after two real prep cycles the proposals still need track-by-track
hand-fixing to be usable, demote Set to a compatibility browser (the
crate hover-cards already glow mixing keys) and stop investing in ordering.

---

## F1 — Candidate pool with honest census (shipped v0)

The whole downloaded census by default — no silent `LIMIT 300` cap. Rows
with dead local paths resolve against the shelf (`existingCandidatePath`
rebasing); physical-file aliases collapse via NFC+casefold keys; every
rejection is counted (`source_total` → `pool` → `missing_files` /
`duplicate_files` / `relocated_files`) and freshness (beats/mood ledger
ages) is surfaced so stale pools are visible. Metadata fallback when the
shelf is asleep = Phase A (audit B1).

## F2 — The engine (shipped v0)

Greedy next-slot selection over `0.45·tempo + 0.3·key + 0.25·energy-fit`
with hard gates (±6% tempo window, Camelot clash = 0), a tempo-neighborhood
opener guard (≥15 tracks within ±6%), deterministic (score, videoId)
tie-breaks, whole-track budget fill, and a complete `excluded[]` audit
(capped preview, full count). Energy arcs come from the shared preset
registry (warmup / peak / afterhours) derived by all three surfaces from
one table. Phase A/B fixes: tempo-drift anchor (B2), arc segment control
(B3), fit-axis upgrade — percentile-normalized aggressive/happy replacing
the demoted valence plan (B4, see benchmarks §5.1), half/double-time BPM
(B8).

## F3 — Camelot SSOT (shipped v0)

One wheel, one parser (`shared/camelot.ts`): Camelot notation, open-key
names, Open-Key `7m/6d` mode-suffixed spellings; all 24 canonical keys
pinned by tests after the first copy shipped with 8 silent errors.
Compat table: same/±1 same-letter = 1.0, diagonal = 0.9, mood-lift
(rel maj/min) = 1.0, else 0. Unparsable → neutral 0.5, never a block.

## F4 — Surfaces, one engine (shipped v0)

CLI (`megadj setbuild`; Set verb), HTTP (`GET /api/archive/setbuild`, `?format=m3u8`
export), MCP (`archive_set_build`, propose-only declared in its
description), and the FullTags web panel (segmented presets, arc sparkline,
mix pills, filterable table, excluded cross-check, freshness line). One
`parseSetbuildQuery` validates preset/minutes everywhere; unknown preset is
an error, never a silent peak fallback. Parity pinned in
[surface parity](../surface-parity.md) (rev 20–23).

## F5 — The write-off: `megadj rb-playlist` (shipped v0)

Turns a proposal into a rekordbox playlist by linking existing master-DB
content rows — dry-run first (predicts the link count, writes nothing).
`--apply --yes` requires rekordbox quit, backs up `master.db` and
`masterPlaylists6.xml`, writes the playlist's DB and XML twins through one
compensating seam, then verifies both surfaces. A failed XML mutation restores
both backups instead of leaving a DB-only playlist. Set itself
never writes anything.

## F6 — Quality, alternatives & landmarks (v1, Phase C)

2-opt lookahead repair over the greedy chain; `--track <id>` landmarks
(sequenced at their arc-right position, rest built around them);
`--candidates N` builds N deterministic alternatives with per-set quality
scores (mean transition + arc adherence + diversity + budget fit) so the
DJ picks between good options instead of debugging one.

## F7 — The handoff layer (v1+, Phase D — the differentiator)

3,605 tracks × ~17–20 8-bar phrase cues and full downbeat grids already
sit in the ledgers, unused by sequencing. Set v1 plans the _handoff_:
per-step `mixOutCue`/`mixInCue` at 8-bar boundaries, carried into M3U8
comments and rb-playlist dry-run explain rows — turning an ordered list
into an executable transition plan. Nothing in the 10-project comparison
set has both this phrase data and a gated rekordbox write path. Measured
readiness (benchmarks Part 4.2): mixout p50 = 14.5 s, zero new analysis.

**Booth visibility (XDJ-XZ):** hardware waveforms show memory-cue marks
_with rekordbox-set colors_ but no text (XDJ-AZ/CDJ-3000 add phrase
display). The convention: memory-cue colors from our rb-cues seam —
red = vocal section, blue = instrumental/drop, green = breakdown; hot
cues A–H stay reserved for performance points. Details:
[genre-audit §6](../fulltags/genre-audit.md).

---

## Non-goals

- No playback/automix execution — propose-only stands (PRINCIPLES §2/§8).
- No solver dependencies (OR-Tools/Held-Karp) — greedy + 2-opt is enough
  at this scale and keeps the pure-TS zero-native-deps engine.
- No LLM in the scoring path — natural language enters through the agent
  surface (MCP), which is our NL front end by construction.
- No cloud metadata scoring — every number in a proposal is measured from
  the archive's own files and ledgers.

## Vibe

> "The opener sells the night. Set just makes sure you never open with
> a 73-BPM track in a 128 room."
