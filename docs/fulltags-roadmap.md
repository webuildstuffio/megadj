# FullTags — Prioritized Roadmap

*Compiled 2026-09-04 · grounded in a fresh research pass over the 2026
open-source landscape (Essentia ONNX on ARM64, beat_this, libKeyFinder,
chromaprint, demucs-mlx, all-in-one-infer, MuQ/CLAP) plus the shipped
FullTags v0 (schema + writer + pipeline + 49 tests).*

How to read: each item lists **why this rank**, effort (S <1d / M 1–3d /
L >3d), and the gap it closes. Priority = value for a working DJ library of
3–10k tracks on one Mac, offline-first. The ideas.md cap rule applies:
something ships or leaves before something new enters.

---

## P0 — already shipped (the foundation)

- **Schema + writer + readers** — one `FullTag` type, one atomic writer
  (mp3/m4a/wav/flac/aiff), file-first ground truth. The format gotchas
  (AIFF ID3-chunk drop, WAV art, id3v2.3, muxer-by-extension) are fixed
  in exactly one place now.
- **`fulltags` CLI** — enrich any folder/file; `audit --json` completeness
  gate. megadj `ingest`/`fetch` write through the same code path.

## P1 — the highest-value gaps, in order

### 1. Harmonic key detection + Camelot (`key` field) — **S–M, do first**
**Why #1:** best payoff-per-risk in the whole AI layer (ideas.md I51
verdict, re-confirmed by research). The 2026 Dubspot lab test scored
libKeyFinder **76% overall / ~90% on dance music** vs rekordbox's own
~60%; community tests put OpenKeyScan (CNN) at ~79%. Every track gets a
`TKEY` (Initial Key) + `TXXX:CAMELOT` frame — fields CDJs and rekordbox
already display — plus a harmonic-mix panel later in CrateDeck.
**Gap closed:** no key data at all today (rekordbox analysis is the only
source, and it's the weakest detector).
**How:** `keyfinder-cli`/libKeyFinder binding (GPL — fine, local tool) or
OpenKeyScan CLI; Essentia `Key` as free cross-check vote. Write tags via
the existing `writePatch({ key })` (writer already reserves the frame map).
**Verify:** spot-check 20 known-key tracks; require ≥80% agreement before
batch-running the library.

### 2. Real BPM + downbeats via `beat_this` (`bpm` field) — **S**
**Why #2:** the missing half of dance-ability data, and the cheapest SOTA
win available: CPJKU's `beat_this` (ISMIR 2024) is the current open SOTA
beat/downbeat tracker, **MIT-licensed, pip-installable, CPU-friendly**,
with a Rust/ONNX port for a no-Python path. Feed BPM into `TBPM` (hardware
reads it), and downbeats become the anchor for P3's cue work.
**Gap closed:** `bpm` is always null today (rekordbox-only); constant-BPM
synthetic grids are a known on-stage failure mode (ideas.md C19).
**Verify:** compare against rekordbox's re-analyzed grids (the 294 fixed
Sep 2026 are ground truth); flag disagreements >2% for review.

### 3. Acoustic fingerprint ledger (chromaprint) — **S**
**Why #3:** unlocks four existing backlog items at once (ideas.md L62/
D24/D25/L63): cross-format dupe detection (LOWQ/HiQ pairs, name-blind),
`megadj upgrade` swap verification (re-fingerprint the new file, confirm
same recording, *then* delete the old — no more trust-in-URL), untagged
`adopt` identification via the free AcoustID API (alive, 3 rps, non-commercial),
and drive-side content audits. `fpcalc` is one brew dep; store fp in the
archive DB + `TXXX:ACOUSTID`.
**Gap closed:** identity is currently path/name-based; byte-variant rips
and mirror drift are invisible.

### 4. Essentia ONNX heads: genre/mood/danceability/valence — **M**
**Why #4:** research-grade tags replace the LLM genre guess and hand-rolled
energy. MTG's model zoo ships **official ONNX exports** (Discogs-EffNet
400-class genre, the 7 mood classifiers, danceability, DEAM
valence-arousal, MUSE embeddings) that run under plain `onnxruntime` —
**this works on macOS ARM64 today** (pip `essentia` has arm64 wheels for
Python ≤3.13; the TF path is broken on ARM, ONNX sidesteps it entirely —
the architecture the deep-cuts project proves out). Valence-arousal plots
as the CrateDeck "vibe map".
**Gap closed:** genre is SC-tags→LLM (one of 24 buckets, no confidence
history); energy is a single RMS scalar; zero mood data.
**Caveats to record:** Essentia code is AGPL-3.0, models **CC BY-NC-SA
(non-commercial)** — fine for a personal library, re-review before any
commercial release. Effort M is mostly the mel-spectrogram preprocessing
harness + model cache layer.

### 5. MBID provenance everywhere + MusicBrainz genre harvest — **S**
**Why:** already half-built (MBID embedded at ingest). Surface it: every
FullTags write carries MBID; harvest MB `genres+tags` (canonical genres
now exist server-side) as a third genre vote alongside SC + Essentia.
**Gap closed:** "where did this metadata come from" is unanswerable today.

## P2 — the 10x layer (after P1 pays off)

### 6. Structure-aware cues from all-in-one-infer — **M–L, the genuine 10x item**
Functional segmentation (intro/verse/drop/outro) → **auto memory cues at
intro/drop/outro, downbeat-aligned** (downbeats from #2), then
phrase-aware grids later. Slice it: cue placement alone is weekend-scale;
tempo-curve grids are the month-long part (ideas.md I46's honest sizing
stands). Prefer `all-in-one-mlx` on Apple Silicon (demucs-mlx makes
separation seconds/track). MIT. Labels are pop-trained — map
bridge/outro boundaries to "drop" heuristically and verify on EDM before
batch runs. rekordbox interlock rules apply to anything DB-touching.

### 7. Vocal density via demucs stems — **M**
Vocal-presence ratio → `instrumental / light / full` tag — the field DJs
filter by that no tag source provides (ideas.md I48). demucs-mlx: ~3s/track
on M4 Max; stems go to temp and are deleted (analysis-side metric only).

### 8. Embeddings + "sounds like" — **M**
MUSE embeddings (already computed in #4) → kNN similarity in the archive
DB (sqlite-vec or blob + cosine at 3–10k tracks). MuQ-MuLan is the
stronger encoder if needed later (CC-BY-NC weights); CLAP adds
text-query search ("warm melodic techno"). CrateDeck "find tracks like
this".

### 9. Energy 2.0 — **S**
Replace RMS-linear energy with Essentia danceability + DEAM arousal as
co-votes; keep the 1–10 scale for UI stability. One afternoon once #4
lands.

## P3 — the edges (parked, explicit triggers)

| Item | Trigger | Effort |
| ---- | ------- | ------ |
| LLM vibe captions (Qwen2-Audio GGUF pattern) | only as `megadj drop` garnish; never infrastructure (ideas.md I50 verdict) | L |
| Whisper voice-memo → crate (mlx-whisper, 20–30× RT on Metal) | M68, after K59 mining exists | S |
| Set-builder copilot + double-drop detector | M66/M67, needs B11 history harvest first | M |
| Synced lyrics (LRCLIB → USLT) | "only if bored" (J56) | S |
| Hit predictor regression | M64, needs B11 history | M |

## Gaps & risks (the honest list)

1. **License asymmetry** — the best tags (Essentia models CC BY-NC-SA,
   MuQ CC-BY-NC) are non-commercial. Irrelevant for a personal archive;
   a hard wall if FullTags ever ships as a product. Track per-model
   licenses in the model cache manifest from day one.
2. **Verifier scarcity** — key/BPM/structure models are only as good as
   the spot-checks. Budget for labeled ground truth (Mixed In Key output
   on this library is usable reference for key; rekordbox grids for BPM)
   before trusting any batch run. Never batch >50 tracks without a
   sampled diff review.
3. **The AI-genre year trap, generalized** — flash-lite guesses 2023 for
   years; every model output needs the same treatment: confidence gate +
   verify-pass + human diff view. FullTags' idempotent writer makes
   re-running safe, which is the mitigation.
4. **Disk burn** — model caches (Essentia zoo ~1 GB) + demucs temp stems
   on a 460 GB disk that runs hot. Cache to `~/.local/share/fulltags/`,
   temp-stems always deleted, document sizes in the model manifest.
5. **Non-goal guard** — no cloud, no accounts, no distribution (AGPL/NC
   constraints make distribution legally fraught anyway). FullTags is
   local-only by design; that constraint is load-bearing.
6. **Old-code retirement** — `src/commands/enrich.ts` (MB genre top-up)
   still has its own rewrite path; fold into FullTags pipeline once P1.5
   (MB harvest) lands, then delete it (the last duplicated writer).

## Sequencing

```
now   ▸ P1.1 key (S–M) → P1.2 bpm (S) → P1.3 fingerprints (S)
then  ▸ P1.4 Essentia ONNX suite (M) → P1.5 MB harvest (S) → P2.9 energy 2.0 (S)
next  ▸ P2.6 structure cues (slice: cues first) → P2.7 vocal density → P2.8 similarity
parked▸ P3 with explicit triggers
```

Each P1 item is independently shippable and none blocks the others, but
that order maximizes value-per-day. After P1, every file in the archive
carries: complete identity, genre (multi-vote), year, key, BPM, energy,
mood/valence, fingerprints — the full DJ-useful frame set, all verified,
all in the actual files.

## Research base (2026-09-04 pass)

| Verdict | Project | Why |
| ------- | ------- | --- |
| Adopt now | libKeyFinder / OpenKeyScan | 76–79% key accuracy, ~90% dance |
| Adopt now | beat_this (CPJKU) | SOTA beats/downbeats, MIT, pip, CPU |
| Adopt now | chromaprint/fpcalc + AcoustID | free (non-comm), one dep, 4 unlocks |
| Adopt now | Essentia ONNX heads via onnxruntime | arm64-verified path; TF-on-ARM is broken |
| Adopt (phase 2) | demucs-mlx | ~3s/track on M4 Max, MIT |
| Watch → adopt | all-in-one-infer / -mlx | structure + cues; verify EDM labels |
| Watch → adopt | MuQ-MuLan / CLAP | similarity + text queries |
| Keep (enhance) | MusicBrainz `inc=genres+tags` | 1 rps, canonical genres live |
| Avoid | madmom (unmaintained, numpy-2 broken, NC models) | use madmom-infer via all-in-one |
| Skip | beets as dependency | reference only; megadj owns the pipeline |
| Blueprint | robertolupi/deep-cuts | ONNX + sqlite-vec local tagger architecture |
