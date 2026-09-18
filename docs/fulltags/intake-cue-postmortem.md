# Postmortem & Master Improvement Plan — Sep 2026 intake/cue marathon

**Status:** 🧭 ACTIVE — rev 5 repairs and doctor gates executed on 2026-09-14;
F5's unified census is tracked in
[#238](https://github.com/webuildstuffio/megadj/issues/238).

**Execution receipt:** F6/F1/F2/F3-surface/F7 shipped as commands + doctor
gates; the SHELF1 applies ran and all three repair exit gates were green. Rev
4 pinned cue-kind semantics with live RB7 evidence; revs 2–3 audited the
surrounding transcripts, issue set, and repeated failure mechanics.

**Scope:** everything that went wrong or slow in
the fulltags/rb-import/cue marathon (Sep 10–13) and the surrounding week's
sessions, plus the two open bugs the user still sees (duplicate tracks; hot-
cue pads not clickable). This is the working list to burn down. Product
rules live in [PRINCIPLES.md](../PRINCIPLES.md); this doc owns the _lessons +
tickets_. Live collection counts belong to commands and DB receipts, not this
header.

---

## 0a. Execution receipt (Sep 14 — the applies ran)

| Gate                  | Before                                                   | Action                                                                                                                                    | After (doctor-verified)     |
| --------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| F1 incident cue rows  | 2,973 provenance-matching Kind=0 rows (pads invisible)   | `rb-cues SHELF1 --apply --yes` → restamped 2,965 (8 rows vanished with dedup'd losers first)                                              | ✓ 0 incident rows remain    |
| F2 dupes (SHELF1)     | 78 pairs (69 fingerprint, 7 path-twin, 2 late surfacers) | `rb-dedup SHELF1 --apply --yes` ×2 → 78 loser rows deleted, 76 files quarantined to `SHELF1/Quarantine/rb-dedup-2026-09-14/` with receipt | ✓ 0 twins across 3,482 rows |
| F7 XML twins (SHELF1) | 2 playlists missing NODEs                                | `rb-playlist reconcile SHELF1 --apply --yes` → 2 NODEs added (hex Ids, RB7 format)                                                        | ✓ 166/166 rows twinned      |
| F1 incident signature | 0 matching rows in the local DB                          | none needed                                                                                                                               | ✓ already green             |

Backups before every write: `master.db.bak-20260914*` (4 dated copies).
User verification still open for F1: load a track, confirm 8 pads fire at
labeled IN/BODY/DROP/OUT positions (the doctor gate proves DB state; the pad
feel is the human half).

## 0b. Post-apply recovery + the missing sync half (Sep 14, later)

**rb-dedup over-reach, caught and fixed:** the F2 apply's fingerprint pairs
included 7 tracks whose "losers" were the only live copies (their renamed
twins had been quarantined in an earlier chain pass). Found via a full
files↔rows census (7 rows pointed at dead paths). 6 files restored from
`Quarantine/rb-dedup-2026-09-14/` and re-imported with full metadata from
the archive ledger; 1 (Habibi) was a true dupe with a live keeper. Doctor
gates re-verified green after.

**The comment gap explained and closed (`rb-comment-sync`, new command):**
the "no comments" mystery was a sync-order bug — intake rows were imported
into master.db BEFORE fulltags ever stamped comments, and nothing ever
synced them. One pass reads the TXXX (CAMELOT/ENERGY/MOOD) already on the
files + the archive.db mood ledger and writes the FullTags comment format,
never clobbering existing comments. Library-wide apply: 2,865 comments
written, coverage 12% → 99%, re-read verified, dated backup taken.
Genre/year/album backfill from the ledger in the same session: genre 56% →
90%, year 74% → 93%.

**Census after everything (live):** 3,481 rows ↔ 3,481 live files (0 dead
rows), comments 99%, genre 90%, year 93%, album 52%, artwork 62%. Doctor
F1/F2/F7 all green.

---

## 0. The two live bugs (user-reported Sep 13)

### BUG-1 — Hot-cue pads are not clickable ("wrong type of cue")

**Symptom:** pads in rekordbox don't behave as hot cues.

**Root cause (near-certain):** we wrote `djmdCue.Kind = 0`. In the RB6/7
collection DB, `Kind` distinguishes **0 = memory cue, 1 = hot cue** — the
opposite of the XML surface, where `POSITION_MARK Num="0..7"` = hot and
`Num="-1"` = memory (that XML convention is what
[grid-audit-plan.md](grid-audit-plan.md) §AC-05 documents, and I carried it
into the DB write incorrectly). pyrekordbox's own docstring ("Cue=0, …,
Load=3, Loop=4") is misleading — it describes the legacy DJM/CDJ cue types,
not the hot/memory split RB uses for pads.

**Fix (ticket F1):** re-stamp the ~1.7k semantic cues Kind 0 → 1 (rekordbox
closed, dated backup, verify with delayed re-read). Add a regression test that
asserts hot-cue writes use Kind=1. Confirm pad behavior in RB on 3 tracks
before/after. Verify Color semantics too (`ColorTableIndex` may need to match;
currently 0).

**Prevention:** every write to a rekordbox surface goes through a seam module
with a tested, documented constant set (F6). No more hand-rolled
`DjmdCue(...)` in one-off scripts — that's exactly how this class of bug
ships.

**Hardening found in the Sep 13 code audit (fold into F1/F3):**

- `rg DjmdCue src/ tools/` returns **nothing** — cue writing exists only in
  transcript heredocs. `src/fulltags/cues.ts` owns the ledger surface and its
  docstring correctly gates RB writes, but F3 has zero repo code to start
  from. F1's re-stamp must land as `src/rekordbox/rb-cues.ts` (shared by F1
  re-stamp and F3 command) or we re-commit the same bug via a third heredoc.
- `Kind` semantics — ✅ pinned: collection DB `Kind=1` = hot cue and
  `Kind=0` = memory cue (`Kind=2` is loop). The Sep 12 bug was not “Kind=0 is
  always invalid”; it was a narrow batch of semantic hot-cue rows written with
  memory-cue semantics. Regression-test the intended writer constant against a checked-in fixture: a tiny
  committed SQLite `djmdCue` sample (or a test snapshot of one RB-written
  row: `Kind=1, ColorTableIndex=0, Color=255, HotCue unset, Comment=label`)
  so the constant can't silently drift again.
- Label + color ride `Comment` (e.g. RB writes `'1.1Bars'`) and
  `ColorTableIndex`; our rewrite must populate `Comment` with the semantic
  label (`IN/BODY/DROP/OUT`) — pads show blank otherwise.

### BUG-2 — Duplicates still visible in rekordbox

**Where they came from (audit trail):**

1. `rb-import` inserted rows for files that ALREADY had rows (earlier imports),
   keyed only by path, not fingerprint. Same audio, different paths → two rows.
2. `organize` moved files into artist folders; the old intake-folder copies
   stayed on disk and new rows pointed at both.
3. Dupe-losers were quarantined but a handful of loser ROWS survived (the two
   `Janice [archive]` rows found Sep 12 were exactly this).

**Fix (ticket F2):** fingerprint-based dupe sweep as a real command
(`megadj rb-dedup`), not ad-hoc scripts: decode-and-chromaprint every pair of
rows sharing (normalized title + ±2s duration), keep the row whose file lives
in `Contents/<Artist>/`, delete loser rows + members, quarantine loser files
to collision-proof destinations within the selected mount, whole-table
verify. A title/duration match is only the cheap candidate prefilter; no
non-path-twin mutation proceeds without fingerprint equivalence. Run it;
then re-run after every future intake as a gate.

**Sep 13 code audit — the source hole is confirmed and narrow:**
`rb-import.ts` skip-check is **path/basename-only** (`FolderPath` exact +
basename map, lines ~90–140). Same file re-imported from a renamed folder
slips straight through → BUG-2 vector #1. F11's fingerprint gate fixes this;
until F11 ships, F2 is the only net. Also: `rb-import` idempotency key must
become (NFC+casefold path) OR fingerprint, not raw string — raw string
compare is how the case-variant path bug (F5) and dupes share a root cause.

---

## 1. What this marathon actually cost (why it took so long)

Reconstructed from the transcript (101 user messages, Sep 10–12) plus a
rev-3 sweep of all 38 workspace transcripts since Wed Sep 9:

| Cost driver                            | What happened                                                                                                                                                                                                                                                                                                              | Count        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Regressions from one-off scripts       | `ID3(p).save()` on AIFF corrupted ~300 files (twice); numeric SC genres re-baked twice; junk `AlbumName`/`FileType=0` rows                                                                                                                                                                                                 | 4 incidents  |
| Writing to rekordbox while it was open | RB's in-memory state silently reverted DB edits on quit (numeric genres "came back")                                                                                                                                                                                                                                       | 2 incidents  |
| No dry-run for destructive/atomic ops  | `unreferenced-strays` sweep swept 3 files whose rows pointed at them via case-variant paths; had to restore                                                                                                                                                                                                                | 1 incident   |
| Counting/method chaos                  | Reconciliations re-run ad hoc; unicode/case-insensitive path compare bugs; `4,427/3,369` stale numbers from an old canvas confused a whole session; the same confusion replayed in the playlist-gen session ("is our db out of sync? 3,369 vs 2,799?")                                                                     | n/a          |
| Cue surface guesswork                  | 11,601 phrase cues (27/track) written before asking what the pads need; then 8 evenly-spread ones; then semantic ones; **Kind field wrong the whole time**                                                                                                                                                                 | 3 rewrites   |
| Slow hashing scans                     | MD5-everything passes over ExFAT (~50 min each); naive fingerprint re-verify killed and redone with duration prefilter (50 min → 90 s)                                                                                                                                                                                     | 2 incidents  |
| Session forking on one workstream      | ≥6 concurrent transcripts edited the same intake/DB surfaces in the same window (header redesign ×4, intake ×3, hygiene, layout refactor, playlist-gen) — each re-derived the same census, re-hit the same traps, and several steps were redone across sessions (auto-relocate discovery, path repointing, comment format) | n/a          |
| Status-first violations                | Sessions started mutating before writing down where things stood; user asked "explain what you're doing / im lost" in at least 4 sessions                                                                                                                                                                                  | 4+ incidents |

**Meta-lesson:** nearly every incident = writing to a shared surface
(AIFF bytes, master.db, playlist XML) with hand-rolled code that bypassed an
existing gate or SSOT. The repo already knows these rules (AGENTS.md had to
grow 3 new traps during this work); the code paths didn't enforce them.
**Quantified (Sep 13 transcript audit):** this one marathon shipped ~36
`uv run python -c` / `python3 -c` heredoc scripts plus 4 dot-files in
`~/Music/` — every one a bypass of the gates below.

### BUG-2 vector #0 (rev 3) — the "123 missing files" incident (Sep 11)

The first RB import produced rows whose paths RB couldn't resolve (mixed
NFC/NFD + renamed batches); the user had to run **Relocate Lost Files by
hand** and later reported "43 missing". `rb-import` inserting rows with
unverified resolvable paths is the earliest dupe/missing vector: it created
the drift that later passes kept "discovering". F1's seam verification
(`verifyReRead`) must include a **path-resolves-on-disk check** for every
written row, not just a table re-read. (Related: issue #19 — reconcile
runbook as a command; issue #10 — fingerprint ledger as lost-file finder:
both now feed F2.)

---

## 2. Master fix list

Priority order. Each item: what + why + done-when.

### F1 — Fix hot-cue Kind (P0) — ✅ CODE + SHELF1 APPLY DONE (rev 5)

Re-stamp shipped as `megadj rb-cues <drive> --restamp --apply --yes`
(`src/rekordbox/rb-cues.ts`, `HOT_CUE_KIND = 1` + regression test asserting
the semantic hot-cue writer emits 1). The command scopes repair to the sacred
pre-repair backup's provenance signature: the incident's 14-minute creation
window, semantic labels/colors, NULL RB-authored fields, and a `Contents/`
path. SHELF1 executed Sep 14: 2,965 matching rows restamped; re-read verified
zero incident-signature rows remain. Legitimate memory cues stay Kind=0.
**Remaining done-when:** user loads a track and 8 pads fire at
IN/BODY/DROP/OUT positions with labels — the human half of the gate.

### F2 — `megadj rb-dedup` command (P0) — ✅ CODE + SHELF1 APPLY DONE (rev 5)

Shipped as `megadj rb-dedup <drive>` (report default) + `--apply --yes`
(`src/rekordbox/rb-dedup.ts`). Classifies same-path (TWO ROWS ONE FILE —
the rb-import re-insert hole; row-only fix, shared file never moves),
path-twin, and exact acoustic-fingerprint twins after a title/duration
prefilter; keeper = the Contents/ row. Mutation targets must remain inside the
selected mount, and quarantine names preserve same-basename losers instead of
overwriting them. SHELF1 executed Sep 14: 78 loser rows deleted, 76 files
quarantined with receipt, doctor `checkDupes` green (0 twins across 3,482
rows). Re-run after every future intake as a gate.

### F3 — `megadj rb-cues write` command (P0) — ✅ SURFACE SHIPPED (rev 5)

The command surface exists (`megadj rb-cues`, `--ledger` mode reserved) and
owns the restamp; the semantic-layout writer (plan §AC-05/§AC-06 gates,
`--force` replace, dry-run default) lands next on this same module — the
heredoc prototype (`~/Music/.cue-engine-prototype.py`) is retired only when
`rb-cues --ledger` reproduces its output.

### F4 — Kind-semantics research spike — ✅ DONE (rev 4, evidence below)

~~Before F1 ships~~ **Done Sep 13.** Read the RB7-written local
`~/Library/Pioneer/rekordbox/master.db` (rekordbox closed; DB opened
read-only via pyrekordbox with the deobfuscated key):

- Kind distribution in the sampled local DB: **Kind=1: 2,081 · Kind=2: 6 ·
  Kind=0: 0 (absent)**. That collection happened to contain no memory cues;
  absence was evidence about the incident sample, not a global semantic rule.
- Sample `Kind=1` row: `InMsec=138, InFrame=20, ColorTableIndex=0,
Color=255, ActiveLoop=0, HotCue=<unset>, Comment='1.1Bars'`.
- So the DB-side truth is: **1 = hot cue (pad-clickable), 0 = memory cue, 2 =
  loop cue**. The heredoc intended its semantic rows as hot cues but wrote
  Kind=0, so those incident rows were invisible to pads. `ColorTableIndex=0`
  is what RB itself writes — leave it.
  `Comment` is the pad label surface; `HotCue` stays unset on RB7 rows.
- Caveat honestly stated: this pins Kind/Color/Comment. The pads' _label
  index_ mapping (pad #1..8 order) rides `InMsec` ordering in RB7 (no
  explicit HotCue index on these rows) — F1's user verification on 3 tracks
  confirms labels show correctly before any batch re-stamp.

**F1 done-when (updated):** re-stamp `Kind 0→1` where the row came from our
intake writes (rekordbox closed, dated backup, delayed re-read), verify 3
tracks show clickable labeled pads in RB, then batch. The constant
`HOT_CUE_KIND = 1` lives in `src/rekordbox/rb-cues.ts` with a regression
test asserting no writer emits 0.

### F5 — Intake race + stale-count hygiene (P1) — ✅ SHIPPED as [`megadj intake-status`] (#238, Sep 18 2026)

- One `megadj intake-status` census: files-in-Contents ↔ DB rows ↔ archive.db,
  case/unicode-normalized (NFC + casefold), single source printed for the
  user. Kill the stale `4,427`-style canvases (mark superseded).
- `organize` must move-or-merge and update rows in the same transaction; the
  stray-sweep must check DB rows case-insensitively (the bug that ate 3 files).
- SHIPPED receipt (Sep 18 2026): `megadj intake-status [drive] [--json]` —
  the files ↔ archive.db census joins under NFC+casefold, reports
  case-variant twins as an explicit collision bucket, exits 1 on drift, and
  the optional master.db leg degrades to `available: false` (never a fake
  zero) when the drive is absent. This census is the count SSOT — retire any
  canvas or doc that still quotes its own reconcile numbers.

### F6 — One write-seam module per shared surface (P1) — ✅ SHIPPED (rev 5)

`src/rekordbox/guard.ts` landed with `assertRbClosed()` + `backupMaster()` +
`verifyReRead()` (+ `rekordboxRunning`, `fileExistsSafe`). Every NEW rb-*
command (rb-cues, rb-dedup, rb-playlist-reconcile) imports it — zero fresh
pgrep/backup re-rolls. **Remaining: DONE (verified 2026-09-17)** — the three
LEGACY copies (rb-import / rb-fix-paths / rb-playlist) all import
`rekordboxRunning`/`assertRbClosed` from the guard now; the only TS spawn
site is `guard.ts` (the `rb-command-kit.py` hit is a Python-side prompt
string, not a second spawn).

**Sep 13 audit — duplication already measured (this is the LOC cut):**

- `pgrep -x rekordbox` guard hand-rolled in **3 places**
  (`rb-import.ts:199`, `rb-fix-paths.ts:227`, `rb-playlist.ts:190`) — one
  `src/rekordbox/guard.ts` with `assertRbClosed()` + `backupDb()` +
  `verifyReRead()` deletes ~60 LOC and makes the RB-open gate un-bypassable.
  Backup helpers also duplicated (`rb-adopt.ts:459 backupName`).
- F6 done-when: `rg "pgrep" src/` matches exactly once. — ✅ verified
  2026-09-17 (single TS spawn site in `guard.ts`; all three legacy copies
  import the seam).

### F7 — Playlist XML twin maintenance (P1) — ✅ CODE + SHELF1 APPLY DONE (rev 5)

Shipped as `megadj rb-playlist reconcile <drive>` (`--apply --yes` to heal;
report default; both files backed up; DB row is the authority; internal
smart folders never touched). SHELF1 executed Sep 14: 2 NODEs added, doctor
`checkPlaylistXml` green (166/166). The current hardening also routes new
`rb-import` and `rb-playlist` playlist creation through one compensating seam:
back up DB + XML, keep IDs as decimal strings across Python/JSON, hex-encode
only the XML attributes, atomically replace XML, verify both twins, and
restore both backups if either half fails. **Remaining done-when:** next RB
open of the shelf DB shows zero "Playlist … not found" warnings.

**Sep 13 discovery (superseded by rev 5 + current hardening):** at the time,
`rg masterPlaylists6 src/ cratedeck/` returned zero hits: the XML twin was not
owned in the repo and the Sep-12 patch lived only in a transcript heredoc.
That evidence drove the reconciler and the shared DB/XML mutation seam; it is
historical diagnosis, not a current source census.

**Rev 5 — CRITICAL format discovery (shipped in `rb-playlist-reconcile.ts`):**
RB7's `masterPlaylists6.xml` stores NODE `Id`/`ParentId` as **HEX strings of
the DB's decimal IDs** (`Id="30D40"` = DB id 200000). Every prior attempt to
match DB rows against XML by string equality was comparing decimal to hex and
finding "missing" twins that were actually present (live proof: naive match
reported 156 missing; hex-aware match reports the true 19 — old user folders
RB lazily syncs). Also: `ParentId` is hex too, internal smart folders carry no
`Name` attribute and are DB-side by design (never "reconcile" them), and RB
syncs folders to XML lazily on open/edit — a missing folder NODE is normal
until RB next writes. Any XML write must: hex-encode ids, back up both files,
and keep the DB row as the authority.

### F8 — Performance guards (P1)

- Never full-hash an ExFAT volume for classification: size+duration prefilter,
  then hash only candidates. Encode in `shelf-dupescan`/dedup paths.
- `fpcalc` loops must prefilter by ±2.5 s duration (the 50 min → 90 s lesson).

### F8b — Shared JSON boundary guard (P2, LOC-negative + reliability)

120 `JSON.parse` sites across `src/`/`tools/`/`src/fulltags/` with **no shared
guarded parser** — the marathon's "silent undefined" debugging sessions (the
`MEGADJ_DB` env bug, the `cues_json` missing-key bug) were unguarded parses
at boundaries. One `safeParseJson<T>` in `src/shared/`, migrate the ~30
file/network boundary sites; leave trivial internal ones. Same bug class:
dead.

### F9 — Doc/status SSOT (P2)

- One live "census" doc section (or `megadj intake-status --md`) instead of
  canvases that rot. Canvases become snapshots with status headers (rule
  already exists — actually follow it).
- After every incident: AGENTS.md trap entry (done for SC-genre, AIFF,
  RB-write-gate; add: cue Kind, playlist XML twin).

**Sep 13 audit — the doc SSOT is already drifting:**
`docs/surface-parity.md` says "34 commands" (§rev-14 note) and "42 commands"
(surface table) in the same file; `src/usage.ts` census = 42. Hand-counted
numbers in docs are the stale-`4,427` failure mode in miniature — F5's
`intake-status` must derive counts from `src/cli.ts` dispatch, and the parity
table should be generated, not typed. Also: the `fulltags-mp3-backfill-plan`
canvas is stale (Sep 11, predates every fix) — mark superseded → point at
this doc.

### F10 — Finish the grid-audit plan properly (P2, the real answer to "like Mixed In Key")

The cue engine shipped is AC-03-lite. The plan's accuracy ladder says what
actually gets to MIK-killer quality: GA-00 gold set (30 hand-annotated
tracks), AC-01 structure labels, AC-02 bass/drums stems, AC-04 agreement gate,
AC-06b hardware check, AC-07 feedback loop. Nothing about cues is "done" until
AC-06b passes on hardware.

### F11 — dupe-prevention gate at intake (P2)

`rb-import` should refuse (or flag) inserting a row whose (title, duration
±2 s, fingerprint) matches an existing row, and require `--allow-dupe`.
Prevents BUG-2 class at the source.

### F12 — Heredoc/stray-file debt retirement (P1, cheap, do alongside F3)

The marathon left live state outside the repo:

- `~/Music/.cue-engine-prototype.py` — the only existing cue engine. F3 absorbs
  it into `src/rekordbox/rb-cues.ts`; delete the dot-file when the command
  reproduces its output.
- `~/Music/.{shelf-recon,quarantine-unmatched,rescue-verify,quarantine-rescued}*.json`
  — receipts for destructive ops. Per AGENTS.md state-belongs-in-DB: archive
  the receipts into `archive.db` (or `docs/` if they document decisions), then
  delete. Receipts in dot-files rot exactly like canvases.
- ~36 one-off `python -c` heredocs across the transcript — each fix they
  shipped must land in the owning command (F1/F2/F3/F7) or be written down in
  this doc as done-ad-hoc with the date. Rule going forward: **a fix that
  isn't in a command or a doc didn't happen.**

---

## 2b. Week-wide cross-reference (rev 3 — all 38 transcripts since Wed Sep 9)

Every issue from the week's sessions, mapped to where it lives now. If it's
not in this table it's either fixed-and-verified or lives in an open GitHub
issue.

**Fixed and verified in code this week (no ticket, do not re-do):**

- Beatport durationS "dead scoring" — **wired** (`beatport.ts:352-356`
  ±10s gate + ±2s bonus). The transcript finding is stale.
- Emoji/non-fleet char checker for CDJ/XDJ — **exists**:
  `booth-text.ts` `NON_FLEET_TEXT` classes + `player-compat.ts` +
  `megadj booth-fix` (user-selectable fleets landed: `471186a`).
- Numeric SC genres — hardened at both write points (`b588cc5`) + cache
  table; AGENTS.md trap added (`c3bbc76`).
- AIFF ID3 corruption + FORM-offset recovery — fixed, tested, documented
  (`d1690f5`).
- Per-dump dated subfolders at ingest — implemented (`ingest-register.ts`
  dated-batch layout).
- Tooltip clipping — `cratedeck/web/ui/tipPlace.ts` + portal test shipped.
- master→archive reconcile — `megadj rb-adopt` + `--shelf` repoint shipped
  (`c8f88d1`, `0c7e96e`); covers the playlist-gen session's "is our db out
  of sync" confusion. Census rule added to AGENTS.md (ledger ≠ library).
- `src/` domain layout refactor — shipped
  ([archive/src-layout-refactor.md](../archive/src-layout-refactor.md),
  ✅ COMPLETE).
- Set full-library pull + speed ("only 2 tracks? why 300 songs?") —
  `db3a66c`, `4b670ab`, `692111f`.

**Open — live GitHub state checked 2026-09-14:**

| Issue                                                                                                               | What                                           | Priority |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------- |
| [#47](https://github.com/webuildstuffio/megadj/issues/47)                                                           | MCP TOOLS registry from producers              | P1       |
| [#42](https://github.com/webuildstuffio/megadj/issues/42)                                                           | complexity Gini umbrella                       | P1       |
| [#38](https://github.com/webuildstuffio/megadj/issues/38)                                                           | remaining import cycles                        | P1       |
| [#35](https://github.com/webuildstuffio/megadj/issues/35)–[#37](https://github.com/webuildstuffio/megadj/issues/37) | shelf-hygiene phases 3–4 + remaining detectors | P1       |
| [#20](https://github.com/webuildstuffio/megadj/issues/20)                                                           | GetDat dated-dump UX picker                    | P1       |
| [#19](https://github.com/webuildstuffio/megadj/issues/19)                                                           | RB reconcile runbook as command                | P1       |
| [#10](https://github.com/webuildstuffio/megadj/issues/10)                                                           | dupescan ledger → lost-file finder             | P1       |
| [#9](https://github.com/webuildstuffio/megadj/issues/9)                                                             | Faithless/Greece 2000 truncated WAV twins      | P1       |

The original audit items [#39](https://github.com/webuildstuffio/megadj/issues/39)–[#41](https://github.com/webuildstuffio/megadj/issues/41),
[#43](https://github.com/webuildstuffio/megadj/issues/43)–[#46](https://github.com/webuildstuffio/megadj/issues/46),
[#48](https://github.com/webuildstuffio/megadj/issues/48), and
[#50](https://github.com/webuildstuffio/megadj/issues/50) closed on 2026-09-14;
their implementation evidence belongs in those issues and Git history.

**Open — no ticket yet, folded into this doc's fix list:**

- `megadj`/"megadjay"/CrateDeck header naming + product split — the four
  header sessions (Sep 8–10) ended in redesign; product naming split
  (megadj vs cratedeck vs getdat vs fulltags) still shows in the UI. Fold
  into the next web pass; low DJ-safety impact.
- AGENTS.md re-bloat watch: the "30% shorter" session (Sep 10) trimmed it;
  this week's fixes re-added 27 lines. The trim rule (traps only, link out)
  is in place — F9's census is the enforcement.
- Megamem `init` CLI/skill for new workspaces (Sep 11 session) lives in the
  megamem repo, not here — out of megadj scope, tracked there.
- `flip-master` naming: the USB rename session's code refs are gone from the
  repo (only AGENTS.md documents the rule now) — correct end state.

**Status-first rule (new, applies to every session):** before the first
mutating command of a session, run/print one census line (files ↔ rows ↔
ledger) and write one status sentence into the working doc/canvas. Half the
confusion incidents above were sessions re-deriving state that a previous
session already knew. `F5`'s `intake-status` makes the census line a single
command.

---

## 3. Sequencing

```
F4 ✅ F6 ✅ F1 ✅(apply) F2 ✅(apply) F7 ✅(apply)   ← rev 5, Sep 14
F3-remainder (rb-cues --ledger semantic writer, absorbs F12 prototype)
  → F6-remainder (migrate 3 legacy commands onto guard.ts)
  → F5/F8/F8b/F9  →  F10/F11
```

Order note (honored): F6's `guard.ts` landed _before_ F1's re-stamp executed —
the re-stamp was its first customer, proving the seam on the very op that
got burned.

## 3b. Exit gate — the plan is done when `megadj doctor` says so — ✅ LIVE (rev 5)

`src/shared/doctor-state.ts` ships the state checks; all three wired into
`runDoctor()` and **currently green on SHELF1**:

- `checkCueKinds` (F1): ✓ 0 provenance-matching incident rows; legitimate
  Kind=0 memory cues are not failures
- `checkDupes` (F2): ✓ 0 same-title twins across 3,482 rows (was 78 pairs)
- `checkPlaylistXml` (F7): ✓ 166/166 named rows twinned (was 2 missing)

Mechanics: one read-only pyrekordbox probe per doctor run; checks skip
honestly (`ok: true` + "skipped — reason") when the drive is unmounted or
rekordbox is open, so the gate can't false-red or race the app.
**Still to land:** F5's `checkCensus` (shelf files ↔ rows ↔ ledger) —
the "4,427 vs 3,369" class of confusion becomes a red/green line item.

That converts this doc from "tickets" to a **mechanically checkable
definition of done**.

## 4. Rules this doc adds to AGENTS.md (after F1 lands)

- `djmdCue.Kind`: DB-side hot cue = **1**, memory cue = **0**, loop = **2**.
  Repair only rows matching the known incident provenance; a global Kind=0
  census is not a health criterion. XML
  `POSITION_MARK` is the OPPOSITE convention (0..7 hot / −1 memory). Never
  mix the two.
- Playlist creation must update `masterPlaylists6.xml` + `djmdPlaylist`
  atomically via the seam.
- ExFAT classification: never full-hash first; prefilter, then hash.
- RB surfaces (`pgrep` guard, backup, re-read verify) come from one
  `src/rekordbox/guard.ts`; new rb- commands import it, never re-roll it.
- A fix shipped as a terminal heredoc must land in its owning command (or be
  documented here) before the session ends — heredoc-only fixes don't count
  as done.
