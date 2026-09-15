# FullTags — Genre Pipeline Architecture (Sep 15, 2026)

**Status:** 📚 REFERENCE — how the genre system processes a track, end to
end. Every stage below ships and runs on the live archive.

Reading order by question:
- *"What happens to a track's genre, step by step?"* → §2 flow + §3 invariants.
- *"Why is it built this way?"* → §7 design rationale.
- *"What's still broken / missing?"* → §4 known residue (issue-linked).
- *"What are the current numbers?"* → §5 live state.
- *"Where is the code?"* → §6 module map.

**Consumers** → [genre-audit](genre-audit.md) (policy + numbers) ·
[genre-taxonomy-sources](genre-taxonomy-sources.md) (authorities + family
map) · [tier0-diagnostics-2026-09-15](tier0-diagnostics-2026-09-15.md)
(measured verdicts) · [MegaSet PRD](../megaset/01-prd.md) (downstream).

---

## 1. The one-paragraph version

A track's genre enters the archive DB at download time from real sources
(SoundCloud search → Beatport → AI strictly opt-in), is canonicalized at
enrichment, never clobbered by inference (only EMPTY columns are
predicted), scored through a 9-family map with umbrella arbitration,
hygiened by two idempotent passes (refold = rewrite canonicalization,
flag = metadata-only dispute marking), and verified by a leave-one-out
harness with a hard ≥65% ship gate. The file tag is OUTPUT-only — the DB
row is the SSOT, and the DB never claims a genre the file doesn't carry.

## 2. Flow

The pipeline is nine stages. Write points (W) put labels IN; the
analysis stage (A) produces the vectors; hygiene passes (H) keep the
column canonical and honest; inference (I) fills gaps; the scoring read
path (R) is what every consumer runs; verification (V) is the standing
gate; transparency surfaces (T) let a human see what any track claims.

```
 yt-dlp download (getdat sync)
   │  meta.genre from search metadata — trusted ONLY as far as the
   │  junk gates below; numeric SC IDs and "Music" refused at write
   ▼
 [W1] markDownloaded + updateGenre ────────────► tracks.genre (SSOT)
   │
   ▼
 megadj fetch  (tools/fetch-all → fetch-stages)
   │  ladder, first-win-writes, per track:
   │  [W2] SC search hit → junk gate (numeric/"Music") → canonGenre
   │        (SC_GENRE_CANON + title-case) → setFileTags FIRST,
   │        DB row only on tag success (ground truth)
   │  [W3] else Beatport store genre → same tag-first discipline
   │  [W4] else AI classifier (OPT-IN, off by default, conf ≥ 0.7,
   │        closed DJ_GENRES vocabulary) — a missing genre stays an
   │        honest gap, never a guess
   ▼
 megadj mood  (fulltags analyzeMoods)
   │  essentia ONNX via uv python worker:
   │  [A1] mood heads (dance/aggressive/happy/electronic/party/
   │        valence/arousal) → mood table
   │  [A2] effnet 1280-d mean embedding (same probe run, no extra
   │        model cost) → embeddings ledger (upsert by video_id)
   ▼
 hygiene passes (idempotent, dry-first, each reassesses everything)
   │  [H1] megadj genre --refold  — REWRITE pass on the LABELED
   │        population (no embeddings needed): escape repair,
   │        multi-label split (specific outranks umbrella), casing
   │        collapse, junk refusal (URL/word-soup/insane/family-less
   │        → proposes NOTHING rather than a fake label)
   │  [H2] megadj genre --flag    — METADATA pass on the EMBEDDED
   │        population: LOO harness; label vs UNANIMOUS kNN consensus
   │        mismatch → genre_flag='disputed' (never rewritten),
   │        cleared when no longer disputed (self-healing)
   ▼
 inference (megadj genre, no --eval)
   │  [I1] seeds = embedded + labeled + NOT disputed
   │  [I2] queries = embedded + EMPTY genre only (COALESCE discipline:
   │        inference never clobbers a source label)
   │  [I3] inferGenre: cosine kNN (k=5), gate minAgreement 0.6,
   │        family-majority vote → --apply writes family label
   ▼
 scoring read path (every consumer, every surface)
   │  [R1] normalizeGenre: paren-stripping; music/unknown/fixme → null
   │  [R2] genreFamily: 9 families (house/edm/techno/pop/bass/hiphop/
   │        groove/trance/mood) — the SSOT map in archive/similar.ts
   │  [R3] scoringFamily (refold): plain EDM/Dance/Electronic/Mainstage
   │        EDM ABSTAIN from scoring (parents, not genres); sub-genres
   │        and hard-EDM keep scoring
   ▼
 verification (megadj genre --eval …)
   │  [V1] leave-one-out over the duration-guarded population (90–480 s)
   │  [V2] SHIP GATE: gated agreement ≥65% (judges the refold arm when
   │        armed; exit 1 below target — scripts fail loudly)
   │  [V3] --diagnostics: label-error clustering, artist-overlap,
   │        hubness histogram, confusion matrix + top-2
   │  [V4] --artist-disjoint LOO · --probe (linear probe, informational:
   │        lost to kNN twice) · --refold A/B block
   ▼
 surfaces (one engine, three faces)
   CLI megadj genre · MCP archive_* tools · web (MegaSet genre columns,
   SimilarTab family coherence) — census strings test-pinned.
 ▼
 transparency surfaces (the tag census / compare, Sep 15)
   [T1] tag census: ONE SQL join per page — archive mirror (genre/key/
        beats-BPM/genre_flag) vs rb-adopt mirror (metadata_json), all
        playable tracks, worst-first sort, per-field disagreement
        counts. Files are NOT read here (3.5k ffprobe reads would be
        the cost of a page view).
   [T2] tag compare (one track, on demand): the file's OWN tags read
        LIVE (ground truth — one ffprobe+mutagen read is the honest
        price when you inspect a single track) beside both mirrors +
        the pipeline ledger (genre_flag, valence/arousal). Differences
        listed per field.
```

## 3. Invariants (the traps this architecture exists to avoid)

| # | Invariant | Enforced at |
| - | --------- | ----------- |
| 1 | Numeric SC genre IDs and the `Music` placeholder are never written | `applyScGenre` junk gate (W2) |
| 2 | Tag write FIRST, DB row only on success — the DB never claims a genre the file doesn't carry | W2/W3 |
| 3 | File TCON is output-only cache of the DB, never upstream (round-trip pollution measured) | readers (R1–R3) |
| 4 | Inference fills EMPTY columns only; a source label is never clobbered | `updateGenre` COALESCE (I2) |
| 5 | AI genre fallback is opt-in and OFF by default | W4 (`aiFallback`) |
| 6 | Umbrella labels (plain EDM/Dance/Electronic) abstain from scoring but keep displaying | `scoringFamily` (R3) |
| 7 | Disputed labels are flagged, never rewritten; excluded from seeding only | H2 + `genreSeeds` |
| 8 | Refold proposes nothing rather than inventing a junk label | H1 guards |
| 9 | Every hygiene pass is idempotent (re-run → zero changes) and dry by default | H1/H2 |
| 10 | The eval gate judges the CURRENT policy readout (refold arm when armed), exit 1 below target | V2 |
| 11 | BPM never enters the comment (own RB column); comment = `Key · Energy · Mood` | booth-text |

## 4. Known residue (honest gaps, tracked)

- **154 `Music` placeholder rows** (pre-guard legacy): visible to
  neither seeds (family null) nor inference queries (`genre != ''`) —
  stranded, tracked as issue #61.
- **~6.6% of labels unmapped** by the 9-family map → mood/abstain; the
  LLM residue pass (one-shot, vocabulary-constrained) is queued for the
  long tail (#65).
- **`edm` 299 rows** display as-is (hard-EDM mixed with umbrella
  use); scoring abstains via R3 — the display split waits for
  cluster-proposed labels (§5b.3.5, #62).
- **241 distinct raw labels** vs the 105-label 90%-coverage target —
  the refold killed case-twins; alias depth is the remaining gap.
- **96 disputed rows** await a human-review path (#64): the flags are
  doing their seeding job today, but `--disputed` listing + agree/keep
  verbs are what closes the loop.

## 5. Live state (measured 2026-09-15, `~/.local/state/megadj/archive.db`)

| Metric | Value |
| ------ | ----- |
| Downloaded tracks | 3,664 |
| Labeled (genre non-empty) | 3,458 (94.4%) |
| Embedded (effnet 1280-d) | 3,618 (98.8%) |
| Disputed flags | 96 (3.2% of assessed) |
| Distinct raw labels | 241 |
| Top labels | House 833 · Techno 337 · EDM 299 · Tech House 221 · Dance 156 · Music 154 · Pop 131 |
| LOO baseline / arbitration | 61.7% / **69.2%** (ship gate ≥65% PASS) |
| top-2 accuracy | 77.4% |

## 6. Where everything lives

| Concern | File |
| ------- | ---- |
| Family map + kNN vote + LOO harness + embeddings ledger | `src/archive/similar.ts` |
| Seeding exclusion + flag setter + labeled population | `src/archive/state_tracks.ts` |
| Refold engine (canonicalization + arbitration) | `src/fulltags/genre-refold.ts` |
| Dispute classifier | `src/fulltags/genre-flag.ts` |
| Tier-0 diagnostics engine | `src/fulltags/genre-diagnostics.ts` |
| Linear probe (informational readout) | `src/fulltags/linear-probe.ts` |
| CLI wiring (`--eval/--refold/--flag/--diagnostics/…`) | `src/fulltags/genre.ts` |
| Intake junk gate + canonGenre ladder | `tools/fetch-stages.ts` + `fulltags/src/schema.ts` |
| Embedding producer (effnet via ONNX worker) | `fulltags/src/models.ts` (`analyzeMoods`) |
| File ground-truth reader (TCON/TKEY/TBPM/… + art) | `fulltags/src/readers.ts` (`groundTruth`) |
| Tag census + three-source compare (T1/T2) | `cratedeck/src/archive_tagcensus.ts` |
| Wire types (census/compare payloads) | `cratedeck/shared/archive-wire.ts` |
| Closed AI vocabulary | `DJ_GENRES` in `fulltags/src/schema.ts` |

## 7. Design rationale — why the seams are where they are

- **Why file reads live only on the per-track compare (T2), not the
  census (T1):** the file is ground truth, but a census page over 3.5k
  tracks would pay a ffprobe+mutagen spawn per row — seconds of I/O
  for a table the user scans. The census compares the two mirrors
  (cheap SQL); the compare endpoint pays the read for exactly one
  track you're inspecting. Honesty where it's cheap, truth where it's
  asked for.
- **Why the flag pass never rewrites:** a rewritten label destroys the
  evidence of why it was flagged. The flag does the harm-reduction
  work (seeding exclusion) with zero information loss; the rewrite
  stays a human act (#64 adds the verbs).
- **Why umbrella abstention lives in a scoring wrapper (`scoringFamily`)
  instead of editing `genreFamily`:** display and scoring are different
  questions. The map stays one SSOT; the arbitration is a policy layer
  you can A/B (`--eval --refold`) — and revert — without touching the
  family table.
- **Why inference fills only empty columns:** a genre from SC/Beatport
  is a *source claim* with provenance; a kNN family is a *statistical
  guess*. COALESCE at the write seam (plus the queries-side filter)
  means the two can never overwrite each other, and re-running
  inference is always safe.
