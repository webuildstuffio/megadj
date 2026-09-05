# FullTags — Prioritized Roadmap (rev 4)

_Rev 4, 2026-09-05 (later the same day): **#1–#3 SHIPPED** — fingerprints, beat_this
BPM, and OpenKeyScan key are live pipeline stages with tests, a key-verification
harness, and empirically-verified env gotchas (§7). A 5-bug audit also hardened
the v0 core the same day (§5b). Rev 3, 2026-09-05 · external claims re-verified against primary sources
(second pass, same day as rev 2): OpenKeyScan's actual open-source surface,
beat_this v1.1.0 still current, all-in-one-infer v3's Apple-Silicon
installs, MuQ-MuLan as the 2026 embeddings step-up, dupsonic's first
release, yt-dlp Bandcamp status. Rev 2 (same day) fact-checked the Dubspot
lab report, rekordbox metadata matrix, Essentia ARM64 issues, AcoustID
limits, and stress-tested the shipped v0 code (found + fixed a 6.4×
write-path regression, §5)._

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
- 56 FullTags tests (verified 2026-09-05); tsc + oxlint clean.
- Format matrix round-trip **verified on real files** (§5): mp3/m4a/wav/
  aiff write+read-back, art embed+detect, WAV→AIFF conversion with ID3
  frame + APIC preservation.
- **(rev 4, later today) #1–#3 analysis stages** (§7): `fulltags` gains
  `--fingerprint` (chromaprint→TXXX:ACOUSTID), `--bpm` (beat_this→TBPM,
  half/double-tempo folded into the 70–180 DJ window), and `--key`
  (OpenKeyScan analyzer→TKEY+TXXX:CAMELOT) — all offline, all idempotent
  via existing-stamp detection, env-missing → skip with a note. Schema
  extended with `fingerprint`/`label`/`mixName` (+ `camelot` in TagPatch);
  every format's writer/reader carries them (m4a via new freeform atoms
  initialkey/CAMELOT/ACOUSTID/LABEL/MIXNAME). New `fulltags/verify-key.ts`
  gate harness (Camelot-aware ref comparison, ≥80% gate). 14 new tests in
  `fulltags/test/analysis.test.ts` (env-gated: run green with deps, skip
  with a note without).

## 1. Fact-check corrections (vs rev 1)

| Claim in rev 1                | Verdict               | Correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "keyfinder-cli, Effort S"     | **Corrected (twice)** | Not in homebrew-core — only the author's personal tap, with known ARM build friction (libavutil path issues). Primary key path is now **OpenKeyScan's analyzer** — open-source repo mode speaks JSON over **stdin/stdout** with device auto-selection (CUDA > MPS > CPU), MIT, Rekordcloud-maintained; the **`:58721` REST server documented at openkeyscan.com/api is the closed desktop app's**, usable but not the repo's (rev 3 correction — rev 2 conflated the two). keyfinder-cli demoted to fallback. Effort S→M. |
| "libKeyFinder ~90% on dance"  | **Verified**          | Dubspot 200-track ear-keyed test: KeyFinder 76% overall (152/200), **90% on dance/electronic**, MIK 89%, rekordbox 7 69%, Beatport metadata 60%. Weakness: relative major/minor ambiguity.                                                                                                                                                                                                                                                                                                                                |
| "rekordbox's own ~60%"        | **Corrected**         | 60% is **Beatport metadata**, not rekordbox. Rekordbox 7 = 69% in the same test. (A 2019 GiantSteps MIREX-style study even scored rekordbox _highest_ on pure EDM, 79.55 weighted.) The rebuild case is the **dance-subset gap (90% vs ~70%)** + file-level portability, not overall dominance.                                                                                                                                                                                                                           |
| "rekordbox reads TKEY"        | **Verified + gotcha** | Official matrix: Key = TKEY, read on AIFF (ID3v2.4) + MP3 (ID3v2.3) — **not WAV** (RIFF INFO has no key field; our ingest converts WAV→AIFF, so the pipeline is safe). Gotchas: RB **overwrites imported keys on analysis unless Key analysis is disabled** in Preferences → Analysis; after external writes use **Reload Tags**. Mix Name (TIT3), Remixer (TPE4), Label (TPUB) are also tag-writable — free schema extensions.                                                                                           |
| "beat_this MIT, pip, CPU"     | **Verified**          | `pip install beat-this` (v1.1.0, Apr 2026 — still current as of 2026-09-05), MIT code **and** weights, ships a CLI (`beat-this`/File2File). Needs PyTorch ≥2.0 + rotary-embedding-torch; optional DBN needs madmom **from CPJKU's fork**, not PyPI. BeatFM (ICME 2025) still ships no code/weights (re-checked) — keep waiting. New watch: `livechord-beat-refiner` (May 2026) refines beat_this/madmom downbeats with full-song context + resolves double-time/bar confusion.                                            |
| "Essentia ONNX path on ARM64" | **Verified**          | Base `essentia` arm64 wheels exist (py ≤3.13); `essentia.tensorflow` is **broken on ARM** (open issue #1486) — confirmed. Essentia's `OnnxPredict` is still an unmerged PR (#1488) requiring source build. Practical path stays: brew `onnxruntime` (1.29, arm64) + MTG's ONNX model exports + essentia/librosa preprocessing. Models: CC BY-NC-SA.                                                                                                                                                                       |
| "AcoustID free 3 rps"         | **Verified**          | Official: max 3 req/s, non-commercial, key required. fpcalc fingerprints first 120s by default (`-length`).                                                                                                                                                                                                                                                                                                                                                                                                               |

## 2. The plan, re-ranked by value-per-effort

### #1 — Acoustic fingerprint ledger (chromaprint) — **S — ✅ SHIPPED (rev 4)**

Highest ratio in the doc: one brew dep (`chromaprint` → `fpcalc`), one DB
column + one `TXXX:ACOUSTID` frame, and four existing backlog items
unlock (ideas.md D24 upgrade-verify, D25 dupe hunter, L62 ledger, L63
mirror fingerprint-sample). Fully offline matching for dupes; AcoustID
lookup (3 rps, polite) only for untagged `adopt` identification.
**Why first:** zero risk, zero rekordbox settings changes, zero model
installs, and every later item can lean on its content-identity ledger.
**Verify:** fp two known-identical files (different encodes) → match;
one known-different pair → no match.

### #2 — Real BPM + downbeats via beat_this — **S — ✅ SHIPPED (rev 4)**

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

### #3 — Harmonic key via OpenKeyScan — **M, the DJ-value king — ✅ SHIPPED (rev 4, tag-write half + verify gate)**

**Primary:** OpenKeyScan analyzer — open-source repo mode (JSON over
stdin/stdout, MPS auto-selected; MIT). The `:58721` REST server is the
closed desktop app's — a convenience if that app is installed, never a
dependency. **Fallback:** essentia `Key` as a cheap second vote;
keyfinder-cli only via the author's tap if ever needed.
**Write:** `TKEY` (Initial Key) + `TXXX:CAMELOT` via the existing
`writePatch({ key })` — frame map already reserved. AIFF/MP3 carry TKEY;
WAV doesn't (ingest's AIFF conversion keeps the archive covered).
**Operational gauntlet (required, or the work is erased):**

1. rekordbox Preferences → Analysis → **disable Key analysis** (RB
   overwrites imported tags otherwise — verified behavior).
2. Batch-write keys → re-import/reload → **Reload Tags** in RB.
3. Spot-check ≥20 tracks against existing MIK values (if available) or
   ear; require ≥80% agreement before full-library run.
   **Why #3 not #1:** biggest _on-stage_ value (harmonic mixing), but M
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

- **Structure cues (all-in-one-infer v3 / -mlx)** — M–L. Still the 10x item;
  beat_this downbeats (#2) are its anchor, so nothing is lost by waiting.
  v3 installs on Apple Silicon with no compiler (pure-PyTorch NATTEN);
  MLX port claims ~12.6× faster on AS (repo-reported — verify). MIT;
  labels pop-trained — verify on EDM before batch.
- **Vocal density (demucs-infer, or `demucs-mlx`)** — M. ~3 s/track on
  M4-class silicon; stems temp-only.
- **Similarity (MUSE from #4 → sqlite-vec)** — M after #4. Step-up: **MuQ-MuLan**
  (Tencent, MIT code) — 2026 SOTA zero-shot music tagging (MagnaTagATune
  AUC 79.3 vs CLAP 73.9–75.5); weights CC-BY-NC (personal-use carve-out).
  MERT effectively superseded; MusicFM dormant since 2024 — both demoted
  to "if MUSE/MuQ disappoint".
- **Watch: settag** — Essentia MAEST genre + Discogs-EffNet moods, staged
  writes with provenance tags, built for DJ libraries specifically (2026).
  Direct feature overlap with FullTags — competitor-as-reference, not a
  dependency; steal the provenance-tag pattern.
- **Parked (unchanged):** LLM captions (garnish-only), Whisper voice
  memos (S when triggered), set copilot + double-drop (need B11
  history), hit predictor (needs B11).

## 4. Gaps & risks (rev 3)

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
   `tools/fix_years.ts` folded into `megadj years` (Sep 5 2026) once the
   years stage gained the SC `display_date` refinement.

## 5. Stress-test log (2026-09-05, v0 code)

Real-file verification pass over the shipped writer/shim surface:

| Test                                                                                  | Result                                                                                                     |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `setFileTags` shim round-trip (mp3/m4a/wav): 4 fields written, ground-truth read back | ✅ PASS all                                                                                                |
| Write-path benchmark: old direct-ffmpeg 19.3 ms vs shim 124.2 ms                      | ❌ **6.4× regression found**                                                                               |
| Root cause                                                                            | nested `bun -e` promise bridge per write                                                                   |
| Fix                                                                                   | `writePatchSync` — in-process sync writer (ffmpeg spawn for mp3/m4a/flac, mutagen for wav/aiff), no bridge |
| Re-benchmark after fix                                                                | ✅ 19 ms/write (parity)                                                                                    |
| AIFF sync path (`writePatchSync` on .aiff via mutagen)                                | ✅ PASS                                                                                                    |
| Regression tests added                                                                | fulltags/test/writer-sync.test.ts (sync round-trips + AIFF + perf)                                         |

**Lesson recorded:** any sync API bridged to an async implementation via
a spawned interpreter is a perf trap — expose a native sync twin instead
(mirror of the rbSnapshot-async invariant on the CrateDeck side).

## 5b. Bug-audit log (2026-09-05, later — 5 bugs found + fixed)

Pre-rev-4 audit of the shipped surface; all fixed same day with regression
tests in `fulltags/test/m4a-stamps.test.ts` (suite went 56 → 68+):

| # | Bug                                                                 | Root cause                                                                                | Fix                                                                                         |
| - | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1 | `fulltags single <file>` misparsed the file as the target dir       | `parseArgs` skipped only `audit` as a subcommand                                          | skip `single` too                                                                            |
| 2 | failed ffmpeg writes leaked the `.tagged` tmp file                  | `Bun.$` throws on non-zero exit → cleanup never ran; sync path checked nothing            | try/catch unlink (async) + explicit exitCode check (sync); regression-tested                 |
| 3 | m4a silently dropped bpm/energy/mbid/AI stamps and wiped freeform atoms on rewrite | ffmpeg `ipod` muxer has no mapping for them and clobbers `----` atoms                     | M4A writes routed to mutagen (`writePatchMp4`); `readTxxx` parses m4a freeform + flac vorbis (list-unwrap, case-insensitive) |
| 4 | `qualityScore` treated AIFF/hi-res WAV as lossy                     | `.replace("pcm_s16le","wav")` matched only 16-bit LE WAV                                  | explicit `LOSSLESS_CODECS` set (pcm_s16/24/32 LE+BE, alac, flac, wav)                         |
| 5 | `audit --json` never exited 1 on gaps                               | exit gate only ran in the human-output branch                                             | gate applied to both branches (CI contract restored)                                          |

**Lesson recorded (generalized):** every container the writer touches needs
a *round-trip* test that reads back what it wrote through the ground-truth
reader — ffmpeg's silent-drop behavior differs per muxer and nothing errors.

## 7. Shipped: #1–#3 implementation notes (rev 4)

What landed, and the env gotchas that cost real time (would have cost more
without the smoke-tests-first loop):

| Stage          | Path                                                                                                   | Writes                                    | Idempotency stamp          |
| -------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------- | -------------------------- |
| `--fingerprint`| `fpcalc -json` (brew chromaprint) → `analysis.ts fingerprintWithDuration`                              | `TXXX:ACOUSTID` (all formats)             | existing TXXX:ACOUSTID     |
| `--bpm`        | `uv run --with beat-this` → `File2Beats(path)` → beats in **seconds**; tempo = `60/median(diff(beats))` | `TBPM` integer, half/double folded into 70–180 (`foldTempo`) | existing TBPM              |
| `--key`        | OpenKeyScan analyzer server (JSON over stdin/stdout, MPS auto-select), batched per run                 | `TKEY` + `TXXX:CAMELOT` (+ m4a freeform `initialkey`) | existing TXXX:CAMELOT or TKEY |

Env gotchas, each empirically verified:

1. **beat_this has no tempo field on the programmatic path** — `File2File`
   wants `(audio_path, output_path)` and writes TSV; use `File2Beats` and
   derive tempo from the median inter-beat interval. Beats/downbeats come
   back in **seconds**, frame-rate assumptions don't apply.
2. **beat_this needs `soundfile`** for mp3/m4a: its `load_audio` falls back
   torchaudio → soundfile → madmom, and torchaudio alone fails on mp3.
3. **OpenKeyScan treats stdin EOF as shutdown** — writing all requests then
   `stdin.end()` kills the server before responses are computed
   ("cannot schedule new futures after shutdown"). Keep stdin open; reap
   via kill().
4. **Bun stdout reading must not buffer past a newline** — a read-to-end
   (`new Response(stream).text()`) blocks until process exit, so the ready
   line never "arrives". Use an explicit `getReader()` loop that consumes
   line-by-line.
5. **uv env resolution is not interchangeable**: `--with-requirements
   requirements.txt` hits the warm cached env; spelling the same pins as
   per-package `--with torch>=2.0 ...` resolved differently and hung. Never
   hand-translate a requirements file into `--with` flags.
6. **chromaprint is octave-invariant**: two pure sines an octave apart
   fingerprint *identically* (same chroma). Test dupe-matching with noise
   vs tone, not sine vs sine.

Operational gates still standing (unchanged): the rekordbox key gauntlet
(disable Key analysis → Reload Tags → ≥80% spot-check via
`fulltags/verify-key.ts`) and the BPM verify pass against the 294
rekordbox-reanalyzed grids before any library-wide batch.


## 6. Sequencing

```
now   ▸ ~~#1 fingerprints → #2 beat_this BPM → #3 OpenKeyScan key~~ ✅ SHIPPED (rev 4)
then  ▸ #4 Essentia ONNX suite (M) → #5 MB harvest (S) → energy 2.0 (S)
        batch-run the shipped stages per the §7 gates (verify-key ≥80%,
        294-grid BPM check, RB key-analysis off) before full-library writes
next  ▸ structure cues (slice: cues first) → vocal density → similarity
parked▸ P3 with explicit triggers
```

Each item is independently shippable; the order maximizes
verified-value-per-day. After #1–#5 every archive file carries complete
identity, multi-vote genre, year, key, BPM, energy, mood/valence, and a
content fingerprint — the full DJ-useful frame set, in the actual files.

## Research base (rev 4 — shipped rows added; rev 3 rows re-checked 2026-09-05, second pass)

| Verdict     | Project                                | Status                                                                                                          |
| ----------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Adopt (#1)  | chromaprint/fpcalc + AcoustID          | verified: 3 rps, non-comm, 120s default; chromaprint stable at 1.5.1 (2021)                                     |
| Adopt (#2)  | beat_this (CPJKU)                      | verified: MIT, pip v1.1.0 (still current), CLI; torch dep; DBN→CPJKU madmom fork                                |
| Adopt (#3)  | OpenKeyScan analyzer (repo mode)       | verified: MIT, stdin/stdout JSON, MPS auto-select, GiantSteps-trained; REST :58721 = closed desktop app (rev 3) |
| Fallback    | essentia `Key` / keyfinder-cli         | keyfinder-cli NOT in core brew (personal tap, ARM friction)                                                     |
| Adopt (#4)  | Essentia ONNX heads + brew onnxruntime | verified: essentia.tensorflow broken on ARM (#1486); OnnxPredict PR #1488 unmerged, last push 2026-03           |
| Verified    | Dubspot 200-track test                 | KeyFinder 76%/90% dance · MIK 89% · RB7 69% · Beatport 60%                                                      |
| Verified    | rekordbox tag matrix                   | TKEY read on AIFF/MP3 only; Key-analysis overwrite gotcha; TIT3/TPE4/TPUB writable                              |
| Shipped #1   | chromaprint 1.6.1 via brew              | fpcalc -json verified on mp3/wav; identical content → identical fp across containers |
| Shipped #2   | beat_this v1.1.0 via uv                 | File2Beats path; seconds-domain beats; soundfile dep discovered; ~1 s/track CPU |
| Shipped #3   | OpenKeyScan analyzer (repo mode)        | cloned + server protocol verified on MPS; ready 1.3 s, ~0.02 s warm inference |
| Adopt (#1b) | dupsonic                               | verified: v0.2.5 (Jul 2026), Rust, macOS-aarch64 prebuilt, LSH + SQLite cache                                   |
| Adopt-up    | MuQ-MuLan                              | 2026 SOTA zero-shot tagging (AUC 79.3); MIT code / CC-BY-NC weights; supersedes MERT for embeddings             |
| Verified    | all-in-one-infer v3 / -mlx             | v3 pure-PyTorch NATTEN (no compiler on AS); mlx port ~12.6× (repo-reported)                                     |
| Watch       | livechord-beat-refiner, settag, BeatFM | refiner (May 2026) polishes downbeats; settag = direct competitor; BeatFM still weightless                      |
| Verified    | yt-dlp SC/Bandcamp (GetDat side)       | SC works (impersonation merged Feb 2026; DRM tracks 404 by design); Bandcamp broken since 2026-08-21 (#17506)   |
| Blueprint   | robertolupi/deep-cuts                  | ONNX + sqlite-vec local tagger architecture                                                                     |
