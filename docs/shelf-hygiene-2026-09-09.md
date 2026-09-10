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

---

## 5. DETAILED IMPLEMENTATION PLAN

A concrete, file-by-file build guide. Each phase ends with a green gate
(`bun run check:full` + `bun test`) before the next starts. Roughly one
phase per sitting; phases 1–2 are pure backend (no UI risk), 3–4 are the
product surface.

### Phase 0 — Groundwork (half a day)

**Goal:** the findings ledger exists and every check can be expressed as
a pure function over it.

**0.1 `src/hygiene/types.ts`** (new, leaf module — no `src/` imports, so
CrateDeck can share it without import cycles; wire types that reach the
web are re-exported from `cratedeck/shared/types.ts` per the DAG rule).

```ts
export type FindingKind =
  | "byte-twin" | "acoustic-twin" | "folder-variant" | "spelling-typo"
  | "truncated-name" | "zero-byte" | "appledouble-junk"
  | "stale-pointer" | "orphan-audio" | "re-download";

export type Severity = "safe" | "likely" | "review" | "info";

export type FindingStatus =
  | "open"        // detected, undecided
  | "confirmed"   // user said yes (pending apply)
  | "dismissed"   // user said no — never re-surface unless evidence changes
  | "applied"     // executed (moved to quarantine)
  | "failed";     // apply attempted, errored (kept for inspection)

export interface Finding {
  id: string;              // uuid
  kind: FindingKind;
  severity: Severity;
  status: FindingStatus;
  /** every path involved. [0] = keeper/proposal, rest = losers/sources */
  paths: string[];
  bytes: number[];         // parallel to paths
  md5s: (string | null)[]; // computed lazily, cached here
  fps: (string | null)[];  // fpcalc, cached from shelf_fingerprints
  evidence: Record<string, unknown>; // check-specific: bitrate, token-set, editDist…
  proposedAction:
    | { type: "quarantine-loser" }
    | { type: "merge-folders"; into: string; renames: Record<string, string> }
    | { type: "rename"; to: string }
    | { type: "delete-corrupt" }
    | { type: "clean-junk" }
    | { type: "info" }
    | { type: "re-download"; query: string };
  keeperPath: string | null;
  /** volume sentinel at detection time — apply aborts if it changed */
  walkToken: string;
  autoSafe: boolean;       // severity==="safe" && kind allows auto
  createdAt: string;
  decidedAt: string | null;
  appliedAt: string | null;
  validation: ValidationReceipt | null;
}

export interface ValidationReceipt {
  ranAt: string;
  keepersPresent: number;
  keepersMissing: string[];
  fpMismatches: string[];
  shelfDelta: { before: number; after: number; quarantined: number };
  ok: boolean;             // all three consistent
}
```

**0.2 `src/hygiene/store.ts`** — `HygieneStore` class over the archive DB
(same DB as `ShelfSweeps`/`FpCache`; follow `src/shelf_sweeps.ts` for
style — plain `bun:sqlite`, prepared statements, `close()`).

```sql
CREATE TABLE IF NOT EXISTS hygiene_findings (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  paths TEXT NOT NULL,          -- json[]
  bytes TEXT NOT NULL,          -- json[]
  md5s TEXT,                    -- json[]
  fps TEXT,                     -- json[]
  evidence TEXT,                -- json object
  proposed_action TEXT NOT NULL,
  keeper_path TEXT,
  walk_token TEXT NOT NULL,
  auto_safe INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  applied_at TEXT,
  validation TEXT               -- json ValidationReceipt | null
);
CREATE INDEX IF NOT EXISTS idx_hygiene_status ON hygiene_findings(status, kind);
-- dedupe key so re-runs UPDATinstead of duplicating:
CREATE UNIQUE INDEX IF NOT EXISTS idx_hygiene_natural
  ON hygiene_findings(kind, keeper_path, json_extract(paths, '$[1]'));
```

API: `upsert(findings)`, `list({status?, kind?, severity?})`,
`decide(id, confirm: boolean)`, `markApplied(id, receipt)`,
`dismissWhereEvidenceChanged(...)`. Findings are **immutable evidence +
mutable status** — if a re-run computes different evidence for the same
natural key, it updates evidence and resets status to `open` (a dismissed
finding only re-opens when its fingerprint set changed).

Tests: in-memory DB roundtrip, status machine transitions, natural-key
upsert dedupe, evidence-change re-open logic.

### Phase 1 — Check engine: `megadj shelf-hygiene` (1–2 days)

**Goal:** one command produces/refreshes findings; `--apply --yes`
executes confirmed `safe` items; everything else waits.

**1.1 `src/hygiene/walk.ts`** — extract the walk already duplicated in
`shelf-dupescan.ts`/`shelf-archive.ts` into one shared module:
`walkShelf(volume, { skip: [".dupescan-quarantine", "PIONEER*"] }) →
AsyncIterable<ShelfFile>` where `ShelfFile = { path, bytes, mtimeMs }`.
Excludes `._*`, `.DS_Store`, `PIONEER*`. Returns the **walk token**:
`sha1(JSON.stringify({fileCount, totalBytes, maxMtime}))` — the
change-sentinel used to abort stale applies.

**1.2 Check modules** — one file per check, each exporting
`detect(volume, walk, ctx): Promise<Finding[]>` where
`ctx = { md5(p), fp(p) (cached), dbRowLookups }`:

| File | Reuses (proven this session) |
|---|---|
| `checks/byte-twin.ts` | same-size index → md5 groups (the `/tmp/same-size-cands.json` flow, now in-repo) |
| `checks/acoustic-twin.ts` | fp comparison + quality rank (`qualityRank` from `shelf-dedupe.ts`) |
| `checks/folder-variant.ts` | token-set matcher + the curated merge list from this session as seeds |
| `checks/spelling-typo.ts` | edit-distance ≤2, simple names, **collab-marker exclusion regex** |
| `checks/zero-byte.ts` | walk-time flag |
| `checks/appledouble-junk.ts` | walk-time flag |
| `checks/stale-pointer.ts` | device DB rows (via `cratedeck/python/rb_read.py` seam) vs walk |
| `checks/orphan-audio.ts` | inverse of stale-pointer |
| `checks/re-download.ts` | manual-entry + ledger-stale matches (issue #11 shape) |

Checks run **in priority order and short-circuit**: a file claimed by
`byte-twin` is not re-reported by `acoustic-twin` (finder-seen set).
Each detector writes findings with `walkToken` and `autoSafe` computed
centrally: `autoSafe = severity==="safe" && action is quarantine/clean`.

**1.3 `src/commands/shelf-hygiene.ts`** — the command shell:
- `shelf-hygiene` — detect + upsert findings, print summary JSON
  (`{ byKind, bySeverity, walkToken, newFindings, reopened }`).
- `--apply --yes` — executes **only** `confirmed` findings (web/CLI sets
  status first) whose `walkToken` matches a fresh walk; per finding:
  re-md5 keeper+loser right before move (`rename` into
  `.dupescan-quarantine/`, collision-suffixed), then
  `validation = validateApply(...)` (Phase 4 function), status `applied`/
  `failed`. Progress via the standard `tick(done, total)` convention.
- `--kind X --severity Y` filters, `--json` contract (enforced by the
  `json-summary.test.ts` census — add it there).
- Sync-writes stay sync (FullTags perf rule): no `bun -e` bridges.

Tests: hermetic shelf fixtures (the ffmpeg-tone trick from
`shelf-dupescan.test.ts`), one per check: detection truth, apply moves +
receipt, stale-walk abort, md5-mismatch abort, quarantine-collision
suffixing.

### Phase 2 — CrateDeck API + job (1 day)

**Goal:** findings readable/drivable over HTTP; detection + apply run as
regular jobs with SSE progress.

**2.1 `cratedeck/src/hygiene_reader.ts`** — read-only window into
`hygiene_findings` (pattern: `shelf_sweep_reader.ts` — dedicated
readonly Database, degrade to empty on missing/corrupt, never 500).

**2.2 API routes** in `cratedeck/src/index.ts` (follow existing route
style, all JSON, all timeouts ≤30s — heavy work goes through jobs):

```
GET  /api/hygiene?status=&kind=&severity=   → Finding[] + counts
POST /api/hygiene/scan                      → enqueue hygiene-scan job
POST /api/hygiene/decide                    → {id, confirm} (batch: ids[])
POST /api/hygiene/apply                     → enqueue hygiene-apply job (confirmed only)
POST /api/hygiene/restore                   → {ids[]} quarantine → original path
POST /api/hygiene/quarantine/empty          → {confirm:"DELETE"} literal
```

- `hygiene-scan` job kind: runs the Phase-1 detector, `tick(progress, 1)`
  spans per check, emits SSE `job` events (existing pipeline gives the
  dock staleness/ETA for free).
- `hygiene-apply` job: Phase-1 apply path. Job budget + stall watchdog
  apply automatically (they watch progress fraction — keep ticks honest).
- Decisions are **synchronous small writes** (no job needed) — the frozen
  selection is just `status='confirmed'` rows at enqueue time.

**2.3 Wire-shape SSOT**: `Finding` re-exported in
`cratedeck/shared/types.ts`; `driveListPayload` gains an optional
`hygiene: { open: number, safe: number, review: number, info: number }`
summary badge per shelf drive (parity: deckctl + MCP get
`hygiene_summary` too, or an exemption row in `docs/surface-parity.md`).

Tests: route contract tests with a fixture DB; parity census updates.

### Phase 3 — Web UI (1–2 days)

**Goal:** the review/confirm/validate loop, DOM-verified before push.

**3.1 New product section** on the shelf drive page (component dir
`cratedeck/web/products/cratedeck/hygiene/`):
- `HygienePanel.tsx` — verdict banner (two-thirds law): counts by
  severity + GB reclaimable + one primary button per tier
  ("Review 312", "Apply 955 safe", "Open queue").
- `FindingsQueue.tsx` — virtua-virtualized list, worst-severity first;
  each row: kind badge, evidence chips (md5✓ / fp✓ / Δbytes / bitrate),
  both paths truncated per truncation rules, Copy-button fix command.
- `FindingDetail.tsx` — the confirm dialog:
  - acoustic-twin: quality compare table (size, bitrate, fp-equal chip),
    "keep A / keep B" radio, ear-review note;
  - folder-merge: union-tree preview with collision renames before/after;
  - re-download: the yt-dlp command + Copy;
  - every dialog states the exact consequence ("moves 1 file to
    quarantine — recoverable").
- `QuarantinePanel.tsx` — N files / X GB, per-row restore, restore-all,
  empty (type-DELETE confirm).
- `ValidationReceipt.tsx` — the green "0 orphans" receipt component;
  amber on any mismatch with per-file links.

**3.2 Behaviors**
- All mutations via `apiPost` (FormData rule irrelevant here, but keep
  the 30s default timeout; scan/apply go through jobs, not requests).
- Batch select with per-page "select all safe" — but apply always
  re-verifies server-side (UI selection is never trusted for safety).
- i18n/labels come from `shared/help.ts` additions (SSOT tooltips +
  `deckctl help hygiene`) — deckctl gains a `hygiene` verb docs block so
  `deckctl help` stays the same SSOT for the UI glossary (surface-parity
  test enforced).

**3.3 DOM verification (hard rule):** rebuild `web/dist`, drive the live
server via CDP, dump DOM for: banner counts, one dialog open/confirm,
apply → receipt render, restore flow. Screenshot secondary; DOM is
authority (color-mix quirk).

Tests: component smoke tests where the repo has patterns for them; else
DOM-dump verification documented in the PR.

### Phase 4 — Validation receipts + rekordbox handoff (1 day)

**4.1 `src/hygiene/validate.ts`** — `validateApply(applied: Finding[])`:
1. re-stat every keeper (exists, size matches receipt);
2. re-fp every quarantined loser vs keeper (cache-busted live fpcalc on
   the quarantine copy) — any mismatch = `fpMismatches`;
3. shelf file-count delta == `applied.length` — else `shelfDelta` fails;
4. `ok = keepersMissing.empty && fpMismatches.empty && delta ok`.
On `!ok`: findings flip to `failed`, an SSE toast fires, and the panel
offers one-click **revert** (move losers back — quarantine layout makes
this a rename).

**4.2 rekordbox handoff** — after any `applied` finding with path
changes, the drive page shows the #7 runbook fragment (Missing File
Manager → Relocate → re-export; counts must match) + a "Run verify"
button that enqueues `deckctl run SHELF1 verify` and renders the delta
against the pre-hygiene verify snapshot.

### Phase 5 — Restore + re-download (from #10/#11) (1 day)

- `shelf-restore` CLI + `/api/hygiene/restore`: quarantine path →
  original path (stored in the finding), fp-verified on arrival.
- `re-download` findings: kind `re-download` with `query`, surfaced in
  the same queue; "copy yt-dlp command"; a `done` checkbox stores the
  restored path. (Auto-downloading is out of scope — the archive DB only
  records intent.)

### Phase 6 — Docs/skills/parity closeout (half a day)
- `.claude/skills/shelf-intake/SKILL.md` gains the hygiene step;
  `docs/usb-sync.md` pipeline section; `docs/FEATURES.md` one-liner;
  `cratedeck/deckctl.md` verb; surface-parity rows; this doc's §4/§5 get
  a "SHIPPED" stamp with deltas.

### Test matrix (all phases, run with `bun test --parallel=16`)
| Suite | Covers |
|---|---|
| `src/hygiene/*.test.ts` | store, walk token, each check, apply, validate |
| `cratedeck/test/hygiene-reader.test.ts` | corrupt/missing DB degrade |
| `cratedeck/test/hygiene-api.test.ts` | routes, batch decide, restore |
| `cratedeck/test/surface-parity.test.ts` | deckctl/MCP/web parity rows |
| `src/commands/json-summary.test.ts` | `--json` contract census |

### Explicit non-goals
- No auto-download of music (re-download = command generation only).
- No writes to rekordbox DBs (handoff stays instructional; issue #7).
- No background auto-apply without a human confirm — `safe` items
  auto-**quarantine** at most, and even that is a visible, reversible
  finding the user sees in the feed.
- No second source of truth: findings/quarantine live in the archive DB
  + filesystem, never in JSON exports that drift.
