# MegaSet — Architecture

v1 · 2026-09-14 · **Architecture** → [PRD](01-prd.md) · [Analysis](03-competitive-analysis.md)

MegaSet has no runtime of its own: it is a pure scoring engine plus three
thin surfaces and one gated writer, all reading ledgers that FullTags
already maintains.

## The shape

```
                     ledgers (FullTags owns)
   archive.db ── beats · mood · cues · embeddings · track_keys
   rekordbox mirror (master.db read-only seam) ── BPM×100 · KeyName
        │
        ▼
   setCandidates() ── pool census w/ honest counters (cratedeck/src/archive_similar.ts)
        │
        ▼
   buildSet() ── pure engine, zero I/O (cratedeck/src/setbuild.ts)
        │          score = 0.45·tempo + 0.3·key + 0.25·energy-fit
        │          hard gates: ±6% tempo, Camelot clash, opener neighborhood
        ▼
   SetBuildPayload ── steps[] · excluded[] · pool/freshness counters
        │
        ├─▶ CLI        megadj setbuild (src/fulltags/setbuild.ts)
        ├─▶ HTTP       GET /api/archive/setbuild · ?format=m3u8 (archive_routes.ts)
        ├─▶ MCP        archive_set_build (cratedeck/src/archive_tools.ts)
        ├─▶ Web        FullTags ⌗ Similar panel (cratedeck/web/products/fulltags/SimilarTab.tsx)
        └─▶ rb-playlist  megadj rb-playlist (src/rekordbox/rb-playlist.ts)
                         dry-run first · --apply --yes · rekordbox-quit gate
                         · dated backup · whole-table verify · delayed re-read
```

## The invariants

1. **The engine is pure.** `buildSet()` takes candidates in, returns a chain
   out — no file I/O, no clock, no randomness. Determinism (same inputs →
   byte-identical chain) is pinned by tests; tie-breaks are (score, videoId).
   This is what makes N-candidate compare and regression tests trustworthy.
2. **One wire SSOT.** `cratedeck/shared/setbuild.ts` owns presets, pool
   clamps, and the excluded-preview cap; `shared/camelot.ts` owns the wheel.
   CLI, HTTP, MCP, and web all derive — no hand-copied twins (AGENTS rule).
3. **Propose-only.** Nothing in the engine or any surface writes a playlist.
   The only writer is `rb-playlist`, behind the full master-DB gate stack
   (rekordbox closed, dated backup, verify, delayed re-read).
4. **Honest payloads.** Every rejection is counted and classified
   (`missing_files`, `duplicate_files`, `relocated_files`, `excluded_total`);
   pool size and ledger freshness travel with every response. A proposal
   explains itself or it doesn't ship.
5. **Metadata fallback is visible, never silent.** When the shelf is asleep
   (B1 fix), mirror-sourced candidates are flagged `metadata_only` and the
   payload says so — the engine never pretends files it can't hear are there.

## Data ownership

| Data | Owner | MegaSet role |
|---|---|---|
| BPM, energy/arousal/dance/valence | FullTags beats + mood ledgers | scoring inputs |
| Musical key | `track_keys` cache → TKEY; RB mirror fallback | hard gate |
| Genre (normalized, family-mapped) | `tracks.genre` + `genreFamily()` SSOT | diversity guard (Phase B) |
| 8-bar phrase cues + downbeats | FullTags cues ledger | handoff layer (Phase D) |
| Embeddings (effnet 1280-d) | embeddings ledger | similarity prior (Phase B) |
| LUFS | not yet stored | `megadj loudness` pass (Phase B, optional) |
| Collection rows (DjmdContent) | SHELF1 master.db via Python seam | mirror fallback + rb-playlist write-off |

MegaSet adds exactly one store of its own: nothing. All persistence stays in
ledgers owned by their existing products.
