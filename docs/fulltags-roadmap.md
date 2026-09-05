# FullTags — Prioritized Roadmap (rev 2, fact-checked)

*Rev 2, 2026-09-05 · every external claim re-verified against primary
sources (Dubspot lab report, rekordbox metadata matrix, MTG/essentia
issue tracker, beat_this repo/PyPI, AcoustID docs); two integration
recommendations corrected; plus a stress-test pass over the shipped v0
code that found and fixed a 6.4× write-path regression (§5).*

How to read: ranked by **value-per-effort** for a 3–10k track dance
library on one Mac, offline-first. Effort: S <1d / M 1–3d / L >3d.
ideas.md cap rule applies: something ships or leaves before something new
enters.

---

## 0. What shipped (v0, verified)

- One `FullTag`/`TagPatch` schema, one atomic writer (mp3/m4a/wav/flac/
  aiff), file-first ground-truth readers, full art ladder, AI genre/year
  fallback, `fulltags` CLI (enrich + audit --json). megadj `ingest` /
  `fetch` write through the same code via shims.
- 49 FullTags tests; repo 187/187; tsc + oxlint clean.
- Format matrix round-trip **verified on real files** (§5): mp3/m4a/wav/
  aiff write+read-back, art embed+detect, WAV→AIFF conversion with ID3
  frame + APIC preservation.

## 1. Fact-check corrections (vs rev 1)

| Claim in rev 1 | Verdict | Correction |
| -------------- | ------- | ---------- |
| "keyfinder-cli, Effort S" | **Corrected** | Not in homebrew-core — only the author's personal tap, with known ARM build friction (libavutil path issues). Primary key path is now **OpenKeyScan's analyzer server** (localhost REST :58721, MPS-accelerated, standalone executable available); keyfinder-cli demoted to fallback. Effort S→M. |
| "libKeyFinder ~90% on dance" | **Verified** | Dubspot 200-track ear-keyed test: KeyFinder 76% overall (152/200), **90% on dance/electronic**, MIK 89%, rekordbox 7 69%, Beatport metadata 60%. Weakness: relative major/minor ambiguity. |
| "rekordbox's own ~60%" | **Corrected** | 60% is **Beatport metadata**, not rekordbox. Rekordbox 7 = 69% in the same test. (A 2019 GiantSteps MIREX-style study even scored rekordbox *highest* on pure EDM, 79.55 weighted.) The rebuild case is the **dance-subset gap (90% vs ~70%)** + file-level portability, not overall dominance. |
| "rekordbox reads TKEY" | **Verified + gotcha** | Official matrix: Key = TKEY, read on AIFF (ID3v2.4) + MP3 (ID3v2.3) — **not WAV** (RIFF INFO has no key field; our ingest converts WAV→AIFF, so the pipeline is safe). Gotchas: RB **overwrites imported keys on analysis unless Key analysis is disabled** in Preferences → Analysis; after external writes use **Reload Tags**. Mix Name (TIT3), Remixer (TPE4), Label (TPUB) are also tag-writable — free schema extensions. |
| "beat_this MIT, pip, CPU" | **Verified** | `pip install beat-this` (v1.1.0, Apr 2026), MIT code **and** weights, ships a CLI (`beat-this`/File2File). Needs PyTorch ≥2.0 + rotary-embedding-torch; optional DBN needs madmom **from CPJKU's fork**, not PyPI. |
| "Essentia ONNX path on ARM64" | **Verified** | Base `essentia` arm64 wheels exist (py ≤3.13); `essentia.tensorflow` is **broken on ARM** (open issue #1486) — confirmed. Essentia's `OnnxPredict` is still an unmerged PR (#1488) requiring source build. Practical path stays: brew `onnxruntime` (1.29, arm64) + MTG's ONNX model exports + essentia/librosa preprocessing. Models: CC BY-NC-SA. |
| "AcoustID free 3 rps" | **Verified** | Official: max 3 req/s, non-commercial, key required. fpcalc fingerprints first 120s by default (`-length`). |

## 2. The plan, re-ranked by value-per-effort

### #1 — Acoustic fingerprint ledger (chromaprint) — **S, do first**
Highest ratio in the doc: one brew dep (`chromaprint` → `fpcalc`), one DB
column + one `TXXX:ACOUSTID` frame, and four existing backlog items
unlock (ideas.md D24 upgrade-verify, D25 dupe hunter, L62 ledger, L63
mirror fingerprint-sample). Fully offline matching for dupes; AcoustID
lookup (3 rps, polite) only for untagged `adopt` identification.
**Why first:** zero risk, zero rekordbox settings changes, zero model
installs, and every later item can lean on its content-identity ledger.
**Verify:** fp two known-identical files (different encodes) → match;
one known-different pair → no match.

### #2 — Real BPM + downbeats via beat_this — **S**
Write `TBPM` (integer) + store downbeat array in the archive DB (feeds
P3 cues later; NOT injected into rekordbox grids — that stays
rekordbox-owned per the non-goals). Also becomes an independent
**grid-sanity cross-check** for CrateDeck's verify (duration × BPM vs
beat count, currently self-referential).
**Cost note:** PyTorch install is the real cost (~2 GB env via uv);
per-track CPU inference is seconds. MIT code + weights.
**Verify:** compare against the 294 rekordbox-reanalyzed grids (ground
truth from the 2026-09-03 pass); flag disagreements >2% for review
before any batch run.

### #3 — Harmonic key via OpenKeyScan — **M, the DJ-value king**
**Primary:** OpenKeyScan analyzer server — localhost REST (:58721) or
stdin/stdout JSON mode, standalone executable (no Python), MPS-accelerated,
batch = hundreds of tracks/min, trained on GiantSteps (electronic music),
outputs Camelot + Open Key. **Fallback:** essentia `Key` as a cheap
second vote; keyfinder-cli only via the author's tap if ever needed.
**Write:** `TKEY` (Initial Key) + `TXXX:CAMELOT` via the existing
`writePatch({ key })` — frame map already reserved. AIFF/MP3 carry TKEY;
WAV doesn't (ingest's AIFF conversion keeps the archive covered).
**Operational gauntlet (required, or the work is erased):**
1. rekordbox Preferences → Analysis → **disable Key analysis** (RB
   overwrites imported tags otherwise — verified behavior).
2. Batch-write keys → re-import/reload → **Reload Tags** in RB.
3. Spot-check ≥20 tracks against existing MIK values (if available) or
   ear; require ≥80% agreement before full-library run.
**Why #3 not #1:** biggest *on-stage* value (harmonic mixing), but M
effort (server integration + verification harness) and it's the only
item that can be silently undone by a rekordbox setting — so it needs
the gauntlet above. If harmonic mixing is your top pain, jump it to #1
accepting 2× cost.
**Schema bonus (free, same pass):** Mix Name (TIT3), Remixer (TPE4),
Label (TPUB) are tag-writable and RB-readable — extend FullTag with
`label` + `mixName` now that remixer already exists.

### #4 — Essentia ONNX heads: genre/mood/danceability/valence — **M**
Unchanged in substance, now build-verified: brew `onnxruntime` (arm64) +
MTG's ONNX exports (Discogs-EffNet genre, 7 moods, danceability, DEAM
valence-arousal, MUSE embeddings) with essentia (py≤3.13) or librosa
preprocessing — **never** `essentia.tensorflow` on ARM (broken, #1486)
and never expect `essentia.onnx` (unmerged PR #1488). Valence-arousal →
CrateDeck vibe map; danceability + arousal → energy 2.0 (replaces the
RMS-linear heuristic).
**License wall (unchanged):** models CC BY-NC-SA — fine personal, hard
stop for any commercial release. Log per-model license + size in the
model-cache manifest.

### #5 — MBID provenance + MusicBrainz genre harvest — **S**
Every write carries MBID (half-done at ingest); harvest MB
`inc=genres+tags` as a third genre vote alongside SC + Essentia (#4).
1 rps token bucket. Folds `src/commands/enrich.ts` into the FullTags
pipeline, then **delete it** (the last duplicated writer).

## 3. P2 / P3 (unchanged in substance, resized by facts)

- **Structure cues (all-in-one-infer / -mlx)** — M–L. Still the 10x item;
  beat_this downbeats (#2) are its anchor, so nothing is lost by waiting.
  MIT; labels pop-trained — verify on EDM before batch.
- **Vocal density (demucs-mlx)** — M. ~3 s/track on M4-class silicon;
  stems temp-only.
- **Similarity (MUSE from #4 → sqlite-vec)** — M after #4; MuQ-MuLan
  (CC-BY-NC) only if MUSE disappoints.
- **Parked (unchanged):** LLM captions (garnish-only), Whisper voice
  memos (S when triggered), set copilot + double-drop (need B11
  history), hit predictor (needs B11).

## 4. Gaps & risks (rev 2)

1. **The erasure risk is rekordbox, not the code.** Key/BPM tags are
   only as durable as the RB import settings around them (Key analysis
   off, Reload Tags). This is now a documented gauntlet step, not a
   footnote — the same class as the WAV-art thumbnail lesson.
2. **Verifier scarcity.** Dubspot's set is 200 tracks, six genres, one
   ear. Build a small local ground-truth set (existing MIK tags where
   present + the 294 reanalyzed grids) and require ≥80% sampled
   agreement before any library-wide batch. No batch >50 tracks without
   a sampled diff review.
3. **License asymmetry** — Essentia models + MuQ are non-commercial.
   Fine for a personal archive; a wall for any future public/commercial
   release. Track licenses per model from day one.
4. **Disk burn** — beat_this's torch env (~2 GB) + Essentia model zoo
   (~1 GB) on a 460 GB disk. Both go under `~/.local/share/` caches;
   uv `--with` keeps them out of the repo.
5. **The year-class AI error generalizes** — every model output gets a
   confidence gate + verify pass + diff view. flash-lite's 2023 bias is
   the canonical example; OpenKeyScan's relative-major/minor weakness is
   the next one to expect.
6. **Old-code retirement** — `src/commands/enrich.ts` folds in at #5;
   `tools/fix_years.ts` folds in when years stage gains the SC
   `display_date` refinement.

## 5. Stress-test log (2026-09-05, v0 code)

Real-file verification pass over the shipped writer/shim surface:

| Test | Result |
| ---- | ------ |
| `setFileTags` shim round-trip (mp3/m4a/wav): 4 fields written, ground-truth read back | ✅ PASS all |
| Write-path benchmark: old direct-ffmpeg 19.3 ms vs shim 124.2 ms | ❌ **6.4× regression found** |
| Root cause | nested `bun -e` promise bridge per write |
| Fix | `writePatchSync` — in-process sync writer (ffmpeg spawn for mp3/m4a/flac, mutagen for wav/aiff), no bridge |
| Re-benchmark after fix | ✅ 19 ms/write (parity) |
| AIFF sync path (`writePatchSync` on .aiff via mutagen) | ✅ PASS |
| Regression tests added | fulltags/test/writer-sync.test.ts (sync round-trips + AIFF + perf) |

**Lesson recorded:** any sync API bridged to an async implementation via
a spawned interpreter is a perf trap — expose a native sync twin instead
(mirror of the rbSnapshot-async invariant on the CrateDeck side).

## 6. Sequencing

```
now   ▸ #1 fingerprints (S) → #2 beat_this BPM (S) → #3 OpenKeyScan key (M + gauntlet)
then  ▸ #4 Essentia ONNX suite (M) → #5 MB harvest (S) → energy 2.0 (S)
next  ▸ structure cues (slice: cues first) → vocal density → similarity
parked▸ P3 with explicit triggers
```

Each item is independently shippable; the order maximizes
verified-value-per-day. After #1–#5 every archive file carries complete
identity, multi-vote genre, year, key, BPM, energy, mood/valence, and a
content fingerprint — the full DJ-useful frame set, in the actual files.

## Research base (rev 2 — all rows re-checked 2026-09-05)

| Verdict | Project | Status |
| ------- | ------- | ------ |
| Adopt (#1) | chromaprint/fpcalc + AcoustID | verified: 3 rps, non-comm, 120s default |
| Adopt (#2) | beat_this (CPJKU) | verified: MIT, pip v1.1.0, CLI; torch dep; DBN→CPJKU madmom fork |
| Adopt (#3) | OpenKeyScan analyzer server | verified: localhost REST :58721, MPS, standalone exe, GiantSteps-trained |
| Fallback | essentia `Key` / keyfinder-cli | keyfinder-cli NOT in core brew (personal tap, ARM friction) |
| Adopt (#4) | Essentia ONNX heads + brew onnxruntime | verified: essentia.tensorflow broken on ARM (#1486); OnnxPredict PR #1488 unmerged |
| Verified | Dubspot 200-track test | KeyFinder 76%/90% dance · MIK 89% · RB7 69% · Beatport 60% |
| Verified | rekordbox tag matrix | TKEY read on AIFF/MP3 only; Key-analysis overwrite gotcha; TIT3/TPE4/TPUB writable |
| Watch | all-in-one-mlx, MuQ-MuLan, CLAP | unchanged |
| Blueprint | robertolupi/deep-cuts | ONNX + sqlite-vec local tagger architecture |
