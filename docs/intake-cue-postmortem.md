# Postmortem & Master Improvement Plan — Sep 2026 intake/cue marathon

**Status:** ACTIVE plan. **Date:** 2026-09-13 (rev 3: audited ALL 38
transcripts since Wed Sep 9 + 19 open GitHub issues; added BUG-2 vector #0
(the auto-relocate incident), the issue cross-reference table, status-first
rule, session-fork cost row; marked Beatport durationS verified-fixed).
Rev 2: transcript + code audit pass — added F8b, F12; quantified heredoc
debt; confirmed rb-import dupe hole and XML-twin gap; recorded
guard-triplication LOC cut. **Scope:** everything that went wrong or slow in
the fulltags/rb-import/cue marathon (Sep 10–13) and the surrounding week's
sessions, plus the two open bugs the user still sees (duplicate tracks;
hot-cue pads not clickable). This is the working list to burn down. Product
rules live in [PRINCIPLES.md](PRINCIPLES.md); this doc owns the *lessons +
tickets*.

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
- `Kind` semantics still undocumented in-repo. F4's spike output must include
  a checked-in fixture: a tiny committed SQLite `djmdCue` sample (or a test
  snapshot of one RB-written row) so the constant is regression-tested, not
  folklore.
- The cue rewrite also must set `ColorTableIndex` (currently written 0) and
  `CueMicrosec`; pads show blank labels/colors otherwise — same class of
  "wrote the row, surface ignores it".

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
in `Contents/<Artist>/`, delete loser rows + members, quarantine loser files,
whole-table verify. Run it; then re-run after every future intake as a gate.

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

| Cost driver | What happened | Count |
|---|---|---|
| Regressions from one-off scripts | `ID3(p).save()` on AIFF corrupted ~300 files (twice); numeric SC genres re-baked twice; junk `AlbumName`/`FileType=0` rows | 4 incidents |
| Writing to rekordbox while it was open | RB's in-memory state silently reverted DB edits on quit (numeric genres "came back") | 2 incidents |
| No dry-run for destructive/atomic ops | `unreferenced-strays` sweep swept 3 files whose rows pointed at them via case-variant paths; had to restore | 1 incident |
| Counting/method chaos | Reconciliations re-run ad hoc; unicode/case-insensitive path compare bugs; `4,427/3,369` stale numbers from an old canvas confused a whole session; the same confusion replayed in the playlist-gen session ("is our db out of sync? 3,369 vs 2,799?") | n/a |
| Cue surface guesswork | 11,601 phrase cues (27/track) written before asking what the pads need; then 8 evenly-spread ones; then semantic ones; **Kind field wrong the whole time** | 3 rewrites |
| Slow hashing scans | MD5-everything passes over ExFAT (~50 min each); naive fingerprint re-verify killed and redone with duration prefilter (50 min → 90 s) | 2 incidents |
| Session forking on one workstream | ≥6 concurrent transcripts edited the same intake/DB surfaces in the same window (header redesign ×4, intake ×3, hygiene, layout refactor, playlist-gen) — each re-derived the same census, re-hit the same traps, and several steps were redone across sessions (auto-relocate discovery, path repointing, comment format) | n/a |
| Status-first violations | Sessions started mutating before writing down where things stood; user asked "explain what you're doing / im lost" in at least 4 sessions | 4+ incidents |

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

### F1 — Fix hot-cue Kind (P0, blocks everything cue-related)
Re-stamp semantic cues to `Kind=1`. Test in RB: pads clickable, labels/colors
visible. Add `cue-kind` constant + regression test. **Done when:** user loads a
track and 8 pads fire at IN/BODY/DROP/OUT positions.

### F2 — `megadj rb-dedup` command (P0, user still sees dupes)
Fingerprint dupe sweep as reusable command (see §BUG-2). Rows-only triage mode
(`--report`) + apply mode. **Done when:** user's RB shows zero same-audio
dupes; command exits 0 on a clean DB and lists offenders otherwise.

### F3 — `megadj rb-cues write` command (P0)
The cue engine exists only as a heredoc in a terminal log. Promote to a real
command: inputs = ledger + RB DB; layout = plan §AC-05; gate = §AC-06
(monotonic, bar-snapped, drop ≥ 32 or flagged); `--force` to replace;
dry-run default. Refuse while RB runs; backup; verify. **Done when:** the
Sep-12 heredoc reproduces byte-identical cue rows via the command.

### F4 — Kind-semantics research spike (P0, 30 min, do FIRST)
Before F1 ships: get one RB7-written reference DB (import 1 track, set 2 hot
cues + 1 memory cue by hand, read `djmdCue` back) and pin down Kind /
ColorTableIndex / CueMicrosec / HotCue index for pads. Write findings into
[grid-audit-plan.md](grid-audit-plan.md) §0.3. **Done when:** the doc states
the DB-side truth with evidence, and F1's stamp uses it.

### F5 — Intake race + stale-count hygiene (P1)
- One `megadj intake-status` census: files-in-Contents ↔ DB rows ↔ archive.db,
  case/unicode-normalized (NFC + casefold), single source printed for the
  user. Kill the stale `4,427`-style canvases (mark superseded).
- `organize` must move-or-merge and update rows in the same transaction; the
  stray-sweep must check DB rows case-insensitively (the bug that ate 3 files).

### F6 — One write-seam module per shared surface (P1, prevents the whole §1 table)
- `fulltags/src/rb-write.ts` (or py seam): backup → refuse-if-RB-open → write
  → delayed re-read verify. Every RB mutation goes through it. Delete ad-hoc
  `uv run ... DjmdCue(...)` patterns (encode as lint/agent rule).
- Same for AIFF tag writes (already fixed in `writer.ts` — keep the regression
  tests) and playlist XML (F7).

**Sep 13 audit — duplication already measured (this is the LOC cut):**
- `pgrep -x rekordbox` guard hand-rolled in **3 places**
  (`rb-import.ts:199`, `rb-fix-paths.ts:227`, `rb-playlist.ts:190`) — one
  `src/rekordbox/guard.ts` with `assertRbClosed()` + `backupDb()` +
  `verifyReRead()` deletes ~60 LOC and makes the RB-open gate un-bypassable.
  Backup helpers also duplicated (`rb-adopt.ts:459 backupName`).
- F6 done-when: `rg "pgrep" src/` matches exactly once.

### F7 — Playlist XML twin maintenance (P1)
`masterPlaylists6.xml` and `djmdPlaylist` rows must be written together by one
seam (we hit "Playlist not found in XML" 40+ times). Command: `rb-playlist
reconcile` — diffs DB vs XML, adds missing NODEs, reports orphans. **Done
when:** creating a playlist via the seam produces zero warnings on next RB
open.

**Sep 13 audit:** `rg masterPlaylists6 src/ cratedeck/` → **zero hits**. The
XML twin isn't read or written anywhere in the repo — the Sep-12 XML patch was
another transcript heredoc. `rb-playlist.ts` already owns the DB side
(526 LOC); extend it with the XML half (`reconcile` verb on the existing
module), not a 7th `rb-*` command.

### F8 — Performance guards (P1)
- Never full-hash an ExFAT volume for classification: size+duration prefilter,
  then hash only candidates. Encode in `shelf-dupescan`/dedup paths.
- `fpcalc` loops must prefilter by ±2.5 s duration (the 50 min → 90 s lesson).

### F8b — Shared JSON boundary guard (P2, LOC-negative + reliability)
120 `JSON.parse` sites across `src/`/`tools/`/`fulltags/` with **no shared
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
- `src/` domain layout refactor — shipped (`docs/src-layout-refactor.md`,
  ✅ COMPLETE).
- Set builder full-library pull + speed ("only 2 tracks? why 300 songs?") —
  `db3a66c`, `4b670ab`, `692111f`.

**Open — already ticketed (work happens via these issues, not new scopes):**
| Issue | What | Priority |
|---|---|---|
| [#41](https://github.com/nichm/megadj/issues/41) | deckctl complexity outlier + drain invariant | P0 |
| [#40](https://github.com/nichm/megadj/issues/40) | jobs.ts executeInner 418-LOC split | P0 |
| [#39](https://github.com/nichm/megadj/issues/39) | cli.ts main() dispatch table | P0 |
| [#38](https://github.com/nichm/megadj/issues/38) | 4 import cycles | P1 |
| [#43](https://github.com/nichm/megadj/issues/43) | DB god class split (57 members) | P1 |
| [#48](https://github.com/nichm/megadj/issues/48) | cross-tier code twins (hygiene, archive_similar) | P1 |
| [#44](https://github.com/nichm/megadj/issues/44) | untested high fan-in cluster | P1 |
| [#46](https://github.com/nichm/megadj/issues/46) | web imports CLI internals (TipCard→anlz-spike) | P1 |
| [#47](https://github.com/nichm/megadj/issues/47) | MCP TOOLS registry from producers | P1 |
| [#45](https://github.com/nichm/megadj/issues/45) | DrivePage/App extraction | P1 |
| [#42](https://github.com/nichm/megadj/issues/42) | complexity Gini umbrella | P1 |
| [#35](https://github.com/nichm/megadj/issues/35)–[#37](https://github.com/nichm/megadj/issues/37) | shelf-hygiene phases 3-4 + remaining detectors | P1 |
| [#20](https://github.com/nichm/megadj/issues/20) | GetDat dated-dump UX picker | P1 |
| [#19](https://github.com/nichm/megadj/issues/19) | RB reconcile runbook as command (feeds F2) | P1 |
| [#10](https://github.com/nichm/megadj/issues/10) | dupescan ledger → lost-file finder (feeds F2) | P1 |
| [#9](https://github.com/nichm/megadj/issues/9) | Faithless/Greece 2000 truncated WAV twins | P1 |
| [#50](https://github.com/nichm/megadj/issues/50) | boundary-safety census gate (overlaps F8b) | P2 |

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
F4 (spike, 30 min)  →  F1+rb-cues.ts (re-stamp Kind)  →  user verifies pads
F2 (rb-dedup)       →  user verifies collection clean
F3 (rb-cues cmd, absorbs F12 prototype)  →  F6 guard.ts + F7 XML verb
                     →  F5/F8/F8b/F9  →  F10/F11
```

Order note: F6's `guard.ts` lands *before* F1's re-stamp executes — the
re-stamp should be its first customer, proving the seam on the very op that
got burned.

## 4. Rules this doc adds to AGENTS.md (after F1 lands)

- `djmdCue.Kind`: DB-side hot cue = 1, memory = 0 (verify in F4 first) — XML
  `POSITION_MARK` is the OPPOSITE convention. Never mix the two.
- Playlist creation must update `masterPlaylists6.xml` + `djmdPlaylist`
  atomically via the seam.
- ExFAT classification: never full-hash first; prefilter, then hash.
- RB surfaces (`pgrep` guard, backup, re-read verify) come from one
  `src/rekordbox/guard.ts`; new rb- commands import it, never re-roll it.
- A fix shipped as a terminal heredoc must land in its owning command (or be
  documented here) before the session ends — heredoc-only fixes don't count
  as done.
