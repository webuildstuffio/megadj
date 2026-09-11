# FullTags — Prioritized Roadmap (rev 6.4)

_Rev 6.4, 2026-09-11: **Beatport integrated as the second source behind
SoundCloud** in every ladder (genre / year / artwork) and the ONLY source
of the DJ identity fields no other source carries — record label (TPUB),
mix name (TIT3), official remixer credit, ISRC (TSRC) — with provenance
stamped TXXX:BP-FIELDS. Access is the v4 catalog API using the anonymous
client-credentials grant the official web embed player ships in its
public bundle (verified live: token → search → 1500² release art).
Ground-truth read-back extended to label/mixName/isrc so bp-filled files
stay idempotent. Rev 6.3, 2026-09-11: the Sep 10/11 intake rounds (123
tracks across three batches) exercised the pipeline end-to-end —
`tag-check` structural scanner shipped, ingest quarantine moved to the
archive-root hidden `.ingest-duplicates/`, same-stem mp3↔lossless pair
dedupe, upgrade re-ingests now reuse the existing row (ledger survives),
analysis-queue order documented, 21 beatgrids snap-repaired to bar
coherence, genre-loss watch on re-ingests. Archive now 131 ledgered
(beats/cues/mood 131/131, 2,043 cues; audit gate 123/123 on the intake).
Revision history in one
line each: rev 4 shipped #1–#3 as pipeline stages; rev 5 executed the
gates on the real archive (fingerprints DONE 88/88, key gate PASSED
80.7%, BPM gate FAILED 12/24 — TBPM writes blocked); rev 6 pivoted #2
into the beats ledger (`megadj beats`) + CrateDeck grid cross-check
(re-gate 16/24, still blocked); rev 6.1 shipped #4 mood/dance/valence
ONNX + #5 MB harvest (energy 2.0, dup-writer deleted) and executed the
mood pass — label order was INVERTED on first run, caught + fixed +
regression-pinned; rev 6.2 added the mood CrateDeck surface +
`megadj cues` phrase ledger + the audit gate requiring mood + energy.
Rev 3 re-verified external claims; rev 2 fact-checked + found the 6.4×
write-path regression._

How to read: ranked by **value-per-effort** for a 3–10k track dance
library on one Mac, offline-first. Effort: S <1d / M 1–3d / L >3d.
ideas.md cap rule applies: something ships or leaves before something new
enters. **One recommendation per item, no "optionally could also" hedging.
If an item has a gate, the gate result is stated with numbers, and the
next action is a command you can run.**

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
  env-missing → skip with a note. `fulltags/verify-key.ts` gate harness,
  now also `--refs map.json` for external reference keys (rekordbox
  master.db ScaleName via pyrekordbox — the normal case, since archive
  files carry no key tags yet).
- **Beats ledger (rev 6):** `megadj beats` analyzes every downloaded
  track with beat_this and writes the beat/downbeat arrays to the archive
  DB `beats` table — never tags (the TBPM write gate failed at 12/24, and
  the bar-grid re-gate reached only 16/24). CrateDeck consumes it via
  `ArchiveReader.gridCrossCheck` (`GET /api/archive/grid-cross-check`,
  MCP `archive_grid_cross_check`): per-track ok / off (>2% from RB
  BPM×duration) / octave (half-double lock) verdicts — the independent
  second opinion the verify pipeline's self-referential grid check
  couldn't give.
- **Execution log (rev 5, real archive, 88 files):**
  - `--fingerprint`: **88/88 stamped** in 24.5 s (jobs=8); re-runs 0
    changed. DONE — D24/D25/L62/L63 unblocked.
  - `--key` gate vs RB ScaleName: **80.7% exact — PASS** (71 match,
    8 near, 9 mismatch). Gate margin is thin — see §2/#3.
  - `--bpm` gate vs RB `Tempo`: **12/24 within 2% — FAIL**; consistent
    locked ~2.2–2.6% offset (130.43 vs 127.66 class); the 70–180 fold
    is NOT the culprit.
  - Env: openkeyscan-analyzer at `~/.local/share/openkeyscan-analyzer`
    (MPS, 88 tracks ≈ 31 s end-to-end); RB reference keys + BPM
    extracted from local `master.db` via pyrekordbox 0.4.4.
- **Two latent bugs found BY executing, both fixed with regression
  tests** (`fulltags/test/pipeline.test.ts`):
  1. `readTxxx`'s WAV/AIFF branches read **nothing** — stamp probes
     returned null on WAVs, so the "idempotent" fingerprint stage
     rewrote **73 archive WAVs on every re-run**. One shared ID3-TXXX
     read loop now covers WAV/AIFF/MP3.
  2. Remix credit was written even on scoped runs (`--fingerprint`
     also stamped `TXXX:version`). Stage-gated behind `want("tags")`.
     **Lesson:** idempotency claims must be tested per container
     format, not per stage.

## 1. Fact-check corrections (vs rev 1)

Rev 2/3 re-verified every rev-1 claim against primary sources; the
corrections that matter are baked into §2 and the research base below:
keyfinder-cli is NOT in homebrew-core (primary key path = OpenKeyScan's
analyzer, repo mode; the `:58721` REST server is the closed desktop
app's); "libKeyFinder ~90%" is the **dance subset** of Dubspot's
KeyFinder-76%-overall test (MIK 89%, RB7 69%, Beatport 60%); rekordbox
reads TKEY on AIFF/MP3 only and **overwrites imported keys on analysis
unless Key analysis is disabled** (the gauntlet); beat_this v1.1.0 MIT
(pip, CLI, torch; DBN needs CPJKU's madmom fork); Essentia
`essentia.tensorflow` is broken on ARM (#1486) — the practical path is
`uv --with onnxruntime`; AcoustID is 3 rps non-commercial, fpcalc
defaults to the first 120 s.

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

### #2 — Real BPM + downbeats via beat_this — **S→M — ⛔ WRITE GATE FAILED → ✅ LEDGER SHIPPED (rev 6)**

The gate did its job: **do not batch-write TBPM.** beat_this locks a
beat period ~2.2–2.6% off rekordbox's on half the pilot (e.g. 130.43 vs
127.66, 136.36 vs 133.33); those offsets are exactly what audibly drifts
against rekordbox grids. This is not the 70–180 fold (raw values are
already in-window) and not decode quality (WAVs fail too).

**Re-gate result (rev 6, bar-grid autocorrelation readout —
`tempoFromBeatGrid` in `fulltags/src/analysis.ts`): 16/24 within 2% —
still under the 80% gate.** The bar-lag readout is strictly better than
the median (16 vs 12) and fixes half of the drift cases, but the 8
remaining failures are hard to close: half/double phase-locks (75.7 vs
138.9, 108.8 vs 150) and the ~2.4% family on tracks whose beat_this
period is slightly different from RB's. Median stays the
conservative choice for display; nothing about the write-block changes.

**Decision (opinionated): TBPM stays rekordbox-owned; the tag write is
the LEAST valuable BPM output anyway. The valuable outputs — downbeats +
beat grids — now live in the archive DB ledger, and that shipped:**

1. `megadj beats` (`src/commands/beats.ts` + the `beats` table in
   `src/state.ts`): beat_this over every downloaded track →
   `beats(video_id PK, bpm_raw, bpm_folded, beats_json, downbeats_json,
model, source_path, analyzed_at)`. No tags are touched — ever.
   Idempotent (ledgered tracks skipped without `--force`), `--json` P1-
   clean, `--jobs N`, corrupt-JSON rows degrade to "re-analyze".
2. The independent grid cross-check shipped in CrateDeck
   (`ArchiveReader.gridCrossCheck`, `GET /api/archive/grid-cross-check`,
   MCP tool `archive_grid_cross_check`): beat_this's grid vs RB's
   BPM×duration, classified ok / off (>2%) / octave (half-double lock).
   Unlike the verify pipeline's grid check (duration×BPM vs beat count
   from the SAME analysis — self-referential), this one compares a second
   analyzer, so a drifted grid actually shows.
3. Re-gate verdict recorded: 16/24 (67%) < 80% — TBPM writes stay
   blocked; watch `livechord-beat-refiner` (its pitch is exactly this
   phase-lock). `--bpm` TBPM writes remain a dev-only feature.

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

### #4 — Essentia ONNX heads: mood/dance/valence — **M — ✅ SHIPPED (rev 6.1, this pass)**

**Shipped:** `fulltags/src/models.ts` — two ONNX towers on onnxruntime
(the `uv --with onnxruntime` env, NOT brew and NOT essentia.tensorflow):
discogs-effnet-bsdynamic embeddings (1280-d) feed the danceability +
4 mood heads; audioset-vggish embeddings (128-d) feed the emomusic
valence-arousal head. One python spawn per batch (stdin/stdout JSON
lines, same pattern as the key server). Stage: `fulltags --mood` →
`TXXX:MOOD` stamp `dance=…; aggressive=…; happy=…; electronic=…;
party=…; valence=…; arousal=…` (idempotent by stamp presence).
`fulltags ensure-models` pre-downloads the ~320 MB model set to
`~/.local/share/fulltags-models` (CC BY-NC-SA — personal use).
**Energy 2.0 (same pass):** with a MOOD stamp, energy blends
`0.5·RMS + 0.3·dance + 0.2·arousal` (0–10 scaled) instead of raw RMS
— verified 1.0 → 1.9 on a test tone, idempotent. Models absent → mood
SKIPs, energy falls back to pure RMS.
**Genre head NOT shipped** — deliberately deferred (see the verdict
below): Discogs-EffNet genre labels are 400-way and pop-trained; they
need label-mapping + a sampled gate before any write. Mood/dance/VA
carry no such risk (new fields, nothing to clobber).
**Env gotchas (empirically probed, rev 6.1, label order CORRECTED in
the second pass):** effnet wants essentia's
`TensorflowInputMusiCNN` melspec in **128-frame chunks of 96 bands**
(`melspectrogram` → `embeddings`); the heads' positive class is
**FIRST** in the softmax vector for every head except `mood_party`
(`['non_party','party']` — every other head is positive-first). **The
first archive pass shipped with this
INVERTED** (`act[-1]` read the negative → every track stamped
dance=0.00 party=1.00) — caught because saturated-constant output is
never believable; stamps stripped, re-run 88/88 sane, regression test
pins the order. emomusic outputs **(valence, arousal) on a 1–9 scale**;
vggish wants 400/200 frames → 96-frame patches transposed to (64, 96);
ONNX batch dims are fixed-128 on the bsdynamic export (edge-replicate
padding). 9 regression tests in
`fulltags/test/models.test.ts` (env-gated).
  **Archive verdict (rev 6.1, 88 files):** mood pass 88/88 stamped,
  converged idempotent (third run = 0 changed). Ledger mirror shipped:
  `megadj mood` syncs TXXX:MOOD stamps into the archive DB `mood` table
  (+ analyzes unstamped tracks inline) and exposes `moodSummary()` —
  88/88 ledgered, avg dance 1.0 / party 0.99 / V 4.34 / A 4.98.
  **Electronic genre head GATE FAILED**: saturated on this library
  (0.87–1.0 across every genre incl. Ambient — zero discrimination),
  so effnet genre writes stay BLOCKED (same pattern as
  the TBPM gate). dance/happy/aggressive DO differentiate (happy 0.04–
  0.99, aggressive 0.01–0.98).
  **Rev 6.2 addendum — genre head ONNX availability + CrateDeck
  surface:** Essentia ships **no ONNX export of the effnet genre head**
  (the `genre_discogs400` head dir carries 7 ONNX files, all maest
  variants; the effnet head is pb-only — the head's own `model_types`
  lists `onnx`, but every onnx URL variant 404s). A conversion would
  need tf2onnx + a fresh sampled gate, for a write whose value is near
  zero on this library (genres already populated by SC/MB) —
  **deferred indefinitely**. What DID ship in 6.2: CrateDeck's readonly
  mood surface — `ArchiveReader.moodProfile()` (ledger averages +
  per-axis extremes), `GET /api/archive/mood`, MCP tool
  `archive_mood_profile` — "play me something dark/hyped/smooth" picker
  data with zero audio touched. Energy 2.0 verified on the real
  archive: 84/88 already carried the blend (the mood pass computes it),
  the 4 misses were the art-embedded WAVs (§5b bug 8) — after the fix,
  88/88 stamped, re-run 0 changed.

### #5 — MBID provenance + MusicBrainz genre harvest — **S — ✅ SHIPPED (rev 6.1, this pass)**

**Shipped:** `fulltags/src/mb.ts` — MB artist folksonomy harvest, 1 rps
token bucket, in-process cache, canonGenre-mapped. `megadj enrich`
rewrote as a thin shim over it + the shared FullTags writer — **the
last duplicate writer is deleted** (the old in-file ffmpeg remux with
its art-dropping and tmp-leak history is gone; enrich now writes through
`writePatch` like everything else). Genre ladder is now: SC tag →
canonical map → MB folksonomy → AI (conf ≥ 0.7) — four votes, one
writer. enrich's `GenreResolver`/`TagWriter` test seams preserved (all
existing tests pass unmodified).

### #6 — Beatport as the second source — **S — ✅ SHIPPED (rev 6.4, this pass)**

**The decision:** second behind SoundCloud in every ladder. SC reflects
how tracks actually circulate (uploader tags, upload-era years, page
art at original res); Beatport is the store-grade authority on the DJ
fields SC doesn't have: **label, mix name, official remixer credit,
ISRC**. So: SC wins every field it covers; BP fills what SC missed and
owns the identity fields outright (only when the file lacks them —
ground truth is never overwritten).

**Shipped:** `fulltags/src/beatport.ts` — v4 catalog client:
client-credentials token (embed-player parity, cached, early-refresh,
401 self-heal), relevance-scored search (artist-match HARD gate — the
store's same-name pack-filler long tail makes title+duration matching
unsafe), canon-vocabulary genre gate (subgenre first; "Electronica"
junk refused), 1500² release-art fetch, `bpStamp` provenance. Pipeline
wiring: genre rung 3 (SC → file → BP → AI), year rung 2 (SC remix-year
→ BP release date → AI), art rung 2 (SC → BP → gateways…), identity
stage gated on `want("tags")`. Writer/read-back: `isrc` joined
`FullTag`/`TagPatch` (TSRC on ID3, freeform ISRC atom on m4a, vorbis on
flac); `groundTruth` now reads back label/mixName/isrc — bp-filled
files are idempotent. Provenance: every BP-filled field set records
`TXXX:BP-FIELDS` ("label=…; mix=…; isrc=…").

**Empirical notes (Sep 11 2026, live probed):** the anonymous grant is
`grant_type=client_credentials` against `account.beatport.com/o/token/`
with the embed player's public client id/secret (pulled from its own
shipped JS — no account, no scraping, no Cloudflare HTML fight; the
`www.beatport.com/search` SSR page and `api.beatport.com` unauth are
both gated, yt-dlp's Beatport extractor is broken — "Unable to extract
playables info"). Search rows carry bpm/key(camelot)/genre/subgenre/
label/release/isrc/catalog_number/length_ms/publish_date + dynamic art
URIs (`{w}x{h}` templates; 1500x1500 fills verified). Per-container tag
probes: mp3 `TPUB`→ffprobe "publisher", `TIT3` survives, `TSRC` frame;
flac keeps raw names; aiff/wav need the mutagen ID3 path (**TSRC must
be in the python import line — the first test run caught exactly
that**); m4a freeform atoms surface to ffprobe under their bare names.

**Gates honored:** no batch write of BP data without the round-trip
tests (`beatport-fields.test.ts`, 5 containers × read-back) and the
relevance/pipeline gating tests (`beatport.test.ts`,
`pipeline-beatport.test.ts`). TBPM/Camelot from BP rows are NOT written
— the BPM write gate is still failed (rev 6), and BP key would fight
the OpenKeyScan SSOT decision (#3).

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
   _consistently, plausibly wrong_ at a rate no listener would notice in
   isolation but every sync would.
7. **Old-code retirement** — `src/commands/enrich.ts` folds into #5's
   genre-vote work; `tools/fix_years.ts` already folded into
   `megadj years` (Sep 5 2026).

## 5. Stress-test log (2026-09-05, v0 code)

Real-file verification of the writer/shim surface: `setFileTags`
round-trips passed on mp3/m4a/wav (ground-truth read-back), and the
benchmark **caught a 6.4× write-path regression** (19.3 ms direct-ffmpeg
→ 124.2 ms shim) — root cause was a nested `bun -e` promise bridge per
write. Fix: `writePatchSync`, the in-process sync writer (ffmpeg spawn
for mp3/m4a/flac, mutagen for wav/aiff); re-benchmark 19 ms/write
(parity), AIFF sync path verified. Regression tests:
`fulltags/test/writer-sync.test.ts` (round-trips + AIFF + perf).

**Lesson recorded:** any sync API bridged to an async implementation via
a spawned interpreter is a perf trap — expose a native sync twin instead
(mirror of the rbSnapshot-async invariant on the CrateDeck side).

## 5b. Bug-audit log (2026-09-05 — 5 bugs found + fixed; +2 found by rev 5 execution)

Pre-rev-4 audit of the shipped surface; all fixed same day with regression
tests (engine in `fulltags/test/`). Rev 5's execution pass found two more.

| #  | Bug + root cause | Fix |
| -- | --- | --- |
| 1 | `fulltags single <file>` misparsed the file as the target dir (`parseArgs` skipped only `audit`) | skip `single` too |
| 2 | failed ffmpeg writes leaked the `.tagged` tmp (`Bun.$` throws before cleanup; sync path checked nothing) | try/catch unlink + explicit exitCode check |
| 3 | m4a silently dropped bpm/energy/mbid/AI stamps and wiped freeform atoms (ffmpeg `ipod` muxer has no mapping) | m4a writes routed to mutagen (`writePatchMp4`); `readTxxx` parses m4a freeform + flac vorbis |
| 4 | `qualityScore` treated AIFF/hi-res WAV as lossy (`.replace` matched only 16-bit LE WAV) | explicit `LOSSLESS_CODECS` set |
| 5 | `audit --json` never exited 1 on gaps (gate only in the human branch) | gate applied to both branches |
| 6 | WAV/AIFF stamp reads returned null → all 73 WAVs re-fingerprinted every re-run (`readTxxx` opened but never read) | one shared ID3-TXXX read loop; regression test pins WAV idempotency |
| 7 | scoped runs wrote remix credits (`--fingerprint` stamped `TXXX:version`) | gated behind `want("tags")` |
| 8 | art-embedded files got NO energy stamp — cover decodes as a bogus video stream, ffmpeg fed it into astats, command failed, `measureRms` returned null (rev 6.2) | `-map 0:a` on the astats command; regression test embeds an APIC cover first; 4 real archive WAVs repaired |

**Lesson recorded (generalized):** every container the writer touches needs
a _round-trip_ test that reads back what it wrote through the ground-truth
reader — ffmpeg's silent-drop behavior differs per muxer and nothing errors.
And: **idempotency is per-format** — "second run changes nothing" must run
on every container in the matrix, or it's not a claim, it's a wish.

## 6. Shipped: #1–#3 implementation notes (rev 4; execution notes rev 5)

What landed, and the env gotchas that cost real time (would have cost more
without the smoke-tests-first loop):

| Stage           | Path                                                                                                    | Writes                                                       | Idempotency stamp             |
| --------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------- |
| `--fingerprint` | `fpcalc -json` (brew chromaprint) → `analysis.ts fingerprintWithDuration`                               | `TXXX:ACOUSTID` (all formats)                                | existing TXXX:ACOUSTID        |
| `--bpm`         | `uv run --with beat-this` → `File2Beats(path)` → beats in **seconds**; tempo = `60/median(diff(beats))` | `TBPM` integer, half/double folded into 70–180 (`foldTempo`) | existing TBPM                 |
| `--key`         | OpenKeyScan analyzer server (JSON over stdin/stdout, MPS auto-select), batched per run                  | `TKEY` + `TXXX:CAMELOT` (+ m4a freeform `initialkey`)        | existing TXXX:CAMELOT or TKEY |

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
   fingerprint _identically_ (same chroma). Test dupe-matching with noise
   vs tone, not sine vs sine.
7. **(rev 5) pyrekordbox 0.4.4 API:** master DB reference extraction is
   `Rekordbox6Database` + `pyrekordbox.db6.{DjmdContent,DjmdKey}`;
   key names are `DjmdKey.ScaleName` (traditional notation: "Ebm"), BPM is
   `DjmdContent.BPM` **x100 fixed-point**, path join is
   `FolderPath.startswith(archive_dir)`. The `Key`/`Content` names from
   older blog posts don't exist — introspect `__table__.columns`.
8. **(rev 5) `fpcalc` exits 2 "Empty fingerprint" on sub-3-second audio**
   — test fixtures need ≥5 s tones.

Gate results (2026-09-05, real archive, full detail in §0): key PASS
(80.7% exact; mismatches cluster on relative major/minor + neighbor
tones, no wild-class errors) — BPM FAIL (12/24 within 2%, the
~2.2–2.6% phase-lock, lossless included). The RB gauntlet is the only
thing left for #3; the bar-grid re-gate must clear 80% before any TBPM
reconsideration.

## 7. Sequencing

The execution log (§0) and the per-item statuses (§2) are the SSOT; the
live order:

```
done  ▸ #1 fingerprints 88/88 · #3 key gate PASS + written (RB gauntlet
        pending) · #2 pivot: beats ledger + grid cross-check (TBPM stays
        blocked) · #4 mood/energy 2.0 88/88 · #5 MB harvest (dup writer
        deleted) · cues ledger 88/88 · mood CrateDeck surface · audit
        gate now requires mood + energy
now   ▸ the RB gauntlet at next drive mount — 30 s, do it FIRST
        (disable Key analysis, reload tags, verify TKEY survives)
then  ▸ rekordbox cue WRITE pass (interlock + gauntlet) → vocal density
        → similarity (88-fp ledger as the sqlite-vec pilot)
parked▸ P3 with explicit triggers · effnet genre writes (saturated head,
        no ONNX export — needs a reason to exist first)
```

## Research base (rev 5 — rev 4 rows re-checked 2026-09-05)

| Verdict     | Project                                | Status                                                                                                                                                             |
| ----------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Adopt (#1)  | chromaprint/fpcalc + AcoustID          | verified: 3 rps, non-comm, 120s default; chromaprint 1.6.1 via brew; **88/88 executed**                                                                            |
| Adopt (#2)  | beat_this (CPJKU)                      | verified: MIT, pip v1.1.0, CLI; torch dep; DBN→CPJKU madmom fork. **Gate: 12/24 within 2% — TBPM writes blocked**                                                  |
| Adopt (#3)  | OpenKeyScan analyzer (repo mode)       | verified: MIT, stdin/stdout JSON, MPS auto-select, GiantSteps-trained. **Gate: 80.7% exact on 88 — PASS**                                                          |
| Fallback    | essentia `Key` / keyfinder-cli         | keyfinder-cli NOT in core brew (personal tap, ARM friction)                                                                                                        |
| Adopt (#4)  | Essentia ONNX heads + onnxruntime      | verified: essentia.tensorflow broken on ARM (#1486); OnnxPredict PR #1488 unmerged. **Shipped rev 6.1 via `uv --with onnxruntime` (no brew dep, no source build)** |
| Shipped #5  | MusicBrainz ws/2 artist search         | folksonomy tags 1 rps; shipped as fulltags/src/mb.ts + enrich fold (rev 6.1)                                                                                       |
| Shipped #6  | Beatport v4 catalog (client-credentials) | anonymous embed-player grant verified live (Sep 11 2026); identity fields + genre/year/art rungs as `fulltags/src/beatport.ts` (rev 6.4)                          |
| Verified    | Dubspot 200-track test                 | KeyFinder 76%/90% dance · MIK 89% · RB7 69% · Beatport 60%                                                                                                         |
| Verified    | rekordbox tag matrix                   | TKEY read on AIFF/MP3 only; Key-analysis overwrite gotcha; TIT3/TPE4/TPUB writable                                                                                 |
| Verified    | pyrekordbox 0.4.4 (local master.db)    | DjmdKey.ScaleName / DjmdContent.BPM(x100) / FolderPath join — the reference-set extractor                                                                          |
| Adopt (#1b) | dupsonic                               | verified: v0.2.5 (Jul 2026), Rust, macOS-aarch64 prebuilt, LSH + SQLite cache                                                                                      |
| Adopt-up    | MuQ-MuLan                              | 2026 SOTA zero-shot tagging (AUC 79.3); MIT code / CC-BY-NC weights; supersedes MERT for embeddings                                                                |
| Verified    | all-in-one-infer v3 / -mlx             | v3 pure-PyTorch NATTEN (no compiler on AS); mlx port ~12.6× (repo-reported)                                                                                        |
| Watch       | livechord-beat-refiner, settag, BeatFM | refiner (May 2026) targets exactly the #2 BPM phase-lock failure; settag = competitor-as-reference; BeatFM weightless                                              |
| Verified    | yt-dlp SC/Bandcamp (GetDat side)       | SC works (impersonation merged Feb 2026; DRM tracks 404 by design); Bandcamp broken since 2026-08-21 (#17506)                                                      |
| Blueprint   | robertolupi/deep-cuts                  | ONNX + sqlite-vec local tagger architecture                                                                                                                        |
