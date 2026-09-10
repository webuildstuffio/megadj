# Shelf Hygiene & Dedupe — Sep 9 2026 Session

Full record of everything done in this session: the data work on SHELF1,
the commands shipped, the traps hit, and — most importantly — the spec for
wiring this whole flow into CrateDeck as an **automated check + user
review/confirm/validate** feature instead of chat-driven scripts.

## 1. What this session actually did (chronological)

### 1.1 Whole-shelf acoustic duplicate scan
- `megadj shelf-dupescan` fingerprinted **4,635 audio files** on SHELF1
  (fpcalc/chromaprint, 120s analysis window, results cached in the
  `shelf_fingerprints` ledger in the megadj archive DB).
- Found **969 duplicate groups** — 1,271 redundant copies, 38.9 GB —
  regardless of filename or folder (byte-equal, same-name twins,
  cross-folder matches, long-mix fingerprint collisions).

### 1.2 Quarantine-apply (byte-verified, human-gated)
- Shipped `--quarantine --yes` (two-step safety) and `--only-identical`
  (restrict to md5-proven copies) on `shelf-dupescan`.
- Applied: **955 byte-identical copies** moved into
  `Contents/.dupescan-quarantine/` — never deleted.
- **Full MD5 audit after apply: 0 orphans** — every quarantined file has a
  byte-identical twin still on the shelf; 969/969 group keepers intact.
- 312 items left for human review (same-recording/different-encode +
  long-mix suspects). AppleDouble `._` forks that exFAT materialized into
  the quarantine dir were segregated into `_appledouble-junk/`.

### 1.3 YTMusic Liked cleanup (user-directed deletion)
- Missing File Manager confusion resolved first: the 419 "missing" tracks
  were **stale DB pointers, not lost files** — audit proved every flagged
  track exists on disk (e.g. Faithless/Greece WAVs live under truncated
  exFAT names with zero DB rows).
- Deleted **28 meme/tutorial/reel files** from the YT folders against an
  exact user-approved list (Juice WRLD + all mixes explicitly kept).
- One collateral loss: "Eat Me Better" (nimino) — all 3 ledger copies were
  stale/deleted. Recovery = re-download, runbook in issue #11.
- Merged `YT Music Liked/` (5 files) into `YTMusic Liked/`; removed the
  empty folder → exactly one live YT folder. Removed byte-identical
  Rockabye/Marea twins and a zero-byte `.tagged.m4a` corrupt artifact.
  Folder now: 37 clean files.

### 1.4 Artist-folder consolidation (per-case, manual, triple-checked)
- Sweep 1 (token-set matching over 2,087 folders): **14 same-artist
  variant pairs** — `Robin S`/`Robin S_`, `SEGA x Young M.A`-style
  separator flips, a Unicode-hyphen `a‐ha`, `[unknown]`/`Unknown`, etc.
  All 14 merged (17 album dirs relocated, renamed only on collision).
- Spot check (user): `ANOTR x 54 Ultra` vs `ANOTR, 54 Ultra` — same track
  both sides, 11-byte size diff, **fpcalc-identical** → smaller re-encode
  quarantined, folders merged.
- Sweep 2 (edit-distance ≤2 on simple artist names, collab folders
  excluded): 228 raw candidates → **6 true typo pairs**, each manually
  inspected before merging:
  - `Missy Elliot` → `Missy Elliott`
  - `Talor Swift` → `Taylor Swift`
  - `Tame Impara` → `Tame Impala` (files self-labeled the typo)
  - `Charlie Xcx` → `Charli Xcx` (correct artist spelling)
  - `Teodoro` → `Téodoro` (missing accent)
  - `Flowervillain` → `Flowervillian`
- Deliberately **left separate** (similar names, different artists):
  Anthony B vs Anthony P_, Cassian vs Kassian, Adam F vs Adam K, Belly vs
  Nelly, and the 3-letter-code cluster. Edit distance alone is a trap —
  every decision was made on album contents and genre, not spelling.
- Residue sweep: **9,949 AppleDouble `._` forks** + empty husk dirs
  removed; one zero-byte `.tagged.m4a` husk deleted (Trap City Mix —
  re-download candidate alongside Eat Me Better).

### 1.5 File-level dedupe passes
- Byte-twin pass: 379 same-size groups MD5'd → **55 suffix-twin losers**
  quarantined (6 identical-but-distinctly-named pairs kept deliberately).
- Acoustic pass: 330 different-bytes same-size groups fingerprinted →
  **320 groups acoustically identical** → 321 losers quarantined
  (largest/best-quality kept); **10 groups genuinely different recordings
  kept both**.
- Triple-check: 19 quarantined losers re-verified with **live fpcalc**
  against their keepers → 0 mismatches.
- Quarantine total: **1,703 files / 35.1 GB**, fully recoverable.

### 1.6 End state
- Shelf live audio: **3,748 files**, 2,087 folders, zero same-name
  variants, zero same-basename collisions, one YT folder.
- Verify still red **only** on the known rekordbox desyncs (57 moved
  YTMusic rows + 70 export.pdb drift) — user-side fix tracked in #7.
- Quarantine awaiting user "empty it" decision (~35 GB reclaim).

## 2. Issues filed
| # | Subject |
|---|---------|
| [#7](https://github.com/webuildstuffio/megadj/issues/7) | Rekordbox reconcile runbook (57 dead rows, pdb drift, re-export) |
| [#8](https://github.com/webuildstuffio/megadj/issues/8) | YT-folder consolidation state + execution record |
| [#9](https://github.com/webuildstuffio/megadj/issues/9) | Truncated-name WAV twins (Faithless/Greece 2000) |
| [#10](https://github.com/webuildstuffio/megadj/issues/10) | `shelf-restore` tool + trash-first deletes proposal |
| [#11](https://github.com/webuildstuffio/megadj/issues/11) | Re-download "Eat Me Better" (nimino) |

## 3. Traps hit (encode these in the feature)
1. **Stale snapshots lie.** The 14 MB dossier manifest predated cleanup and
   miscounted by 100+ files. Always re-walk the live volume before batch ops.
2. **Same size ≠ same content** (291 BANGERS files proved it) and **same
   fingerprint ≠ same bytes** — both axes must be checked, in the right
   order (md5 first: cheap and decisive).
3. **exFAT truncates/mangles names** (Faithless WAVs, a U+2010 hyphen in
   `a‐ha`). Name matching is necessary but never sufficient; fingerprints
   decide.
4. **Edit distance is a trap**: Akn/Ama/Arn, Belly/Nelly, Cassian/Kassian
   are different artists. Human review with album/genre context is
   mandatory for anything not byte/fingerprint-proven.
5. **os.remove bypasses the Trash** — "Eat Me Better" became unrecoverable.
   Destructive ops must default to a recoverable quarantine, never delete.
6. **Deletions need a frozen keep-list approved BEFORE execution.** The
   user changed their mind about one file after the fact.
7. **exFAT materializes `._` AppleDouble forks lazily** — they pollute
   walks and quarantine dirs; filter `._`/`.DS_Store` everywhere.

## 4. THE FEATURE: wire this flow into CrateDeck

Turn this session's ad-hoc flow into a first-class product surface:
**Shelf Hygiene** — an automated check pipeline with user
review/confirm/validate at every destructive step. Nothing is ever deleted
without an explicit human confirm in the UI.

### 4.1 Architecture (follows repo invariants)
- **Check engine** lives in megadj CLI (`src/commands/shelf-hygiene.ts`),
  driven by the same primitives as `shelf-dupescan`/`shelf-dedupe`
  (md5, fpcalc + `shelf_fingerprints` cache, NFC+casefold matching).
  Always `--json`-first (agent-first contract), runs async as a CrateDeck
  job (never blocking the server; obey job budget/stall watchdog rules).
- **Findings ledger** in the archive DB: `hygiene_findings` table —
  `id, kind, severity, status, paths (json), sizes, md5s, fps, evidence,
  proposed_action, keeper_path, created_at, decided_at, decided_by`.
  Status machine: `open → confirmed → applied` or
  `open → dismissed`; `auto` flag marks provably-safe items.
- **CrateDeck API** (`/api/hygiene/...`): list findings, confirm/dismiss,
  apply (moves to quarantine, never deletes), restore-from-quarantine,
  empty-quarantine (double-confirm). Reuses the existing job runner +
  SSE events so the dock shows live progress.
- **Web UI**: a new tab/section on the shelf drive page — see 4.3.

### 4.2 The automated checks (each maps to work already proven this session)
| Check | Auto-verdict rule | Human gate |
|---|---|---|
| `byte-twin` | same size + same md5 | none — auto-quarantine safe (loser has proven twin); still shown in a review feed |
| `acoustic-twin` | same fp, different bytes | **required** — show quality compare (size/bitrate/waveform), user picks keeper |
| `folder-variant` | token-set equality OR manual curation list (the 20 shipped this session) | required for anything beyond exact token match |
| `spelling-typo` | edit distance ≤2, simple names only | **required** — never auto-merge; show both folders' albums/genres |
| `truncated-name` | DB row basename ≈ disk file (fp match) | required — offers rename + DB-relink instructions |
| `zero-byte/corrupt` | size 0 or unhashable | auto-flag, user confirms delete (they may want to re-download instead) |
| `appledouble-junk` | `._`/`.DS_Store` | auto-clean, logged |
| `stale-pointer` | DB rows whose exact path is gone but basename+fp exists elsewhere | informational → feeds the rekordbox relocate checklist |
| `orphan-audio` | disk files with zero DB rows (like Faithless/Greece) | informational → import-or-ignore decision |

Severity tiers: `safe` (byte-proven), `likely` (fp-proven), `review`
(name-similar), `info`. **Only `safe` items can ever be auto-applied.**

### 4.3 UX: review → confirm → validate loop
1. **Verdict banner** (two-thirds UX law): "Shelf hygiene: 1,271 duplicate
   copies found · 955 provably safe · 312 need your ear · 35 GB
   reclaimable" + a primary action per tier.
2. **Fix-first work queue, worst first**, each row: evidence chips
   (md5✓ / fp✓ / size / bitrate), both paths, and its exact
   `megadj`/`deckctl` fix command with a Copy button.
3. **Confirm dialogs with real evidence**: for acoustic twins show both
   files' duration/bitrate/spectral snapshot and a "play both" affordance;
   for folder merges show the union tree preview with collision
   resolutions before/after.
4. **Apply = quarantine by default.** Big undo affordance
   (restore-from-quarantine) next to every applied row + a global
   "Quarantine (N files · X GB)" panel with Restore-all / Empty
   (double-confirmed, type-to-confirm "DELETE").
5. **Validate after apply**: auto-run the post-apply audit that this
   session ran manually — re-md5 keepers (present?), re-fp losers vs
   keepers (0 mismatches?), shelf file-count delta == quarantined count.
   Show a green "0 orphans" receipt; any failure reverts + alerts.
6. **Sweep ledger in DB, not markdown**: every run records to
   `shelf_sweeps`/`hygiene_findings` so state is queryable and surfaces in
   the drives tab (already partially shipped via `shelf_sweeps` verdict
   strip).
7. **Re-download queue**: files the user wants kept but that are gone
   (Eat Me Better) become `re-download` findings with a ready `yt-dlp`
   command + Copy button.
8. **rekordbox handoff**: after any path changes, show the exact
   Missing-File-Manager/Relocate/re-export runbook (issue #7) with
   expected verify deltas, and a "re-run verify" button.

### 4.4 Guards (from this session's traps)
- Fresh walk immediately before every apply; abort if the live volume
  changed since the findings were computed (mtime/count sentinel).
- One finding = one decision record; batch apply requires a frozen
  selection snapshot (the "frozen keep-list" rule).
- All moves within the same volume (`rename`), quarantine first, delete
  never (empty-quarantine is the only true delete, double-confirmed).
- fpcalc results cached in `shelf_fingerprints`; md5 recomputed at apply
  time (cheap, decisive).
- `._`/`.DS_Store`/`PIONEER*` excluded from every walk.
- Concurrency: findings table is the SSOT — web, CLI, and MCP all read it;
  no markdown state.

### 4.5 Ship order
1. `hygiene_findings` table + engine port (checks from 4.2, reusing
   proven code paths) + `megadj shelf-hygiene --json`.
2. API + job integration (SSE progress, budget/watchdog rules).
3. Web UI: verdict banner → queue → evidence confirm dialogs →
   quarantine panel with restore.
4. Post-apply validation receipts + verify handoff (#7 integration).
5. `shelf-restore` (#10) + re-download queue (#11) as finding kinds.
