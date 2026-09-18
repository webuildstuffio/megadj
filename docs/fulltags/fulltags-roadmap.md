# FullTags — Prioritized Roadmap (rev 7.12)

**Status:** 🧭 ACTIVE — remaining analysis gates and future stages.

_Rev 7.11, 2026-09-15: **beat analysis stack modernized — decode + session.**
The compressed-container decode is IN-PROCESS via PyAV feeding sample arrays
to `Audio2Beats(signal, sr)` (the ffmpeg→temp-WAV bridge is dead; torchcodec
and audioread were measured as dead ends — FFmpeg ≤ 8 requirement, dropped
ffmpeg backend). `openBeatSession()` amortizes the uv resolve + torch load
once per `--jobs` worker instead of once per track (61% faster over 3 tracks,
byte-equal results). Getcha #1/#2 below updated accordingly; see
`src/fulltags/README.md` § analysis-stage envs._

_Rev 7.11, 2026-09-16: **the flag loop closed + the imprint prior voted.**
#64 dispute review shipped (`megadj genre --disputes` — live recomputed
consensus + agreement + embed age per flagged row; `--agree <id>` ratifies
the audio, `--keep <id>` vouches for the source, `--note` audit trail;
per-row writes only, notes survive the `--flag` self-heal via the
conditional clear in `setGenreFlag`). #128 imprint prior shipped as fetch
ladder rung W7 (`src/fulltags/imprint-prior.ts` — cited, dated
label→family map; unknown/junk labels abstain; `imprintStands` yields to a
contradicting kNN consensus). Issue #113 transition-window similarity
**rejected with evidence**: the embeddings ledger stores only whole-track
time-mean vectors, so window pooling would require the re-analysis runs
its own acceptance forbids._

_Rev 7.12, 2026-09-16: **the vote ladder is the write path (#173), the
similarity prior trims ties (#171), regate covers genre (#169).**
#173: every fetch rung (SC/BP/BC/imprint/AI/MB/file/sync) casts a vote
(genre + weight + provenance, `GENRE_VOTE_WEIGHTS` = the doc's W-table
versioned in code) — highest total elects, deterministic tie-break
toward the harder gate, full breakdown persists in `tracks.genre_votes`;
first-win writes are gone. #171: MegaSet `transitionScore` gains a
capped cosine-similarity bonus (`MEGASET_SIMILARITY_WEIGHT` 0.1) from
stored embeddings — precedence untouched, it trims among mixable
candidates and never rescues a clash. #169: `megadj regate genre` runs
the same LOO harness as `genre --eval` against the ≥65% ship gate;
`regate effnet` reports unavailable honestly (no reference ledger yet)._

_Rev 7.10, 2026-09-15: **roadmap-sync audit — every open item verified against
code and re-tracked on GitHub.** Verified DONE and marked here: full-population
LOO (P92 — subsumed by the Sep 15 Tier-0 run: the eval battery now covers the
canonicalized+flagged population, making the ±1 error bars moot); Bandcamp
genre arm live (rev 7.8, verified in `src/fulltags/bandcamp.ts`); B11
`SET_EXCLUDED_PREVIEW_MAX` shared cap; `genre --flag` self-healing (96/2982).
Re-tracked where the tracker had drifted: ranked secondaries stay on open
issue #63 (no code has landed — the audit closed an accidental duplicate
#114); the human-review loop stays on #64. The `sc_genre_ids` orphan is now
issue [#108](https://github.com/webuildstuffio/megadj/issues/108) (resolve or
drop, decide one way). P98 transition-window similarity is issue
[#113](https://github.com/webuildstuffio/megadj/issues/113); GA-00 gold
annotations [#111](https://github.com/webuildstuffio/megadj/issues/111);
AC-01/02 [#112](https://github.com/webuildstuffio/megadj/issues/112). Set-side
audit items land under #104–#107._

_Rev 7.9, 2026-09-15: **Set UX pass 3 — the product skin, the doubled
badge, and the MegaSet retirement completed.** The step-1 "double badge"
fixed (a dead `.setbuild-preset legend` rule turned step 1's whole title
into a second circle — steps 2/3 never doubled because they use a
different fieldset class). The room-feel line is back: the intro reads
"shape how the room should feel from first track to last" (ProductIntro)
with the step-1 hint restored. Set now owns its accent end to end: one
`--set` token (#e0a93f) replaces the three-amber drift
(`var(--warn)`/`#f0b64b`/`#d9a441`), the panel's chrome (CTA glow,
loading explainer, journey arcs, selection rings, badge) re-tints from
CrateDeck mint to Set amber while the measured arc lines stay mint
(FullTags' data), plus the per-product atmosphere wash and search-results
tint every other product already had. The `ProductMeta.color` field
(unread since Set landed) retired — accents live in CSS. MegaSet naming
finished off everywhere: palette keywords de-twin, m3u8 export renamed
`set-…m3u8` (was `fulltags-…`), MCP/deckctl "M66 copilot" → "Set builder
copilot", CLI help de-numbered. The doc set moved `docs/megaset/` →
`docs/set/` on Sep 14, then **moved BACK to `docs/megaset/` on Sep 15**
(atomic-naming decision: one name everywhere — MegaSet for folder, docs,
issues, and product; `megadj megaset` is the verb; the `setbuild` alias
stays for muscle memory)._

_Rev 7.6, 2026-09-15: **Set is its own product — the fourth nav-strip
button.** The set builder left FullTags' tab strip entirely: it is now a
top-level product (#/set) alongside CrateDeck/GetDat/FullTags, with its
own nav button, Welcome launcher card, phase chip ("the library gets
played"), ProductIntro, and warn-gold accent — promoted through the
product SSOT (router Product union, PRODUCTS, LEDE, PRODUCT_TABS,
palette entry renamed "Set", App canvas switch). Old `#/fulltags/set`
deep links redirect. "Set" naming is gone from user-facing surfaces —
the product is called **Set**. Inside the panel the numbered steps
dropped their redundant sub-lines ("how the room should feel…" repeated
what the preset cards already say); titles are now terse: Energy journey
/ Set length / Sequencer. 21-pass UX suite updated and green._

_Rev 7.4, 2026-09-15: **Set-builder UX pass 2 — the wait, the whys, and
the way back to the terminal.** The build button's bare spinner became a
staged loading explainer: elapsed timer plus a four-phase checklist
(archive read → shelf walk → ledger joins → sequencing) with a
read-only reassurance line, because a whole-shelf scan reads as hung
when it is working. The flat 40-row excluded list became a grouped
breakdown — reasons bucketed by count with example tracks, the raw
per-track audit nested one level down — and the preview cap is now the
shared `SET_EXCLUDED_PREVIEW_MAX` (route/CLI/panel derived; was a
hardcoded 40 in three places). A new repro line prints the exact
`megadj megaset …` invocation for the chain on screen, so CLI parity is
visible at the point of use. The Advanced drawer gained a pool-cap echo,
a determinism note (same settings → same chain), plain-language rule
text ("beyond ±6% a track is unmixable"), and a last-build note naming
which sequencer ran and why. Step titles carry a quiet
what-this-decides sub-line; option rows and panel transitions share one
motion rhythm (140–240 ms). Panel split into SetBuildForm.tsx +
SetBuildStatus.tsx for the file-length guard; 4 new UX tests (21 pass in
the suite). check:full green, 1386 pass, typecov 100%; DOM-verified live
on the offline-shelf state (loading phases → "Shelf not mounted" kicker
→ grouped exclusions → repro line)._

_Rev 7.3, 2026-09-15: **Set panel parity + visual upgrade.** The
Advanced drawer exposes every A/B knob the CLI/MCP already had — the
`limit` pool cap (newest-N builds, "just this week's drops") plus the
engine's real scoring evidence (±2%/±6% tempo curve, 0.45/0.3/0.25
transition weights, 1–15 min track limits, beam threshold/width), all
quoted from the shared registry, never hand-copied. The export link now
carries `search`/`limit`/`opener` so the downloaded M3U8 reproduces the
chain on screen (previously a forced deep search exported a re-sequenced
different set). The flat BPM sparkline became a two-lane arc chart:
measured arousal against the preset's dashed target envelope over real
cumulative set time, BPM below, per-step hover evidence. Scoring
constants are test-pinned (a silent drift would re-rank every proposal);
`bpmScore`/weights now read the shared SSOT. check:full green, 1383
pass, typecov 100%._

_Rev 7.2, 2026-09-15: **Set promoted to its own tab + the
shelf-offline verdict.** The set builder moved from a panel inside
FullTags ⌗ Similar to a dedicated FullTags ⌗ Set tab (palette entry +
help term added; Similar keeps only sounds-like). The empty-pool
diagnosis got honest: when every DB path fails the existence check
(`isShelfOffline` in shared/setbuild.ts), the verdict is now **"Shelf
not mounted"** with mount-first guidance — the old "More compatible
tracks needed" framing misdiagnosed an unmounted SHELF1 as a thin
library (live repro: 3,664 rows, 8 sampler presets mounted, 0-minute
draft). Real shortages keep the partial-draft wording. CLI
`megadj megaset` prints the same diagnosis; the classifier is derived
from the census numbers, never a separate server flag._

_Rev 7.1, 2026-09-15: **the tag-visibility surface shipped** — FullTags ⌗
Tags is now the FullTags ↔ rekordbox ↔ file comparison view. A pure-DB
census (`/api/archive/tag-census`, MCP `archive_tag_census`) joins the
enrichment mirror with the rb-adopt mirror and ranks disagreements
(first live run: 3269/3563 differ, bpm 3132 · title 507 · genre 442 ·
key 276 · artist 11); a per-track endpoint (`tag-compare`) adds the
LIVE file read as ground truth beside both mirrors with the lossless
rb payload expandable. Read-only throughout; census never touches
files (null = "no claim", not a conflict — absence of evidence must
not bury real differences)._

_Rev 7.8, 2026-09-15 (supersedes the duplicate 7.3/7.2 numbering from the
parallel workstreams; set-product revs keep their 7.x names): **Bandcamp
arm live + the name-matching SSOT + the top-3 low-hanging consolidation
fixes.** (1) **W2b Bandcamp vote**
(`src/fulltags/bandcamp.ts`): when SC and BP both miss genre/year/label,
fetch searches the Bandcamp catalog (official autocomplete API —
yt-dlp's extractor stays dead), hard-artist-gates the hits, then fetches
the item page once: genre from artist tags (through the SAME
numeric/`Music` junk gate), year from publish date, label from the
ld+json publisher, art from og:image — slotted into the art ladder
between Beatport and the gateway. Verified live: gated search, page
parse, genre vote, Drumcode label identity. (2) **name-match SSOT**
(`src/fulltags/name-match.ts`): the SC, BP, and Bandcamp scorers shared
three near-copied tokenizers/gates (issue #85's twin class) — now one
`artistGate`/`titleOverlap`/`nameTokens` seam. (3) **#66 finished**:
rb-import was the last hand-rolled `MEGADJ_RB_MASTER ?? join(...)`
(11-of-11 callers now honor the override; master-path.test.ts pins it);
**#67 shipped**: `src/shared/name-key.ts` is the ONE NFC+casefold key —
shelf-sync's NFC-only index keys (case still split) plus rb-adopt/
rb-fix-paths/grid-triage/rb-unmatched inline variants all migrated;
**#82 shipped**: `src/shared/error-text.ts` replaces all 50 inlined
`instanceof Error ? … : String(…)` sites. Census tests re-pinned (JSON
58→59 audited, Number 42→44/13→18 sanctioned) with an extra UI rung
phrase (bandcamp) for the art-rung census. 1450 tests green._

_Rev 7.7, 2026-09-15: **two Phase-0 genre correctness fixes shipped.**
(1) W2 SC hard artist gate — `scoreScHits` (art-sources.ts) drops any
hit whose uploader doesn't match the query artist (≥3 chars), mirroring
Beatport's `scoreBpHit` gate; ends the wrong-artist genre write class.
(2) W1 `Music` mint removed — `?? "Music"` gone from metadata-build +
ingest; unknown stays null (honest gap), real raw genres survive the
regex table. BONUS FIX exposed by the new parser tests: the yt-dlp
`COL|` destructure was misaligned by one field (phantom empty slot) —
SC genre AND year from search hits were silently dead (genre got the
numeric timestamp and was always refused; year was always undefined).
Fixed + pinned in sc-artist-gate.test.ts. Legacy ~154 `Music` rows
still queued (#61 remainder)._

_Rev 7.5, 2026-09-15: **genre docs alignment pass** — the three genre
docs now tell ONE story: pipeline doc §2 is the full write-source
inventory (7 paths, including `megadj ingest` W6 and MusicBrainz `megadj
enrich` W5 that v1 missed); §5c audit table extended with MB + the
getdat `Music` mint; stale claims corrected (`genre --report`,
`genre-aliases.ts` — neither exists; superseded v2 per-source numbers
annotated); `sc_genre_ids` cache identified as orphaned (no committed
writer); label-legitimacy spot-check recorded (exa searches: the
unmapped tail is ~⅔ real genres, ~⅓ correctly-refused junk). No code
changes in this pass — docs only._

_Rev 7.0, 2026-09-15: **the Sep 15 genre quality sprint closed and the
roadmap re-ranked by its verdicts.** Shipped in one day: Tier-0
diagnostics (plan re-ranked), whitening+CSLS on all retrieval surfaces,
the `edm` umbrella refold (+7.4 LOO, gate now judged on the arbitration
arm), and the demote-and-flag pass (96/2982 disputed, seeding-excluded,
self-healing). Key learnings (audit §5b.4): the biggest error block was
a scoring-policy bug, not bad labels; unanimity keeps the dispute
census reviewable; label hygiene cleaned provenance, not the score.
Architecture walkthrough:
[genre-pipeline.md](genre-pipeline.md). Next highest-value queue: #61
(Music-placeholder unstrand), #62 (cluster-proposed labels — the only
fix that attacks the remaining `house→techno` mass), #63 (ranked
secondaries), then the multi-source vote ladder._

_Rev 6.9, 2026-09-15: **demote-and-flag pass shipped and applied live**
(genre-audit §5b.3 step 2): `megadj genre --flag` flags labels that
contradict a UNANIMOUS kNN consensus as `tracks.genre_flag='disputed'`
(96/2982, 3.2% — never rewritten, excluded from seeding), then the full
Tier-0 battery re-ran on the canonicalized+flagged column: arbitration
69.2% holds, label-noise verdict still RANDOM, still no artist leakage,
triangle 19.1% / top-2 77.4%, probe still loses. Post-flag verdict table:
[tier0-diagnostics (archived)](../archive/tier0-diagnostics-2026-09-15.md)._

_Rev 6.7, 2026-09-15: **Tier-0 diagnostics implemented, run live, and
the plan re-ranked by their verdicts**
([tier0-diagnostics (archived)](../archive/tier0-diagnostics-2026-09-15.md)) —
label noise is RANDOM (no systematic-corruption escape hatch), NO artist
leakage (plain LOO numbers stand), the hub tail is real (whitening+CSLS
shipped flag-gated on all retrieval surfaces), the `edm↔house` matrix
block confirms the umbrella arbitration as the top genre fix, and the
linear probe LOST to kNN (−11.1 pts — kNN stays the production readout;
the probe gate fails). Diagnostics + probe + disjoint rerun are one
command: `megadj genre --eval --diagnostics --artist-disjoint --probe
--json`._

_Rev 6.6, 2026-09-14: **genre/readout quality takes the queue** per the
external research review
([embedding-research (archived)](../archive/embedding-research-2026-09-14.md))
— Tier-0 diagnostics (artist-leakage check, hubness histogram, confusion
matrix), the linear-probe readout experiment, whitening+CSLS retrieval,
the `edm` umbrella arbitration, and full-population LOO are the new top
block (before any further set-generation work); MERT rejection marked
provisional pending a per-layer re-test; multi-source genre vote ladder
(+ Bandcamp arm) and transition-window similarity queued. Effnet stays
the single tower — the review's core finding is that the wins are in
readout/labels/taxonomy, not the encoder (idea rows: archived docs/archive/ideas-2026-09-15.md §P)._

_Rev 6.5, 2026-09-11: **hardening + 1:1 parity pass over rev 6.4's
Beatport integration** — the batch stage (`megadj fetch`/`enrich`) now
stamps TXXX:BP-FIELDS and fills the official remixer credit exactly like
the single-file pipeline (was: silent, unattributed writes); transient
catalog failures are retried instead of cached as permanent misses; the
BP client is env-overridable; bpStamp carries a 500-char budget; the
scorer is duration-aware (ffprobe duration feeds the ±2 s/±10 s bonus);
remixer reads back as ground truth (TXXX:version), and the mixName probe
no longer mistakes a remixer-only file's credit for a mix name; the
GetDat library UI phrases every art-ladder rung (census test derived
from the producer source), and `fulltags audit` reports DJ-identity
coverage (label/mix/isrc/remixer).

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
Rev 3 re-verified external claims; rev 2 fact-checked + found the 6.4× write-path regression (detail: §5/§5b)._

How to read: ranked by **value-per-effort** for a 3–10k track dance
library on one Mac, offline-first. Effort: S <1d / M 1–3d / L >3d.
The ideas cap rule applies: something ships or leaves before something new
enters. **One recommendation per item, no "optionally could also" hedging.
If an item has a gate, the gate result is stated with numbers, and the
next action is a command you can run.**

## 0. What shipped (verified)

- **Genre refold (rev 6.8, Sep 15):** `megadj genre --refold` (data half:
  escape repair, multi-label split, casing collapse — applied live, 904
  writes, label twins killed; census fully idempotent 3458/3458) +
  `--eval --refold` (scoring half: plain EDM/Dance/Electronic umbrella
  abstention via injectable `scoringFamily`; the eval gate judges the
  refold arm and exits 0). **Live A/B (reproducible): 61.7% → 69.2%
  gated LOO (+7.4 pts, n 2982→2424, refusal 20.7%→13.0%) — the ≥65%
  post-refold target PASSES.** Engine: `src/fulltags/genre/genre-refold.ts`
  (pure, 21 tests); #94 closed.
- **Demote-and-flag (rev 6.9, Sep 15):** `megadj genre --flag`
  (`--apply` to write; dry by default) — engine
  `src/fulltags/genre/genre-flag.ts` (`classifyDisputes` over the LOO rows,
  4 tests), flag column `tracks.genre_flag` (migration), seeding
  exclusion in `genreSeeds()`. Unanimity bar: gated prediction +
  agreement 1.0 + family mismatch. **Applied live: 96 disputed of 2982
  (3.2%), 273 upheld, labels untouched.** Each run reassesses and
  self-heals (cleared when no longer disputed). Post-flag Tier-0 battery
  re-ran clean (69.2% arbitration holds).
- One `FullTag`/`TagPatch` schema, one format-specific atomic writer
  (mp3/m4a/wav/flac/aiff), file-first ground-truth readers, full art ladder,
  AI genre/year fallback, `fulltags` CLI (enrich + audit --json). megadj
  `ingest` / `fetch` write through the same code via shims. Mutagen paths use
  unique same-directory, media-extension-preserving copies; verify tags/art
  and container headers; fsync; then rename. Failure preserves original bytes
  and cleans temporary files.
- Format matrix round-trip **verified on real files**: mp3/m4a/wav/aiff
  write+read-back, art embed+detect, WAV→AIFF with ID3 + APIC survival.
- Analysis stages (`fulltags --fingerprint|--bpm|--key`): chromaprint →
  `TXXX:ACOUSTID`, beat_this → `TBPM` (70–180 folded), OpenKeyScan →
  `TKEY`+`TXXX:CAMELOT`. All offline, idempotent by existing-stamp skip,
  env-missing → skip with a note. `fulltags verify-key` gate verb (#185,
  part of the fulltags CLI), also `--refs map.json` for external
  reference keys (rekordbox
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
  tests** (`src/fulltags/test/pipeline.test.ts`):
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
(idea refs D24 upgrade-verify, D25 dupe hunter, L62 ledger, L63 mirror
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

**Re-gate result (rev 6, bar-grid autocorrelation readout — the since-deleted `tempoFromBeatGrid`, formerly `src/fulltags/analysis.ts`): 16/24 within 2% —
still under the 80% gate.** The bar-lag readout is strictly better than
the median (16 vs 12) and fixes half of the drift cases, but the 8
remaining failures are hard to close: half/double phase-locks (75.7 vs
138.9, 108.8 vs 150) and the ~2.4% family on tracks whose beat_this
period is slightly different from RB's. Median stays the
conservative choice for display; nothing about the write-block changes.

**Decision (opinionated): TBPM stays rekordbox-owned; the tag write is
the LEAST valuable BPM output anyway. The valuable outputs — downbeats +
beat grids — now live in the archive DB ledger, and that shipped:**

1. `megadj beats` (`src/fulltags/beats.ts` + the `beats` schema in
   `src/archive/state_core.ts`): beat_this over every downloaded track →
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

### #4 — Essentia ONNX mood/dance/valence — **M — ✅ SHIPPED (rev 6.1)**

`src/fulltags/models.ts`: two ONNX towers (effnet-1280 → dance + 4 mood
heads; vggish-128 → valence-arousal) under `uv --with onnxruntime`;
`fulltags --mood` → `TXXX:MOOD` stamp; energy 2.0 blends
`0.5·RMS + 0.3·dance + 0.2·arousal`. Archive verdict 88/88 stamped,
idempotent, ledgered via `megadj mood`. **Load-bearing findings kept:**
(1) the heads' positive class is FIRST in softmax for every head except
`mood_party` — the first pass shipped INVERTED and was caught only
because saturated-constant output is never believable (regression test
pins the order); (2) the effnet GENRE head has no ONNX export and was
saturated on this library anyway — genre writes stay BLOCKED, deferred
indefinitely (rev 6.2 addendum); (3) CrateDeck's readonly mood surface
(`archive_mood_profile` + `/api/archive/mood`) shipped 6.2. Full probe
log: Git history (rev 6.1–6.2).

### #5 — MBID provenance + MusicBrainz genre harvest — **S — ✅ SHIPPED (rev 6.1)**

`src/fulltags/mb.ts`: MB artist folksonomy harvest (1 rps, cached,
canonGenre-mapped). `megadj enrich` is now a thin shim over it + the
shared writer — the last duplicate ffmpeg writer is deleted; genre
ladder = SC tag → canonical map → MB folksonomy → AI (conf ≥ 0.7).

### #6 — Beatport as the second source — **S — ✅ SHIPPED (rev 6.4; hardened rev 6.5)**

**The decision:** second behind SoundCloud in every ladder. SC reflects
how tracks actually circulate (uploader tags, upload-era years, page
art at original res); Beatport is the store-grade authority on the DJ
fields SC doesn't have: **label, mix name, official remixer credit,
ISRC**. So: SC wins every field it covers; BP fills what SC missed and
owns the identity fields outright (only when the file lacks them —
ground truth is never overwritten).

**Shipped:** `src/fulltags/beatport.ts` — v4 catalog client:
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

> **2026-09-14 re-rank (research review):** the old "Similarity (MUSE →
> sqlite-vec)" step-up is superseded by the readout ladder — probe,
> whitening+CSLS, projection head, transition-window similarity
> (§P89–P98 of the archived ideas catalog) all come BEFORE any second tower or second ledger.
> The embedding-research snapshot's §6 has the per-item verdicts.
>
> **2026-09-15 update (Tier-0 verdicts —
> [tier0-diagnostics (archived)](../archive/tier0-diagnostics-2026-09-15.md)):**
> the ladder re-ordered again by measurement. ✅ whitening+CSLS SHIPPED
> (flag-gated A/B, coherence proxy flat — P100's 100-mix judgment
> decides). ❌ linear probe LOST (51.5% vs kNN 62.6% — P90's gate fails;
> kNN stays production, re-test only after the `edm` refold). ▲
> `edm` umbrella arbitration (P94) PROMOTED to the top genre fix — the
> confusion matrix's biggest block is `edm↔house` (360/896
> disagreements), not the triangle. Label noise being RANDOM also
> upgrades P95/P96 (active-labelling + imprint prior): no systematic
> corruption to hunt, so refold effort converts to points directly.
>
> **2026-09-15 late update (post-flag re-rank — issues #61–#65):** the
> refold + flag work closed the scoring-policy bug AND verified the
> remaining error mass is real sub-genre ambiguity (`house→techno` 100
> disagreements; umbrella block down to 250/78 and now abstaining).
> Therefore the next genre queue is, in order: **#61 Music-placeholder
> unstrand** (S, mechanical — 154 rows invisible to BOTH seeds and
> inference; the `?? "Music"` fallback removal HALF shipped Sep 15 —
> roadmap Rev 7.2 — only the unstrand remains),
> **#62 cluster-proposed labels** (M, the ONLY fix that
> attacks the remaining error mass), **#63 ranked secondaries via head
> top-3** (S–M, runs on cached embeddings), ~~**#64 human-review UI for
> the 96 disputed rows**~~ (**SHIPPED Sep 16** — `genre --disputes` +
> `--agree`/`--keep`/`--note`, rev 7.11), **#65 LLM residue
> pass** (S, one-shot, for the ~6.6% unmapped tail — with the Sep 15
> search spot-check showing the tail is ~⅔ real-but-unmapped labels:
> phonk, EBM, new wave, D&B, merengue are REAL and mappable; the junk
> third stays refused). The multi-source
> vote ladder + Bandcamp arm stays M and follows once the label column
> is clean enough to vote over. **New S item — `sc_genre_ids` orphan:**
> the ID→name cache has no committed writer (pipeline doc §5); commit a
> resolution command or drop the table. **2026-09-15: tracked as
> [#108](https://github.com/webuildstuffio/megadj/issues/108).**

- **Structure cues (all-in-one-infer v3 / -mlx)** — M–L. Still the 10x
  item; #2's beat/downbeat ledger (DB-side, not tags) is its anchor, so
  nothing is lost by waiting. v3 installs on Apple Silicon with no
  compiler (pure-PyTorch NATTEN); MLX port claims ~12.6× faster on AS
  (repo-reported — verify). MIT; labels pop-trained — verify on EDM
  before batch.
- **Vocal density (demucs-infer, or `demucs-mlx`)** — M. ~3 s/track on
  M4-class silicon; stems temp-only. **Research-review caveat: stems
  helped MuQ but HURT CLAP (84.6→83.2) — effnet is architecturally
  CLAP-side; gate any stem-similarity work behind a 200-track probe
  before paying the 6–12 h Demucs bill (review §5 J3).**
- **Transition-window similarity (NEW, S–M)** — outro→intro retrieval
  over the existing patch embeddings + cues ledger (archived ideas P98; review
  §5 J4). Cheapest genuinely-new retrieval quality: no new model, no
  Demucs.
- **Genre vote ladder + Bandcamp arm (NEW, M)** — ~~weighted multi-source
  vote replacing first-win-writes~~ (**SHIPPED Sep 16, #173** —
  `src/fulltags/genre/genre-vote.ts`: every rung votes genre+weight+
  provenance per the doc's W-table, highest total elects, ties break
  toward the harder gate, breakdown persists in `tracks.genre_votes`).
  The **imprint prior rung is LIVE** in the vote (Sep 16, W7 —
  `src/fulltags/imprint-prior.ts`, cited map, weight 0.15: a scene
  FAMILY inference that abstains against real genre votes unless it's
  the only voice); LLM pre-labelling remains the future half of the
  P96 estimate (~60% human-hours cut).
- **Similarity (MUSE from #4 → sqlite-vec)** — M after #4. Step-up:
  **MuQ-MuLan** (Tencent, MIT code) — 2026 SOTA zero-shot music tagging
  (MagnaTagATune AUC 79.3 vs CLAP 73.9–75.5); weights CC-BY-NC
  (personal-use carve-out). MERT effectively superseded; MusicFM dormant
  since 2024 — both demoted to "if MUSE/MuQ disappoint". **Rev 5: the
  88-fingerprint ledger + D25 dupe hunt is the natural sqlite-vec
  pilot** — same query shape, real data. **Rev 6.6: MuQ swap stays
  parked behind the ONNX-export + ≥3 pt gates; retrieve-then-rerank
  (P99) dissolves the cost objection for ANY second tower first.**
- **Watch: settag** — Essentia MAEST genre + Discogs-EffNet moods,
  staged writes with provenance tags, built for DJ libraries specifically
  (2026). Direct feature overlap with FullTags — competitor-as-reference,
  not a dependency; steal the provenance-tag pattern.
- **Parked (unchanged):** LLM captions (garnish-only), Whisper voice
  memos (S when triggered), set copilot + double-drop (need B11
  history), hit predictor (needs B11). **Now also parked: crate
  co-occurrence supervision (P101 — needs B11-style history too).**

## 4. Gaps & risks (rev 5)

### Re-gate harness (issue #18)

`src/fulltags/gates.ts` is the shared verdict harness for BPM, genre, and
effnet reference runs. It reports every track's relative offset, applies the
80% pass bar (BPM's default tolerance is 2%), and rejects a detector whose
non-null output is saturated to one value. A passing verdict is the only
entry point to `applyGateWritesSync`, which delegates to the existing
format-aware `writePatchSync`; failed and saturated runs cannot write tags.

`megadj regate bpm --json` wires the existing content-hash-keyed gold and beat
ledgers into that harness. **Since Sep 16 (#169), `megadj regate genre`
is live**: it runs the SAME leave-one-out harness `genre --eval` runs
(`evalLeaveOneOut` — no second eval implementation) over the same
evalPopulation and reports against the ≥65% ship gate from the tier-0
work. `megadj regate effnet` honestly reports unavailable (exit 0,
`unavailable` + reason on the wire): its reference ledger (audio-true
genre labels on the effnet tower's own vectors) does not exist yet —
never a manufactured pass (§4's own rule).

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
   `fulltags verify-key --refs` + the x100 BPM extraction snippet are
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
7. **Old-code retirement** — `src/fulltags/fetch/enrich.ts` owns #5's
   genre-vote work; `tools/fix-years.ts` (folded into `megadj years`
   Sep 5 2026) was deleted Sep 16 2026 (#93 CUT — zero callers; the
   census-test allowance and LibraryTab hints now point at `megadj
years`).

## 5. Stress-test log (2026-09-05, v0 code)

Real-file verification of the writer/shim surface: `setFileTags`
round-trips passed on mp3/m4a/wav (ground-truth read-back), and the
benchmark **caught a 6.4× write-path regression** (19.3 ms direct-ffmpeg
→ 124.2 ms shim) — root cause was a nested `bun -e` promise bridge per
write. Fix: `writePatchSync`, the in-process sync writer (ffmpeg spawn
for mp3/m4a/flac, mutagen for wav/aiff); re-benchmark 19 ms/write
(parity), AIFF sync path verified. Regression tests:
`src/fulltags/test/writer-sync.test.ts` (round-trips + AIFF + perf).

**Lesson recorded:** any sync API bridged to an async implementation via
a spawned interpreter is a perf trap — expose a native sync twin instead
(mirror of the rbSnapshot-async invariant on the CrateDeck side).

## 5b. Bug-audit log (2026-09-05 — 5 bugs found + fixed; +2 found by rev 5 execution)

Pre-rev-4 audit of the shipped surface; all fixed same day with regression
tests (engine in `src/fulltags/test/`). Rev 5's execution pass found two more.

| #   | Bug + root cause                                                                                                                                                | Fix                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | `fulltags single <file>` misparsed the file as the target dir (`parseArgs` skipped only `audit`)                                                                | skip `single` too                                                                                          |
| 2   | failed ffmpeg writes leaked the `.tagged` tmp (`Bun.$` throws before cleanup; sync path checked nothing)                                                        | try/catch unlink + explicit exitCode check                                                                 |
| 3   | m4a silently dropped bpm/energy/mbid/AI stamps and wiped freeform atoms (ffmpeg `ipod` muxer has no mapping)                                                    | m4a writes routed to mutagen (`writePatchMp4`); `readTxxx` parses m4a freeform + flac vorbis               |
| 4   | `qualityScore` treated AIFF/hi-res WAV as lossy (`.replace` matched only 16-bit LE WAV)                                                                         | explicit `LOSSLESS_CODECS` set                                                                             |
| 5   | `audit --json` never exited 1 on gaps (gate only in the human branch)                                                                                           | gate applied to both branches                                                                              |
| 6   | WAV/AIFF stamp reads returned null → all 73 WAVs re-fingerprinted every re-run (`readTxxx` opened but never read)                                               | one shared ID3-TXXX read loop; regression test pins WAV idempotency                                        |
| 7   | scoped runs wrote remix credits (`--fingerprint` stamped `TXXX:version`)                                                                                        | gated behind `want("tags")`                                                                                |
| 8   | art-embedded files got NO energy stamp — cover decodes as a bogus video stream, ffmpeg fed it into astats, command failed, `measureRms` returned null (rev 6.2) | `-map 0:a` on the astats command; regression test embeds an APIC cover first; 4 real archive WAVs repaired |

**Lesson recorded (generalized):** every container the writer touches needs
a _round-trip_ test that reads back what it wrote through the ground-truth
reader — ffmpeg's silent-drop behavior differs per muxer and nothing errors.
And: **idempotency is per-format** — "second run changes nothing" must run
on every container in the matrix, or it's not a claim, it's a wish.

## 6. Shipped: #1–#3 implementation notes (rev 4; execution notes rev 5)

What landed, and the env gotchas that cost real time (would have cost more
without the smoke-tests-first loop):

| Stage           | Path                                                                                                                                      | Writes                                                       | Idempotency stamp             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------- |
| `--fingerprint` | `fpcalc -json` (brew chromaprint) → `analysis.ts fingerprintWithDuration`                                                                 | `TXXX:ACOUSTID` (all formats)                                | existing TXXX:ACOUSTID        |
| `--bpm`         | `uv run --with beat-this` → PyAV decode (in-process) → `Audio2Beats(signal, sr)` → beats in **seconds**; tempo = `60/median(diff(beats))` | `TBPM` integer, half/double folded into 70–180 (`foldTempo`) | existing TBPM                 |
| `--key`         | OpenKeyScan analyzer server (JSON over stdin/stdout, MPS auto-select), batched per run                                                    | `TKEY` + `TXXX:CAMELOT` (+ m4a freeform `initialkey`)        | existing TXXX:CAMELOT or TKEY |

Env gotchas, each empirically verified:

1. **beat_this has no tempo field on the programmatic path** — `File2File`
   wants `(audio_path, output_path)` and writes TSV; the worker uses
   `Audio2Beats(signal, sr)` (sample array in) and derives tempo from the
   median inter-beat interval. Beats/downbeats come
   back in **seconds**, frame-rate assumptions don't apply. **Rev 5
   addendum:** the median-inter-beat tempo itself is the weak output —
   phase-locks 2.2–2.6% off RB on half the pilot. Don't trust it for tags.
2. **beat_this can't demux mp3/m4a itself in this env** — its `load_audio`
   falls back torchaudio → soundfile → madmom, and torchaudio needs
   torchcodec (requires FFmpeg ≤ 8; brew ships 9) while libsndfile can't
   read compressed containers. Since Sep 15 2026 the worker decodes
   **in-process via PyAV** and feeds the sample array to
   `Audio2Beats(signal, sr)` directly — the old ffmpeg→temp-WAV bridge is
   gone (see `src/fulltags/README.md`).
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
7. **(rev 5) pyrekordbox 0.4.4 API:** `Rekordbox6Database` +
   `pyrekordbox.db6.{DjmdContent,DjmdKey}`; `DjmdKey.ScaleName`,
   `DjmdContent.BPM` is **x100 fixed-point**, path join via
   `FolderPath.startswith(archive_dir)`; older blog-post names don't
   exist — introspect `__table__.columns`.
8. **(rev 5) `fpcalc` exits 2 "Empty fingerprint" on sub-3-second audio**
   — test fixtures need ≥5 s tones.

Gate results (2026-09-05, real archive): key PASS (80.7% exact) —
BPM FAIL (12/24 within 2%). Full detail in §0; re-gate numbers in §2/#2.

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

| Verdict     | Project                                                  | Status                                                                                                                                                             |
| ----------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Adopt (#1)  | chromaprint/fpcalc + AcoustID                            | verified: 3 rps, non-comm, 120s default; chromaprint 1.6.1 via brew; **88/88 executed**                                                                            |
| Adopt (#2)  | beat_this (CPJKU)                                        | verified: MIT, pip v1.1.0, CLI; torch dep; DBN→CPJKU madmom fork. **Gate: 12/24 within 2% — TBPM writes blocked**                                                  |
| Adopt (#3)  | OpenKeyScan analyzer (repo mode)                         | verified: MIT, stdin/stdout JSON, MPS auto-select, GiantSteps-trained. **Gate: 80.7% exact on 88 — PASS**                                                          |
| Fallback    | essentia `Key` / keyfinder-cli                           | keyfinder-cli NOT in core brew (personal tap, ARM friction)                                                                                                        |
| Adopt (#4)  | Essentia ONNX heads + onnxruntime                        | verified: essentia.tensorflow broken on ARM (#1486); OnnxPredict PR #1488 unmerged. **Shipped rev 6.1 via `uv --with onnxruntime` (no brew dep, no source build)** |
| Shipped #5  | MusicBrainz ws/2 artist search                           | folksonomy tags 1 rps; shipped as src/fulltags/mb.ts + enrich fold (rev 6.1)                                                                                       |
| Shipped #6  | Beatport v4 catalog (client-credentials)                 | anonymous embed-player grant verified live (Sep 11 2026); identity fields + genre/year/art rungs as `src/fulltags/beatport.ts` (rev 6.4)                           |
| Verified    | Dubspot 200-track test                                   | KeyFinder 76%/90% dance · MIK 89% · RB7 69% · Beatport 60%                                                                                                         |
| Verified    | rekordbox tag matrix                                     | TKEY read on AIFF/MP3 only; Key-analysis overwrite gotcha; TIT3/TPE4/TPUB writable                                                                                 |
| Verified    | pyrekordbox 0.4.4 (local master.db)                      | DjmdKey.ScaleName / DjmdContent.BPM(x100) / FolderPath join — the reference-set extractor                                                                          |
| Adopt (#1b) | dupsonic                                                 | verified: v0.2.5 (Jul 2026), Rust, macOS-aarch64 prebuilt, LSH + SQLite cache                                                                                      |
| Adopt-up    | MuQ-MuLan                                                | 2026 SOTA zero-shot tagging (AUC 79.3); MIT code / CC-BY-NC weights; supersedes MERT for embeddings                                                                |
| Verified    | all-in-one-infer v3 / -mlx                               | v3 pure-PyTorch NATTEN (no compiler on AS); mlx port ~12.6× (repo-reported)                                                                                        |
| Watch       | livechord-beat-refiner, settag, BeatFM                   | refiner (May 2026) targets exactly the #2 BPM phase-lock failure; settag = competitor-as-reference; BeatFM weightless                                              |
| Verified    | yt-dlp SC/Bandcamp (GetDat side)                         | SC works (impersonation merged Feb 2026; DRM tracks 404 by design); Bandcamp broken since 2026-08-21 (#17506)                                                      |
| Blueprint   | robertolupi/deep-cuts                                    | ONNX + sqlite-vec local tagger architecture                                                                                                                        |
| Adopt-read  | **MARBLE probing protocol** (arXiv:2306.10548)           | linear probe on frozen features = the benchmark standard; replaces kNN-on-raw-cosine as our genre readout (archived ideas P90)                                     |
| Reference   | TuneJury (arXiv:2606.17006)                              | frozen towers + 2.8M MLP head + pairwise-logistic on 17.5K prefs — the validated recipe behind archived ideas P93                                                  |
| Reference   | MuQ / MuQ-MuLan (arXiv:2501.01108)                       | MARBLE 77.0 avg; beats MERT/MusicFM with 180× less data (Mel-RVQ target is the lever); no first-class ONNX → parked (J6)                                           |
| Reference   | EDM subgenre (arXiv:2110.08862)                          | 60.6% @ 30 classes / 75K songs = the honest calibration for our families; tempogram late-fusion fixes exactly our trance/tech-trance fuzz (archived ideas P97)     |
| Reference   | Perceptual similarity (arXiv:2601.19109)                 | stems 86.8→90.4% on MuQ but CLAP got worse; hubness + CSLS fix; ~330 ABX triplets fit the ridge (archived ideas P91, P98; §3 stems caveat)                         |
| Snapshot    | **fulltags/../archive/embedding-research-2026-09-14.md** | full external review: findings F1–F6, cost tables, licence ledger, ranked ladder, adoption verdicts §6                                                             |
