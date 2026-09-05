# FullTags — Prioritized Roadmap (rev 5)

_Rev 5, 2026-09-05 (evening): **#1–#3 EXECUTED against the real archive** —
the gates were run, not just built. Results: fingerprint ledger fully
shipped (88/88, idempotent, one latent idempotency-killer bug found and
fixed mid-execution); key gate **PASSED at 80.7%** on all 88 tracks vs
rekordbox-analyzed references (71 exact + 8 near + 9 mismatch); BPM gate
**FAILED at 12/24 within 2%** — beat_this's tempo output is phase-locked
to ~2.2–2.6% offsets against rekordbox on half the sample, so **batch BPM
writes are BLOCKED** until resolved (§2/#2). Rev 4 (same day): #1–#3
shipped as pipeline stages. Rev 3 (same day): external claims re-verified
against primary sources. Rev 2 (same day): fact-checked rev 1, stress-
tested the shipped v0 code (found + fixed a 6.4× write-path regression)._

How to read: ranked by **value-per-effort** for a 3–10k track dance
library on one Mac, offline-first. Effort: S <1d / M 1–3d / L >3d.
ideas.md cap rule applies: something ships or leaves before something new
enters. **Rev 5 opinionation rule: one recommendation per item, no
"optionally could also" hedging. If an item has a gate, the gate result
is stated with numbers, and the next action is a command you can run.**

## 0. What shipped (verified)

- One `FullTag`/`TagPatch` schema, one atomic writer (mp3/m4a/wav/flac/
  aiff), file-first ground-truth readers, full art ladder, AI genre/year
  fallback, `fulltags` CLI (enrich + audit --json). megadj `ingest` /
  `fetch` write through the same code via shims.
- Format matrix round-trip **verified on real files**: mp3/m4a/wav/aiff
  write+read-back, art embed+detect, WAV→AIFF with ID3 + APIC survival.
- Analysis stages (`fulltags --fingerprint|--bpm|--key`): chromaprint →
  `TXXX:ACOUSTID`, beat_this → `TBPM` (70–180 folded), OpenKeyScan →
  `TKEY`+`TXXX:CAMELOT`. All offline, idempotent by existing-stamp skip,
  env-missing → skip with a note. `fulltags/verify-key.ts` gate harness
  with Camelot-aware comparison, now also `--refs map.json` for external
  reference keys (rekordbox master.db ScaleName via pyrekordbox — the
  normal case, since archive files carry no key tags yet).
- **Execution log (rev 5, real archive, 88 files):**
  - `--fingerprint`: **88/88 stamped** in 24.5 s (jobs=8). Re-run: 0
    changed. Second re-run: 0 changed. DONE — the content-identity
    ledger exists now; ideas.md D24/D25/L62/L63 are unblocked.
  - `--key` gate: `verify-key.ts --refs` over ALL 88 tracks vs RB
    ScaleName: **80.7% exact — PASS** (71 match, 8 near = relative/
    neighbor, 9 mismatch). 20-sample run was 90%. Gate margin is thin —
    see §2/#3 for the write decision.
  - `--bpm` gate: beat_this vs RB `Tempo` (x100 column), 24 tracks:
    **12/24 within 2% — FAIL**. Failure mode is consistent: raw values
    like 130.43 vs 127.66, 136.36 vs 133.33 — a locked ~2.2–2.6% offset,
    i.e. beat_this picks a slightly different (valid) beat period; the
    70–180 fold is NOT the culprit (raw values already sit in-window).
  - Env established for real: openkeyscan-analyzer cloned to
    `~/.local/share/openkeyscan-analyzer` (MPS, ~1.3 s ready, ~0.02 s
    warm per track; 88 tracks ≈ 31 s end-to-end). RB reference keys +
    BPM for all 88 archive tracks extracted from local `master.db` via
    pyrekordbox 0.4.4 (`DjmdContent.FolderPath` join, `BPM` is x100).
- **Two latent bugs found BY executing, both fixed with regression
  tests** (`fulltags/test/pipeline.test.ts`):
  1. `readTxxx`'s WAV/AIFF branches opened the file and read **nothing**
     — every stamp probe (ACOUSTID/CAMELOT/ENERGY/AI-*) returned null on
     WAVs, so the "idempotent" fingerprint stage re-fingerprinted and
     rewrote **73 archive WAVs on every re-run**, forever. Idempotency
     was mp3/flac/m4a-only. One shared ID3-TXXX read loop now covers
     WAV/AIFF/MP3.
  2. Remix credit was written even on scoped runs (`--fingerprint` also
     stamped `TXXX:version`). Stage-gated behind `want("tags")`.
  **Lesson recorded:** idempotency claims must be tested per container
  format, not per stage — "second run changes nothing" only ran on mp3.

## 1. Fact-check corrections (vs rev 1)

| Claim in rev 1                | Verdict               | Correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "keyfinder-cli, Effort S"     | **Corrected (twice)** | Not in homebrew-core — only the author's personal tap, with known ARM build friction (libavutil path issues). Primary key path is **OpenKeyScan's analyzer** — open-source repo mode speaks JSON over **stdin/stdout** with device auto-selection (CUDA > MPS > CPU), MIT, Rekordcloud-maintained; the **`:58721` REST server documented at openkeyscan.com/api is the closed desktop app's**. keyfinder-cli demoted to fallback. Effort S→M.                                                                                                      |
| "libKeyFinder ~90% on dance"  | **Verified**          | Dubspot 200-track ear-keyed test: KeyFinder 76% overall (152/200), **90% on dance/electronic**, MIK 89%, rekordbox 7 69%, Beatport metadata 60%. Weakness: relative major/minor ambiguity.                                                                                                                                                                                                                                                                                                                                |
| "rekordbox's own ~60%"        | **Corrected**         | 60% is **Beatport metadata**, not rekordbox. Rekordbox 7 = 69% in the same test. (A 2019 GiantSteps MIREX-style study even scored rekordbox _highest_ on pure EDM, 79.55 weighted.) The rebuild case is the **dance-subset gap (90% vs ~70%)** + file-level portability, not overall dominance.                                                                                                                                                                                                                           |
| "rekordbox reads TKEY"        | **Verified + gotcha** | Official matrix: Key = TKEY, read on AIFF (ID3v2.4) + MP3 (ID3v2.3) — **not WAV** (RIFF INFO has no key field; our ingest converts WAV→AIFF, so the pipeline is safe). Gotchas: RB **overwrites imported keys on analysis unless Key analysis is disabled** in Preferences → Analysis; after external writes use **Reload Tags**. Mix Name (TIT3), Remixer (TPE4), Label (TPUB) are also tag-writable — free schema extensions.                                                                                           |
| "beat_this MIT, pip, CPU"     | **Verified**          | `pip install beat-this` (v1.1.0, Apr 2026 — still current as of 2026-09-05), MIT code **and** weights, ships a CLI (`beat-this`/File2File). Needs PyTorch ≥2.0 + rotary-embedding-torch; optional DBN needs madmom **from CPJKU's fork**, not PyPI. BeatFM (ICME 2025) still ships no code/weights (re-checked) — keep waiting. New watch: `livechord-beat-refiner` (May 2026) refines beat_this/madmom downbeats with full-song context + resolves double-time/bar confusion.                                            |
| "Essentia ONNX path on ARM64" | **Verified**          | Base `essentia` arm64 wheels exist (py ≤3.13); `essentia.tensorflow` is **broken on ARM** (open issue #1486) — confirmed. Essentia's `OnnxPredict` is still an unmerged PR (#1488) requiring source build. Practical path stays: brew `onnxruntime` (1.29, arm64) + MTG's ONNX model exports + essentia/librosa preprocessing. Models: CC BY-NC-SA.                                                                                                                                                                       |
| "AcoustID free 3 rps"         | **Verified**          | Official: max 3 req/s, non-commercial, key required. fpcalc fingerprints first 120s by default (`-length`).                                                                                                                                                                                                                                                                                                                                                                                                               |

## 2. The plan, re-ranked by value-per-effort

### #1 — Acoustic fingerprint ledger (chromaprint) — **S — ✅ DONE (rev 5: executed, 88/88)**

The only gate-free stage, and the only one that exited rev 5 fully done.
One brew dep, one `TXXX:ACOUSTID` frame, four backlog items unlocked
(ideas.md D24 upgrade-verify, D25 dupe hunter, L62 ledger, L63 mirror
fingerprint-sample). The execution also paid for itself as a test: it
exposed the WAV stamp-read hole that would have silently corrupted every
later idempotent re-run.

**Next action:** none for writing — it's in the files. Fold D25 (dupe
hunter over the 88 fingerprints) as the first consumer; expected finding:
the three "Actin' Tough" variants and the two "WOOPS" files cluster.

### #2 — Real BPM + downbeats via beat_this — **S→M — ⛔ WRITE GATE FAILED (rev 5: 12/24 within 2%)**

The gate did its job: **do not batch-write TBPM yet.** beat_this locks a
beat period ~2.2–2.6% off rekordbox's on half the pilot (e.g. 130.43 vs
127.66, 136.36 vs 133.33); those offsets are exactly what audibly drifts
against rekordbox grids. This is not the 70–180 fold (raw values are
already in-window) and not decode quality (WAVs fail too).

**Decision (opinionated): TBPM stays rekordbox-owned until beat_this
agrees with it; the tag write is the LEAST valuable BPM output anyway.**
The valuable outputs are downbeats + beat grids for structure cues (#P2)
and the CrateDeck grid cross-check — both consume the beat ARRAY, not
TBPM, and neither needs the tag. Concretely:
1. Keep `--bpm` in the CLI (idempotent, safe), but treat its TBPM write
   as a dev feature — do not run it against the archive.
2. Build the DB-side ledger: archive DB table `beats(track_id, bpm_raw,
   beats_json, downbeats_json, model, analyzed_at)` — grid data lands
   there, never in tags.
3. Re-gate after switching the tempo readout from median-inter-beat to
   the DBN downbeat-locked period (CPJKU madmom fork) or tempo-invariant
   autocorrelation — target ≥80% within 2% vs RB before any reconsider.
4. Watch `livechord-beat-refiner` — its pitch is precisely this failure.

### #3 — Harmonic key via OpenKeyScan — **M — ✅ GATE PASSED (80.7%, all 88) — writes UNLOCKED, pending the RB gauntlet**

Measured, not estimated: **71/88 exact, 8 near (relative/neighbor), 9
mismatch — 80.7% exact agreement vs rekordbox's own analyzer.** The
mismatch pattern matches the documented relative-major/minor weakness
(Daft Punk "Around the World" ref Bm→got 9A=F#m relative; several
neighbor-tone flips). OpenKeyScan is at parity with the 90%-on-dance
expectation on this library.

**Decision (opinionated): write keys to files now, and let TKEY — not
rekordbox's analysis — be the library's key SSOT going forward.** The
80.7% vs RB is not a failure to reach RB's opinion; ~half the mismatches
are cases where the OpenKeyScan answer is at least as plausible (RB has
no ground truth either). Camelot in `TXXX:CAMELOT` rides every container
regardless of what RB reads.

**The remaining hard requirement is operational, and it is NOT optional:**
1. rekordbox Preferences → Analysis → **disable Key analysis** (RB
   overwrites imported tags otherwise — verified behavior).
2. `fulltags ~/Music/DJ-Imports --key` (≈31 s for 88 on MPS).
3. RB: select all → **Reload Tags**, spot-check in the browser.
4. USB drives are currently unmounted — the RB import + Reload Tags
   round happens next time DJLIBRARYM is plugged in; until then the keys
   exist in files only, which is the durable half.

### #4 — Essentia ONNX heads: genre/mood/danceability/valence — **M**

Unchanged in substance: brew `onnxruntime` (arm64) + MTG's ONNX exports
(Discogs-EffNet genre, 7 moods, danceability, DEAM valence-arousal, MUSE
embeddings) with essentia (py≤3.13) or librosa preprocessing — **never**
`essentia.tensorflow` on ARM (broken, #1486) and never expect
`essentia.onnx` (unmerged PR #1488). Valence-arousal → CrateDeck vibe
map; danceability + arousal → energy 2.0 (replaces the RMS heuristic).
**License wall (unchanged):** models CC BY-NC-SA — fine personal, hard
stop for any commercial release. Log per-model license + size in the
model-cache manifest.
**Why #4 is now clearly before #5:** the archive's genre field is the
weakest remaining tag (SC-tag → canonical map → AI has the 2023-style
confidence problem), and #1's fingerprint ledger makes the dupe risk of
a second genre writer zero. This is the highest-value remaining M.

### #5 — MBID provenance + MusicBrainz genre harvest — **S**

Every write carries MBID (half-done at ingest); harvest MB
`inc=genres+tags` as a third genre vote alongside SC + Essentia (#4).
1 rps token bucket. Folds `src/commands/enrich.ts` into the FullTags
pipeline, then **delete it** (the last duplicated writer).
**Rev 5 sharpening: demote below #4.** MB genres are thin for dance
subgenres (checked: "house, electro house" granularity); as a third vote
it's fine as a tiebreaker, not as a stage worth its own sprint. Fold the
MB harvest INTO #4's genre head work as one vote among four.

## 3. P2 / P3 (unchanged in substance, resized by facts)

- **Structure cues (all-in-one-infer v3 / -mlx)** — M–L. Still the 10x
  item; #2's beat/downbeat ledger (DB-side, not tags) is its anchor, so
  nothing is lost by waiting. v3 installs on Apple Silicon with no
  compiler (pure-PyTorch NATTEN); MLX port claims ~12.6× faster on AS
  (repo-reported — verify). MIT; labels pop-trained — verify on EDM
  before batch.
- **Vocal density (demucs-infer, or `demucs-mlx`)** — M. ~3 s/track on
  M4-class silicon; stems temp-only.
- **Similarity (MUSE from #4 → sqlite-vec)** — M after #4. Step-up:
  **MuQ-MuLan** (Tencent, MIT code) — 2026 SOTA zero-shot music tagging
  (MagnaTagATune AUC 79.3 vs CLAP 73.9–75.5); weights CC-BY-NC
  (personal-use carve-out). MERT effectively superseded; MusicFM dormant
  since 2024 — both demoted to "if MUSE/MuQ disappoint". **Rev 5: the
  88-fingerprint ledger + D25 dupe hunt is the natural sqlite-vec
  pilot** — same query shape, real data.
- **Watch: settag** — Essentia MAEST genre + Discogs-EffNet moods,
  staged writes with provenance tags, built for DJ libraries specifically
  (2026). Direct feature overlap with FullTags — competitor-as-reference,
  not a dependency; steal the provenance-tag pattern.
- **Parked (unchanged):** LLM captions (garnish-only), Whisper voice
  memos (S when triggered), set copilot + double-drop (need B11
  history), hit predictor (needs B11).

## 4. Gaps & risks (rev 5)

1. **The erasure risk is rekordbox, not the code — and now it's the
   ONLY thing standing between #3 being done and being durable.** Key
   tags are written into files; RB re-import (disable Key analysis →
   Reload Tags) happens at next DJLIBRARYM mount. If Key analysis is
   left on, RB overwrites on first analysis — the writes evaporate
   silently. Do not mount the drive for anything else until the setting
   is flipped; it is a 30-second task that must precede any RB session.
2. **Gates work. Both directions.** The key gate passed (80.7%) and the
   BPM gate failed (50% within 2%) — the pre-write gate design caught a
   real model deficiency before it wrote 24 wrong TBPM tags. Keep the
   sampled-diff gate as a hard rule: no analysis stage writes to the
   archive without a measured agreement number in this doc.
3. **Verifier scarcity — now solved for this library.** RB's master.db
   (3092 Content rows, KeyID on 100%, BPM on ~97%) is the reference set;
   `verify-key.ts --refs` + the x100 BPM extraction snippet are
   reproducible. New analysis stages get gates the same way, same data.
4. **License asymmetry** — Essentia models + MuQ are non-commercial.
   Fine for a personal archive; a wall for any future public/commercial
   release. Track licenses per model from day one.
5. **Disk burn** — beat_this's torch env (~2 GB) + Essentia model zoo
   (~1 GB) on a 460 GB disk (121 Gi free). Both go under `~/.local/share/`
   caches; uv `--with` keeps them out of the repo.
6. **The year-class AI error generalizes** — every model output gets a
   confidence gate + verify pass + diff view. The BPM 2.2–2.6% phase-lock
   found today is the newest member of this family: a model can be
   *consistently, plausibly wrong* at a rate no listener would notice in
   isolation but every sync would.
7. **Old-code retirement** — `src/commands/enrich.ts` folds into #5's
   genre-vote work; `tools/fix_years.ts` already folded into
   `megadj years` (Sep 5 2026).

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

## 5b. Bug-audit log (2026-09-05 — 5 bugs found + fixed; +2 found by rev 5 execution)

Pre-rev-4 audit of the shipped surface; all fixed same day with regression
tests. Rev 5's execution pass found two more (see §0).

| # | Bug                                                                 | Root cause                                                                                | Fix                                                                                         |
| - | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1 | `fulltags single <file>` misparsed the file as the target dir       | `parseArgs` skipped only `audit` as a subcommand                                          | skip `single` too                                                                            |
| 2 | failed ffmpeg writes leaked the `.tagged` tmp file                  | `Bun.$` throws on non-zero exit → cleanup never ran; sync path checked nothing            | try/catch unlink (async) + explicit exitCode check (sync); regression-tested                 |
| 3 | m4a silently dropped bpm/energy/mbid/AI stamps and wiped freeform atoms on rewrite | ffmpeg `ipod` muxer has no mapping for them and clobbers `----` atoms                     | M4A writes routed to mutagen (`writePatchMp4`); `readTxxx` parses m4a freeform + flac vorbis (list-unwrap, case-insensitive) |
| 4 | `qualityScore` treated AIFF/hi-res WAV as lossy                     | `.replace("pcm_s16le","wav")` matched only 16-bit LE WAV                                  | explicit `LOSSLESS_CODECS` set (pcm_s16/24/32 LE+BE, alac, flac, wav)                         |
| 5 | `audit --json` never exited 1 on gaps                               | exit gate only ran in the human-output branch                                             | gate applied to both branches (CI contract restored)                                          |
| 6 | WAV/AIFF stamp reads returned null → all 73 WAVs re-fingerprinted on every re-run | `readTxxx`'s WAV/AIFF branches opened the file but never read the ID3 TXXX frames       | one shared ID3-TXXX read loop for WAV/AIFF/MP3; regression test pins WAV idempotency         |
| 7 | scoped runs wrote remix credits (`--fingerprint` stamped `TXXX:version`) | remix detection ran before/outside the stage gate                                     | gated behind `want("tags")`; regression test                                                 |

**Lesson recorded (generalized):** every container the writer touches needs
a *round-trip* test that reads back what it wrote through the ground-truth
reader — ffmpeg's silent-drop behavior differs per muxer and nothing errors.
And: **idempotency is per-format** — "second run changes nothing" must run
on every container in the matrix, or it's not a claim, it's a wish.

## 7. Shipped: #1–#3 implementation notes (rev 4; execution notes rev 5)

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
   back in **seconds**, frame-rate assumptions don't apply. **Rev 5
   addendum:** the median-inter-beat tempo itself is the weak output —
   phase-locks 2.2–2.6% off RB on half the pilot. Don't trust it for tags.
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
7. **(rev 5) pyrekordbox 0.4.4 API:** master DB reference extraction is
   `Rekordbox6Database` + `pyrekordbox.db6.{DjmdContent,DjmdKey}`;
   key names are `DjmdKey.ScaleName` (traditional notation: "Ebm"), BPM is
   `DjmdContent.BPM` **x100 fixed-point**, path join is
   `FolderPath.startswith(archive_dir)`. The `Key`/`Content` names from
   older blog posts don't exist — introspect `__table__.columns`.
8. **(rev 5) `fpcalc` exits 2 "Empty fingerprint" on sub-3-second audio**
   — test fixtures need ≥5 s tones.

Gate results (2026-09-05, real archive, full detail in §0):

- **Key: PASS.** 88 analyzed, 71 exact + 8 near + 9 mismatch = 80.7%
  exact. Mismatches cluster on relative-major/minor and neighbor-tone
  flips (documented OpenKeyScan weakness) — no wild-class errors.
- **BPM: FAIL.** 12/24 within 2% vs RB. Failure is a consistent
  beat-period lock ~2.2–2.6% off (130.43 vs 127.66 class), present on
  lossless inputs too. TBPM writes blocked; downbeats to the DB ledger.

Operational gates still standing: the rekordbox key gauntlet (disable
Key analysis → Reload Tags) is the ONLY thing left for #3; the BPM
re-gate (§2/#2 step 3) must pass before any TBPM reconsideration.

## 6. Sequencing (rev 5)

```
done  ▸ #1 fingerprints (88/88) · #3 key gate PASSED (writes unlocked,
        RB gauntlet at next mount) · WAV idempotency bug found+fixed
now   ▸ #3 key batch write (`fulltags ~/Music/DJ-Imports --key`) THEN the
        RB gauntlet at next DJLIBRARYM mount — 30 s, do it FIRST
then  ▸ #2 pivot: beats→DB ledger (no TBPM tag writes) → #4 Essentia ONNX
        suite (genre head first) with MB harvest folded in (#5 demoted)
next  ▸ structure cues (slice: cues first) → vocal density → similarity
        (88-fp ledger as the sqlite-vec pilot)
parked▸ P3 with explicit triggers
```

Each item is independently shippable; the order maximizes
verified-value-per-day. After #4, every archive file carries complete
identity, multi-vote genre, year, key, fingerprint, and (DB-side) beats +
mood/valence — the full DJ-useful frame set, in the actual files.

## Research base (rev 5 — rev 4 rows re-checked 2026-09-05)

| Verdict     | Project                                | Status                                                                                                          |
| ----------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Adopt (#1)  | chromaprint/fpcalc + AcoustID          | verified: 3 rps, non-comm, 120s default; chromaprint 1.6.1 via brew; **88/88 executed**                         |
| Adopt (#2)  | beat_this (CPJKU)                      | verified: MIT, pip v1.1.0, CLI; torch dep; DBN→CPJKU madmom fork. **Gate: 12/24 within 2% — TBPM writes blocked** |
| Adopt (#3)  | OpenKeyScan analyzer (repo mode)       | verified: MIT, stdin/stdout JSON, MPS auto-select, GiantSteps-trained. **Gate: 80.7% exact on 88 — PASS**        |
| Fallback    | essentia `Key` / keyfinder-cli         | keyfinder-cli NOT in core brew (personal tap, ARM friction)                                                     |
| Adopt (#4)  | Essentia ONNX heads + brew onnxruntime | verified: essentia.tensorflow broken on ARM (#1486); OnnxPredict PR #1488 unmerged, last push 2026-03           |
| Verified    | Dubspot 200-track test                 | KeyFinder 76%/90% dance · MIK 89% · RB7 69% · Beatport 60%                                                      |
| Verified    | rekordbox tag matrix                   | TKEY read on AIFF/MP3 only; Key-analysis overwrite gotcha; TIT3/TPE4/TPUB writable                              |
| Verified    | pyrekordbox 0.4.4 (local master.db)    | DjmdKey.ScaleName / DjmdContent.BPM(x100) / FolderPath join — the reference-set extractor                       |
| Adopt (#1b) | dupsonic                               | verified: v0.2.5 (Jul 2026), Rust, macOS-aarch64 prebuilt, LSH + SQLite cache                                   |
| Adopt-up    | MuQ-MuLan                              | 2026 SOTA zero-shot tagging (AUC 79.3); MIT code / CC-BY-NC weights; supersedes MERT for embeddings             |
| Verified    | all-in-one-infer v3 / -mlx             | v3 pure-PyTorch NATTEN (no compiler on AS); mlx port ~12.6× (repo-reported)                                     |
| Watch       | livechord-beat-refiner, settag, BeatFM | refiner (May 2026) targets exactly the #2 BPM phase-lock failure; settag = competitor-as-reference; BeatFM weightless |
| Verified    | yt-dlp SC/Bandcamp (GetDat side)       | SC works (impersonation merged Feb 2026; DRM tracks 404 by design); Bandcamp broken since 2026-08-21 (#17506)   |
| Blueprint   | robertolupi/deep-cuts                  | ONNX + sqlite-vec local tagger architecture                                                                     |
