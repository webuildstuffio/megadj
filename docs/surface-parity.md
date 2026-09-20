# Surface Parity — CLI ↔ MCP ↔ UI

**Status:** ✅ CURRENT — parity contract and census source of truth.

**The rule ([PRINCIPLES.md](PRINCIPLES.md) §1, made testable):** every
capability exposed on one surface must be reachable on the other two —
CLI (`megadj` + `deckctl`), MCP (`bun run mcp`), and the web UI — **or
carry an explicit, recorded exemption** in §4 of this doc. A gap without
an exemption row is a bug; `cratedeck/test/surface-parity.test.ts`
fails the build on it.

## Revision history

- rev-44 (2026-09-19): user-marked skips — the pending download queue is now reviewable before sync runs it. NEW CLI verb: `megadj skip <video_id…>` (marks rows skipped_not_music with a `user-marked` category — sticky across playlist refreshes, sync's queue excludes them permanently). NEW routes: `GET /api/archive/pending-queue` (what sync WOULD download, source + attempts), `POST /api/archive/skip?id=` (through the engine CLI — §4-A1 mutation rule). NEW UI: PendingQueueCard atop the Backlog tab with per-row "not music" buttons + in-place refresh. First live user: the miniature-airport video marked out of the liked queue. 51 → 52 commands, 78 → 80 routes, 61 → 63 UI calls.
- rev-45 (2026-09-19): surfaced-link checklist — the link-first cohort becomes a WORKFLOW. NEW CLI verb: `megadj surfaced-note <video_id…> [--undone]` (flips `tracks.surfaced_done_at`, gated to `link_surfaced` rows). NEW routes: `POST /api/archive/surfaced-note` {id, done} (checkbox), `POST /api/archive/surfaced-batch` {folder, ids} (runs the REAL `megadj ingest <folder> --json` engine — dated intake folder, tags, art, dedupe — then marks the checked rows done). WIRE: `ingest-status` surfaced rows now carry `url` + `links` (parsed `source_links`) + `done`/`done_at` instead of prose `detail`. NEW UI: SurfacedLinksCard rebuilt — each URL a clickable anchor (bare domain, no "purchase_url" label), per-row done checkbox, and a batch-finalize row (editable folder field, default `~/Music/DJ-Downloads`) in the Backlog context. 52 → 53 commands, 80 → 82 routes, 63 → 65 UI calls.
- rev-43 (2026-09-19): #35/#36/#20 — hygiene quarantine closes its loop + dumps get a ledger. NEW CLI verbs: `shelf-restore-all`, `shelf-quarantine` (N files/X GB census), `shelf-quarantine-empty --yes` (deletes recoverable copies, flips applied → archived; receipt kept). NEW routes: `POST /api/hygiene/restore`, `POST /api/hygiene/restore-all`, `GET /api/hygiene/quarantine`, `POST /api/hygiene/quarantine/empty` (literal `{confirm:"DELETE"}` gate), `GET /api/intake/dumps`. NEW MCP tool: `getdat_intake {action?,folder?,dry_run?}` (dump census / process). NEW UI: QuarantinePanel (census + restore-all + typed-confirmed empty) + failed-row Revert in the Hygiene tab; IntakeDumps strip in GetDat ⌗ Intake. §4-R1 retired — restore/empty are now first-class surfaces (engine-owned CLI, web is a remote control). Dump ledger = `intake_dumps` in archive.db, written by ingest itself (one dump = one dated batch folder, #20 acceptance: same-day dumps stay distinct, a partial 17/18 outcome is representable). 48 → 51 commands, 43 → 44 tools, 73 → 78 routes.
- rev-25 (2026-09-15): MegaSet rename — verb/route/tool renamed (`megadj megaset`, `/api/archive/megaset`, `megaset_propose`); census unchanged.
- rev-26 (2026-09-16): #42 split — `/api` dispatch moved to `api_routes.ts` (census reads its exact-table keys); `/events/` trailing-slash spelling restored + 406 negotiation pinned by e2e. 63 → 64 routes (the restored alias).
- rev-27 (2026-09-16): #143 registry — megadj help/census SSOT is `src/command-registry.ts` (`COMMAND_DOCS`); `usage.ts` renders from it; census + help cross-check off the one table. 45 commands unchanged (the stale duplicate `rb-comment-sync --limit` help block — a flag the arm never parsed — is the one removed line).
- rev-28 (2026-09-16): #47 producer split — `getdat_ingest`/`getdat_convert` moved to `getdat_tools.ts` (mcp.ts is pure assembly: deriveDeckTools + archiveTools + getdatTools); `archiveTools()` typed `Record<string, ToolDef>`; the deck parity census derives exactly from `DECK_MCP_SURFACES`. 41 tools unchanged.
- rev-29 (2026-09-16): #104 — MegaSet payload gains `metadata_only` + `excluded_groups` (B1 offline pool, B13 exclusion shape); all three surfaces read the same wire contract, no new params, census counts unchanged.
- rev-30 (2026-09-16): #106 Phase D — MegaSet steps gain `mixInCue`/`mixOutCue` (8-bar phrase windows derived from the cues ledger, nearest to the 45 s intro/outro handoff targets); M3U8 export renders them as `#EXTREM` comments; `rb-playlist` dry-run reports per-step cue windows (`cueWindows`); arc-chart hover cards carry the windows. No new routes/tools/params; census counts unchanged.
- rev-31 (2026-09-16): #10 — `shelf-dupescan --json` summary gains `generatedAt` + `contentsDir` provenance stamps (a saved dossier self-identifies; stale reports can't read as current). Additive keys only; no census change.
- rev-32 (2026-09-16): #148 new-music radar — `deckctl radar [drive]`, `deck_radar {drive?}`, `/api/fleet/radar`, Fleet ⌗ Radar tab over the same pure delta (cratedeck/src/radar.ts). 23 → 24 verbs, 41 → 42 tools, 64 → 65 routes.
- rev-33 (2026-09-16): #167 grid health (GA-05c) — `grid-health` job kind (deckctl run / deck_run), `GET /api/grid-health` + `POST /api/grid-health/scan`, and the drive-page card (Archive tab) rendering the triage buckets worst-first with per-row fix commands + freshness line. 65 → 67 routes.
- rev-34 (2026-09-17): audit gaps G2+G3 closed — §2d matrix completed (every census command now has a row; 16 were missing when the Sep 14 audit found them), and §4-A1 cites `MAINTENANCE_VERBS` instead of a hand-enumerated verb list. Both drift classes are parity-test-pinned. 45 → 46 commands, 42 → 43 tools, 67 → 68 routes (#215's `genre-why` CLI verb + `archive_genre_why` tool + `/api/archive/genre-why` route, matrix row added).
- rev-35 (2026-09-17): audit gaps G4+G5 closed — §1's Web UI cell is now source-derived (54 distinct `/api/` endpoint families called from `cratedeck/web/`, counted by the parity test across the api/apiPost/fetch/EventSource call sites + the useScanApply `actionPath` props; the old "~22 actions" was a hand approximation), and every UI-called family is asserted to exist in the route census (a UI button pointing at a non-route is now a red build). G5 (regate help omitting `--detector`) was fixed by the help-flag census. The route census itself gained the three regex/fall-through arms it could not see: `GET /api/drives/:id` (the `!sub` detail arm), `POST /api/drives/:id/notes/:id/dismiss` (the noteMatch regex), and `GET /api/fleet/prep` (the fleet router's fall-through tail). 68 → 71 routes.
- rev-36 (2026-09-17): #208 plugin audit — `plugin/` is a **packaging wrapper, not a fourth surface**: 96 unique LOC (4 files) whose skills are git symlinks (mode 120000) into `.claude/skills/` and whose MCP/hook entries shell out to the SAME `cratedeck/src/mcp.ts` / `deckctl` the rows above govern. Audited KEEP (2026-09-17, evidence in the issue): wiring verified live (MCP handshake + 43-tool `tools/list`; SessionStart hook `deckctl status --json` returns a valid payload), but NOT installed in `~/.claude/plugins/installed-plugins.json` and no Cursor MCP entry — dormant packaging, zero surface drift risk by construction (it can only re-expose the audited MCP). Every plugin capability is covered by the CLI/MCP rows in §1; no parity rows change.
- rev-37 (2026-09-17): #215 live-run pass — `fetch` job kind (the Genre tab's Run view): `POST /api/fetch/start` (same job engine as intake: interlock, one-at-a-time, cancel) + `GET /api/fetch/feed` (the run's vote-ladder event ring: per-track votes + elections, streamed from megadj fetch --json's stderr `@event` protocol). megadj CLI and the KIND_DOCS/HELP_JOBS rows unchanged in count (the new kind reuses the run verb family); 71 → 73 routes, 54 → 56 UI calls.
- rev-38 (2026-09-18): #236 — `megadj tmp-purge [--apply] [--all] [--json]`, the stale-fixture sweep for the OS tmpdir (the cratedeck-* test-fixture leak measured at 16k dirs / 2.6 GB Sep 18; known-prefix-only, age-gated >24h by default, read-only without `--apply`). CLI-only by §4-A1 (host filesystem hygiene, nothing archive-or-drive-shaped to expose); 46 → 47 commands.
- rev-39 (2026-09-18): #238 (postmortem F5) — `megadj intake-status [drive] [--json]`, the ONE reconciled census: files on disk ↔ archive.db rows joined under NFC+casefold (the case-variant path class that ate 3 files in the unreferenced-strays incident now reads as a match, and a true twin reports as a case-collision bucket instead of being silently absorbed); drift = exit 1; optional master.db leg degrades to an explicit `available: false` when the drive is absent — an honest gap, never a zero. Kill-the-canvas: this command is the count SSOT the stale-`4,427` failure mode was missing. 47 → 48 commands.
- rev-42 (2026-09-18): #147 Q4 armament — `rb-anlz-spike set-grid` ships the direct ANLZ PQTZ rewrite (`rewriteAnlzGrid` in src/fulltags/anlz.ts: byte-exact container walk, only the grid span moves). Dry-run default; `--apply --yes` writes behind the rb-fix-paths pattern (automatic pre-edit backup, whole-file re-verify = decode-back equals requested beats AND non-PQTZ section sizes intact, else auto-restore). Accepts compare-style keys (`collection/...`, `usb/P001/<hash>/...`), mount-relative, or absolute paths; refuses path escapes and gridless sidecars with zero writes. Runbook Q4 updated with the exact commands (its "first person" clause discharged); execution log still BLOCKED on the four hands-on RB observations. CLI help + parity row updated in-pass.

- rev-40 (2026-09-18): `tmp-purge --state` tier — the same host-hygiene command now sweeps `~/.local/state/megadj`: superseded dated `archive.db` backups (newest lineage snapshot per stem KEPT — measured 5 superseded ≈118 MB on Sep 18), orphan SQLite `-shm`/`-wal` sidecars (lsof-guarded), age-gated `spike/` artifacts. The live DB matches no removable class by construction; dry-run default unchanged. No census change (same verb).
- rev-41 (2026-09-18): #247 — the deck server is launchd-managed: `bun run deck:install` (ops/deck-install.ts + ops/deck-service.ts SSOT) renders the `com.nick.megadj-deck` plist (KeepAlive + RunAtLoad, non-default ports baked as env), replaces bare orphans, and health-probes; `megadj doctor` gains the `deck-service` check (installed-running / installed-stopped / orphan / absent verdicts from ONE classifier) whose fix hint names the right repair. No census change (doctor/init rows already counted).

The full prose of all 27 revisions lives in Git history
(`git log --follow -- docs/surface-parity.md`) per §5 — this doc keeps
the live contract only. New capability changes still announce themselves
in the commit message; the census numbers in §1 always come from source
via the test, never from prose.

---

## 0. Current parity status

There are no unexempted gaps. Counts come from source and are pinned by
`cratedeck/test/surface-parity.test.ts`; the current census is in §1 and the
deliberate exemptions are in §4. Historical repair details belong in
[the agent playbook](agent-playbook.md) and Git history, not a second backlog.

---

## 1. The three surfaces, as they stand

| Surface    | Entry points                                                      | Count                  |
| ---------- | ----------------------------------------------------------------- | ---------------------- |
| megadj CLI | `megadj <cmd>` (`src/cli.ts`)                                     | 53 commands + `--help` |
| deckctl    | `bun run cratedeck/src/deckctl.ts <verb>`                         | 24 verbs               |
| MCP        | `bun run mcp` (`mcp.ts` + `archive/tools.ts` + `getdat_tools.ts`) | 44 tools               |
| HTTP API   | `cratedeck/src/index.ts` + `api_routes.ts` (localhost:7742)       | 82 routes              |
| Web UI     | `cratedeck/web/` (hash-routed pages)                              | 6 pages, 65 UI calls   |

The server's HTTP API is the **fourth surface** and the seam everything
converges on: deckctl and MCP are HTTP clients of it, and the UI talks to
it directly. Parity therefore has a natural hub-and-spoke shape — a
capability that reaches the API is one thin wrapper away from every
surface. That is the enforcement insight: **parity is cheapest to
guarantee at the API, and the spokes exist to expose it, not to own it.**

## 2. Capability × surface matrix (the audit)

Legend: ✅ reachable · ⛔ deliberate exemption (§4) · ❌ TRUE GAP.

### 2a. Drive operations

| Capability                  | CLI (deckctl)                   | MCP                                 | UI                            | Verdict                             |
| --------------------------- | ------------------------------- | ----------------------------------- | ----------------------------- | ----------------------------------- |
| List drives + state         | `status` / `drives` ✅          | `deck_status`/`deck_drives` ✅      | rail ✅                       | —(GAP-12 closed: `GET /api/status`) |
| Drive report / health       | `report` ✅                     | `deck_report` ✅                    | Health tab ✅                 | —                                   |
| Run scan                    | `run <d> scan` ✅               | `deck_run` ✅                       | Scan button ✅                | —                                   |
| Run verify                  | `run <d> verify` ✅             | `deck_run` ✅                       | Verify button/tab ✅          | —                                   |
| Run benchmark               | `run <d> benchmark` ✅          | `deck_run` ✅                       | Benchmark button ✅           | —                                   |
| Run speedtest               | `run <d> speedtest` ✅          | `deck_run` ✅                       | Speed probe button ✅         | —                                   |
| Run checksum                | `run <d> checksum` ✅           | `deck_run` ✅                       | Checksum button ✅            | —                                   |
| **Run mirror**              | `run <d> mirror` ✅             | `deck_run` ✅                       | Mirror button ✅ (role-gated) | — (GAP-1 closed)                    |
| Job list / history          | `jobs` ✅                       | `deck_jobs` ✅                      | JobsDock ✅                   | —                                   |
| Cancel job                  | `cancel <id>` ✅                | `deck_cancel` ✅                    | JobsDock cancel ✅            | —                                   |
| Stop server                 | `stop` ✅                       | ⛔ §4-P1 (clients don't kill hosts) | ⛔ §4-P2                      | —                                   |
| Verify doc (explain)        | `explain [kind]` ✅             | `deck_explain` ✅                   | VerifyTab help ✅             | —                                   |
| In-app help (glossary/tour) | `help [term]` ✅                | `deck_help {term?}` ✅              | tooltips + Welcome tour ✅    | — (GAP-10 closed)                   |
| Export dossier              | `report --dossier [--out F]` ✅ | `deck_report {format:"dossier"}` ✅ | Export button ✅              | —(D1 closed)                        |

### 2b. Fleet queries

| Capability           | CLI                          | MCP                          | UI                            | Verdict                                                  |
| -------------------- | ---------------------------- | ---------------------------- | ----------------------------- | -------------------------------------------------------- |
| Coverage matrix      | `coverage` ✅                | `deck_coverage` ✅           | Fleet page ✅                 | —                                                        |
| Redundancy audit     | `redundancy` ✅              | `deck_redundancy` ✅         | Fleet page ✅                 | —                                                        |
| Fleet diff           | `diff A B` ✅                | `deck_diff` ✅               | Fleet page ✅                 | —                                                        |
| New-music radar      | `radar [drive]` ✅           | `deck_radar` ✅              | Fleet ⌗ Radar tab ✅          | — (#148: v1 copy-only, never an auto-write)              |
| Grid health (GA-05c) | `run <shelf> grid-health` ✅ | `deck_run` ✅                | Archive ⌗ Grid health card ✅ | — (#167: triage read + queue; repair writer stays GA-06) |
| Track locations      | `coverage` output ✅         | via `deck_coverage` ⛔ §4-F1 | Fleet page ✅                 | —                                                        |
| Global search        | `search <q>` ✅              | `deck_search {q}` ✅         | ⌘K ✅                         | — (F2 closed)                                            |

### 2c. Gig-night + agent layer

| Capability                 | CLI                                                     | MCP                                                   | UI                                      | Verdict              |
| -------------------------- | ------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------- | -------------------- |
| Preflight verdict          | `preflight` ✅                                          | `deck_preflight` ✅                                   | Fleet ⌗ Preflight tab ✅                | — (G1 closed)        |
| Player compat              | `players [d]` ✅                                        | `deck_players` ✅                                     | Preflight tab (per-drive expand) ✅     | — (G1 closed)        |
| Booth fleet settings       | `booth [set IDs]` ✅                                    | `deck_booth {ids?}` ✅                                | Fleet ⌗ Booth tab ✅ (citations inline) | —                    |
| Booth fixes queue          | `fixes [scan\|apply]` ✅                                | `deck_fixes {action?}` ✅                             | Drive ⌗ Fixes tab ✅                    | —                    |
| Hygiene queue              | `hygiene [scan\|apply\|confirm\|dismiss]` ✅            | `deck_hygiene {action?}` ✅                           | Drive ⌗ Hygiene tab ✅                  | —                    |
| Restore hygiene quarantine | `megadj shelf-restore <finding-id\|path> [--into F]` ✅ | via `/api/hygiene/restore` ✅ (rev-43: §4-R1 retired) | Hygiene tab — QuarantinePanel Revert ✅ | —                    |
| Weekly digest              | `prep [--out]` ✅                                       | `deck_prep` ✅ (markdown; `--out` stays CLI)          | Fleet ⌗ Prep tab ✅                     | —(G2 closed)         |
| Agent notes feed           | `note`/`notes` ✅                                       | `deck_note`/`deck_notes` ✅                           | Timeline cards ✅                       | — (GAP-3 closed)     |
| Note dismissal             | `dismiss <d> <id>` ✅                                   | `deck_dismiss` ✅                                     | Timeline dismiss ✅                     | — (GAP-11/12 closed) |
| Job attribution (O87)      | jobs show `[origin]` ✅                                 | stamps `mcp:<session>` ✅                             | timeline chips ✅                       | —                    |

### 2d. Archive (GetDat/FullTags) operations

| Capability                                        | CLI (megadj)                                                                                                                                                                                                         | MCP                                                                                                       | UI                                                                         | Verdict                                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| sync / status / list / retry / adopt              | ✅ `adopt --shelf [--apply]` repoints moved-file rows at shelf copies                                                                                                                                                | ⛔ §4-A1 (archive writes stay CLI)                                                                        | ⛔ §4-A1 (Intake drives `ingest` only, as a CLI spawn)                     | —                                                                             |
| ingest / fetch / enrich / artwork / audit / years | ✅                                                                                                                                                                                                                   | `getdat_ingest` ✅; reads only (`archive_*`) for the rest                                                 | ingest: GetDat ⌗ Intake ✅; fetch/audit reads ✅                           | —                                                                             |
| archive WAV→AIFF conversion                       | `megadj convert` ✅                                                                                                                                                                                                  | `getdat_convert` ✅ (async CLI seam; JSON summary)                                                        | GetDat ⌗ Intake / FullTags pipeline ✅                                     | —                                                                             |
| beats / mood / cues                               | ✅                                                                                                                                                                                                                   | ⛔ §4-A1                                                                                                  | ⛔ §4-A1                                                                   | —                                                                             |
| organize                                          | ✅                                                                                                                                                                                                                   | ⛔ §4-A1                                                                                                  | ⛔ §4-A1                                                                   | —                                                                             |
| doctor / init                                     | `megadj doctor [--json]` / `megadj init` ✅ (doctor now carries the `deck-service` launchd/orphan check, #247)                                                                                                       | ⛔ §4-A2 (host setup is human work)                                                                       | ⛔ §4-A2                                                                   | — (`bun run deck:install` = the installer the doctor's fix hint names)        |
| Archive search                                    | `megadj list` ✅                                                                                                                                                                                                     | `archive_search_tracks` ✅                                                                                | ⌘K + GetDat ⌗ Library ✅                                                   | —(A3 closed)                                                                  |
| Track stats                                       | `status`/`list` ✅                                                                                                                                                                                                   | `archive_track_stats` ✅                                                                                  | FullTags ⌗ Beatgrids/Mood cards ✅                                         | —(A3 closed)                                                                  |
| Ingest status / LOWQ queue                        | `list LOWQ` ✅                                                                                                                                                                                                       | `archive_ingest_status`/`lowq_queue` ✅                                                                   | GetDat ⌗ Pipeline/Backlog ✅                                               | — (A3 closed (product split))                                                 |
| Source diff                                       | —                                                                                                                                                                                                                    | `archive_source_diff` ✅                                                                                  | GetDat ⌗ Sources                                                           | —                                                                             |
| Grid cross-check                                  | `megadj beats` data ✅                                                                                                                                                                                               | `archive_grid_cross_check` ✅                                                                             | FullTags ⌗ Beatgrids ✅                                                    | — (A3 closed (product split))                                                 |
| Mood profile                                      | `megadj mood` data ✅                                                                                                                                                                                                | `archive_mood_profile` ✅                                                                                 | FullTags ⌗ Mood ✅                                                         | — (A3 closed (product split))                                                 |
| Similar tracks (I49 sounds-like)                  | `megadj similar <id> [--space raw\|whitened]` ✅                                                                                                                                                                     | `archive_similar_tracks` ✅ (space param)                                                                 | FullTags ⌗ Similar ✅                                                      | —                                                                             |
| MegaSet proposal                                  | `megadj megaset [--preset --minutes --opener --limit --search]` ✅ (`setbuild` alias retired Sep 15 2026)                                                                                                            | `megaset_propose` ✅ (propose-only; `search` A/B param)                                                   | MegaSet product (#/megaset) + saved draft/M3U8 download ✅ (Sequencer row) | — (same read-only proposal; requested/actual duration stays explicit)         |
| Set-build → master playlist                       | `megadj rb-playlist [drive] [--preset …] [--apply --yes]` ✅                                                                                                                                                         | ⛔ §4-A1 (master-DB mutation stays CLI)                                                                   | ⛔ §4-A1                                                                   | — (links existing content rows; dry-run predicts the link count)              |
| Rekordbox master → archive census                 | `megadj rb-adopt [drive] [--apply --yes]` ✅                                                                                                                                                                         | ⛔ §4-A1 (archive DB mutation stays CLI)                                                                  | ⛔ §4-A1                                                                   | — (master read-only; exact Content-ID cross-reference + full metadata mirror) |
| Cue ledger                                        | `megadj cues` data ✅                                                                                                                                                                                                | `archive_cue_ledger` ✅                                                                                   | FullTags ⌗ Cues ✅                                                         | —                                                                             |
| Library overview (FullTags mirror)                | `megadj fetch`/`audit` data ✅                                                                                                                                                                                       | `archive_library_overview` ✅                                                                             | FullTags ⌗ Tags + GetDat ⌗ Library ✅                                      | —                                                                             |
| Skip census (why rows didn't land)                | `megadj list` buckets ✅                                                                                                                                                                                             | `archive_skip_census` ✅                                                                                  | GetDat ⌗ Pipeline (decisions card) + Backlog ✅                            | —                                                                             |
| Surfaced links (link-first cohort, #256)          | `megadj surfaced-note` flips the checklist; `ingest` is the batch ✅                                                                                                                                                 | ⛔ §4-A1 (`POST /api/archive/surfaced-note` + `surfaced-batch` drive the CLI)                             | GetDat ⌗ Pipeline + Backlog — SurfacedLinksCard (anchors + checkbox) ✅    | — (rev-45)                                                                    |
| Source census                                     | `megadj list` sources ✅                                                                                                                                                                                             | `archive_sources` ✅                                                                                      | GetDat ⌗ Sources (tag chips feed the diff form) ✅                         | —                                                                             |
| Analysis coverage                                 | `megadj beats`, `mood`, and `cues` counts ✅                                                                                                                                                                         | `archive_analysis_coverage` ✅                                                                            | FullTags header meters (one progress picture) ✅                           | —                                                                             |
| Tag census (FullTags ↔ rekordbox mirrors)         | `megadj audit` + `rb-adopt` data ✅                                                                                                                                                                                  | `archive_tag_census` ✅                                                                                   | FullTags ⌗ Tags ✅ (tab)                                                   | — (DB mirrors only; files never read on the census path)                      |
| Tag compare (one track, three sources)            | `megadj status <id>` + file tags ✅                                                                                                                                                                                  | `archive_tag_compare` ✅ (live file ground truth)                                                         | FullTags ⌗ Tags track view ✅                                              | — (file = truth; one ffprobe+mutagen read per request)                        |
| Archive integrity sweep                           | Prep digest (`archive integrity` section) ✅                                                                                                                                                                         | `archive_sweep` ✅                                                                                        | Fleet ⌗ Prep (digest section) ✅                                           | — (D30)                                                                       |
| Rename drive                                      | `rename <d> [nick]` ✅                                                                                                                                                                                               | `deck_rename` ✅                                                                                          | inline rename ✅                                                           | —(D2-rename closed)                                                           |
| Set drive photo                                   | —                                                                                                                                                                                                                    | ⛔ §4-D2 (human picks the art)                                                                            | Photo tab ✅                                                               | —                                                                             |
| Genre inference + eval + refold + disputes        | `megadj genre [--apply/--eval/--refold/--flag/--disputes]` ✅                                                                                                                                                        | ⛔ §4-A1 (ledger write stays CLI)                                                                         | ⛔ §4-A1                                                                   | —                                                                             |
| Genre vote explainability (#215)                  | `megadj genre-why <video_id>` ✅                                                                                                                                                                                     | `archive_genre_why` ✅ (readonly read of the same ledger)                                                 | FullTags ⌗ Genre Why ✅ (tab)                                              | —                                                                             |
| One-shot intake (download → organize)             | `megadj drop <folder-or-url>` ✅                                                                                                                                                                                     | ⛔ §4-A1                                                                                                  | ⛔ §4-A1 (Intake drives the pipeline stages, not `drop`)                   | —                                                                             |
| Tag structure / booth-text health                 | `megadj tag-check` ✅ · `megadj booth-fix [--apply --yes]` ✅                                                                                                                                                        | ⛔ §4-A1 (booth-fix renames files)                                                                        | Drive ⌗ Fixes tab renders the booth queue ✅                               | —                                                                             |
| Shelf dedupe (drive twins)                        | `megadj shelf-dedupe [--apply --yes]` ✅                                                                                                                                                                             | ⛔ §4-A1 (quarantine moves stay CLI)                                                                      | ⛔ §4-A1                                                                   | —                                                                             |
| Shelf fingerprint dupescan                        | `megadj shelf-dupescan [--quarantine --yes]` ✅                                                                                                                                                                      | ⛔ §4-A1                                                                                                  | ⛔ §4-A1                                                                   | —                                                                             |
| Archive dedupe (DJ-Imports)                       | `megadj dedupe-archive [--apply --yes]` ✅                                                                                                                                                                           | ⛔ §4-A1                                                                                                  | ⛔ §4-A1                                                                   | —                                                                             |
| Hygiene sweep + confirm/dismiss + apply           | `megadj shelf-hygiene [--confirm/--dismiss/--bucket/--apply --yes]` ✅                                                                                                                                               | `deck_hygiene {action?}` ✅ (CrateDeck tier)                                                              | Drive ⌗ Hygiene tab ✅ (listen-first checks refuse remote batch-confirm)   | —                                                                             |
| Quarantine restore (one / all) + census + empty   | `megadj shelf-restore <finding-id\|path>` ✅ · `megadj shelf-restore-all` ✅ · `megadj shelf-quarantine [--json]` ✅ · `megadj shelf-quarantine-empty --yes` ✅ (rev-43: rows flip applied → archived, receipt kept) | via `/api/hygiene/restore\|restore-all\|quarantine[/empty]` ✅ (engine-owned CLI, web remote-controls it) | Drive ⌗ Hygiene tab — QuarantinePanel ✅ (typed-confirmed empty)           | —                                                                             |
| Drive→shelf archive sweep                         | `megadj shelf-archive [volumes] [--into F] [--trashes] [--deep]` ✅                                                                                                                                                  | ⛔ §4-A1 (bulk file moves stay CLI)                                                                       | ⛔ §4-A1 (CrateDeck records sweeps, never drives them)                     | —                                                                             |
| Sweep ledger (drive→shelf history)                | `megadj shelf-sweeps [--json]` ✅                                                                                                                                                                                    | `archive_sweep` ✅ (sweep census rides the archive reads)                                                 | Fleet ⌗ Prep (digest section) ✅                                           | —                                                                             |
| Shelf sync (archive→sticks)                       | `megadj shelf-sync [--dry-run]` ✅                                                                                                                                                                                   | ⛔ §4-A1 (stick writes stay CLI; drives are user-staged)                                                  | ⛔ §4-A1                                                                   | — (AGENTS: agents never write the playing USB)                                |
| Gold-set metrics report                           | `megadj gold-report [--json]` ✅                                                                                                                                                                                     | ⛔ §4-A1 (dev-gate harness stays CLI)                                                                     | ⛔ §4-A1                                                                   | —                                                                             |
| BPM/genre re-gate harness                         | `megadj regate bpm\|genre\|effnet [--detector --gold-dir]` ✅                                                                                                                                                        | ⛔ §4-A1                                                                                                  | ⛔ §4-A1                                                                   | —                                                                             |
| RB path repair                                    | `megadj rb-fix-paths [drive] [--apply --yes]` ✅                                                                                                                                                                     | ⛔ §4-A1 (master-DB mutation stays CLI)                                                                   | ⛔ §4-A1                                                                   | —                                                                             |
| RB unmatched census / quarantine                  | `megadj rb-unmatched [drive] [--quarantine --yes]` ✅                                                                                                                                                                | ⛔ §4-A1                                                                                                  | ⛔ §4-A1                                                                   | —                                                                             |
| RB headless import                                | `megadj rb-import [drive] <folder> [--apply --yes]` ✅                                                                                                                                                               | ⛔ §4-A1 (master-DB writes are rb-import's job only)                                                      | ⛔ §4-A1                                                                   | —                                                                             |
| RB hot-cue restamp                                | `megadj rb-cues [drive] [--restamp --apply --yes]` ✅                                                                                                                                                                | ⛔ §4-A1 (djmdCue write seam stays CLI)                                                                   | ⛔ §4-A1                                                                   | —                                                                             |
| RB duplicate-row sweep                            | `megadj rb-dedup [drive] [--apply --yes]` ✅                                                                                                                                                                         | ⛔ §4-A1                                                                                                  | ⛔ §4-A1                                                                   | —                                                                             |
| RB comment backfill                               | `megadj rb-comment-sync [drive] [--batch TOKEN] [--apply --yes]` ✅                                                                                                                                                  | ⛔ §4-A1                                                                                                  | ⛔ §4-A1                                                                   | —                                                                             |
| RB playlist reconcile (XML twin)                  | `megadj rb-playlist <drive> reconcile [--apply --yes]` ✅                                                                                                                                                            | ⛔ §4-A1                                                                                                  | ⛔ §4-A1                                                                   | —                                                                             |
| RB grid triage (GA-03/04)                         | `megadj rb-grid-triage [drive] [--compare D]` ✅                                                                                                                                                                     | `archive_grid_cross_check` ✅ (coarse read)                                                               | FullTags ⌗ Beatgrids + Grid health card ✅                                 | — (repair writer stays GA-06)                                                 |
| ANLZ write-path spike (GA-07)                     | `megadj rb-anlz-spike [drive] snapshot\|compare\|set-grid --tag T [--file KEY --beats JSON --apply --yes]` ✅ (set-grid = Q4's direct PQTZ rewrite, shipped 2026-09-18, unrun vs live RB)                            | ⛔ §4-A1 (drive-side harness stays CLI)                                                                   | ⛔ §4-A1                                                                   | —                                                                             |
| Stale test-fixture sweep (host tmpdir)            | `megadj tmp-purge [--state] [--apply] [--all] [--json]` ✅ (--state: the state-dir backup/sidecar/spike tier)                                                                                                        | ⛔ §4-A1 (host filesystem hygiene stays CLI)                                                              | ⛔ §4-A1                                                                   | —                                                                             |
| Intake census (files ↔ archive.db, F5)            | `megadj intake-status [drive] [--json]` ✅ (NFC+casefold compare; drift = exit 1)                                                                                                                                    | ⛔ §4-A1 (the count SSOT stays CLI)                                                                       | ⛔ §4-A1 (GetDat ⌗ Pipeline renders the same ledger buckets)               | —                                                                             |
| Dump ledger (one ingest batch = one unit, #20)    | ingest writes it; `megadj intake-status` renders the census ✅                                                                                                                                                       | `getdat_intake` ✅ (bare call = the census)                                                               | GetDat ⌗ Intake — dumps strip ✅ (`GET /api/intake/dumps`)                 | — (rev-43)                                                                    |

Every §2d CLI cell resolves to one of three verdicts: **A1** (mutating
pipeline arm — CLI-only by exemption), **A2** (host setup), or the
dev-gate harnesses (`gold-report`/`regate`, CLI-only under A1). The
parity test pins this: every command in the census must appear in §2d
or in §4, so a new command without a matrix row is a red build (G2's
drift class can't rot the doc again).

## 3. True gaps (all closed — kept as the record)

Every gap this audit found was closed the same day, each with the missing
spoke landing over the shared API route:

- **GAP-1 (CLOSED)** — UI Mirror button (role-gated to mirrors, interlock-disabled).
- **GAP-2 (CLOSED)** — `deck_prep` MCP twin for `deckctl prep`.
- **GAP-3 (CLOSED)** — `deckctl note|notes` CLI verbs (origin `deckctl`;
  dismissal stays a human UI action).
- **GAP-4** — Fleet ⌗ Preflight tab
  (verdict banner, per-drive checks + blockers + fixes, firmware
  advisories, N78 player compat per drive).
- **GAP-5** — `deckctl search` + `deck_search`
  over the ⌘K route.
- **GAP-6** — `deckctl report --dossier` +
  `deck_report {format:"dossier"}` streaming the export bundle.
- **GAP-7** — `deckctl rename` +
  `deck_rename`. Photo upload stays UI-only (a human picks the art).
- **GAP-8** — Fleet ⌗ Prep tab rendering the
  digest markdown from the same `fetchWeeklyPrepInput` seam.
- **GAP-9** — Fleet ⌗ Archive tab (ingest
  status, mood profile, LOWQ queue, grid cross-check) over the same
  four readonly routes the MCP archive tools read.
- **GAP-10** — the Sep 8 UI help pass shipped
  `shared/help.ts` (glossary, job explainers, surface tour) to the UI
  and `GET /api/help` only. Now every surface reads the same SSOT:
  `deckctl help [term|kind]` + `deck_help {term?}` import the module
  directly (they work with the server down, too).
- **GAP-11** — note dismissal was UI-only (timeline
  button) while the notes themselves landed from every surface — the
  feed an agent fills had no agent-side off-ramp. `deckctl dismiss
<drive> <noteId>` + `deck_dismiss {drive, note_id}` close it
  (mutating, confirm-first; history kept).
- **GAP-12** — `GET /api/status` 404'd (agents/curl got
  `{error: "not found"}`) because the status envelope only existed
  client-side: `deckctl status` fetched `/api/interlock` +
  `/api/drives` + `/api/jobs?active=1` and assembled it. The route now
  serves that exact envelope in one read (drives leg shares the
  `/api/drives` builder, so the two can't drift); regression-tested in
  `cratedeck/test/e2e.test.ts`.
- **GAP-13** — the web shell exposed one product (the
  drives) plus a Fleet page and a single Archive card; GetDat and
  FullTags — two of megadj's three named sub-products — had no canvas.
  The product split into top-level product tabs (Drives / GetDat /
  FullTags / Fleet), each hash-routed with its own tab strip, and gave
  the two new readonly reads behind them (`/api/archive/library`,
  `/api/archive/cues`) their MCP twins (`archive_library_overview`,
  `archive_cue_ledger`) in the same commit.

## 4. Deliberate exemptions (the whitelist)

Each row is a decision, not an oversight. Changing one requires editing
this table AND the enforcement test together (that's the point).

- **P1 — MCP/UI can't stop the server.** `deckctl stop` kills the host
  process; an MCP client doing that kills its own transport, and the UI
  obviously can't stop itself. Localhost operator only.
- **P2 — UI can't stop itself** (same reasoning, explicit row so the
  test doesn't flag it from the other direction).
- **S1 — speedtest UI button: CLOSED.** DrivePage exposes the
  Speed probe action and `shared/help.ts`/`deckctl_docs.ts` document it.
- **D1 — CLOSED.** `report --dossier` / `deck_report
{format: "dossier"}` now stream the same export bundle as the UI.
- **D2 — photo half remains: a human picks cover art** (agents don't
  choose aesthetics; O86 rails). The rename half closed
  (`deckctl rename` + `deck_rename`); extended the photo
  capability itself (drive cover photos now dual-save locally + on the
  stick at `Contents/CrateDeck/`, can be picked from files already on
  the drive, and re-sync at mount) — still UI-only under this same
  exemption: it is aesthetic human choice, served by
  `POST /api/drives/:id/photo` (multipart or `drive_rel`) and
  `GET /api/drives/:id/drive-images`.
- **F1 — track-locations detail rides `coverage`'s output**; no
  separate MCP tool (same data, one shape).
- **F3 — source-diff UI: CLOSED by the GetDat ⌗ Sources tab** (a
  source-vs-source diff form rendering only-in-A / only-in-B / shared).
  It had been exempted as a two-argument diagnostic; the product split
  gave it a natural home. Kept here as the record; the §2d row now shows
  the UI column covered.
- **G2 — CLOSED.** The Fleet ⌗ Prep tab renders the
  digest.
- **A1 — archive mutation stays CLI-shaped.** The mutating pipeline
  arms — every verb in the domain command records
  (`src/rekordbox/cli-commands.ts`'s rb-* table +
  `src/shelf/cli-commands.ts`'s shelf-hygiene/restore, intake-status,
  tmp-purge arms — the dissolved maintenance grab-bag, #235) plus
  `genre`/`drop`/`upgrade` — are long-running,
  file- and DB-mutating stages; MCP's archive half is **readonly by
  design** (`readonly: true` sqlite handle — a bug there cannot corrupt
  archive state). The UI does not re-implement pipeline logic — the
  GetDat ⌗ Intake tab SPAWNS `megadj ingest <folder> --json` as
  a job, so the CLI remains the single implementation (the tab is a
  remote control, not a second engine). Agents still drive archive work
  through `megadj` CLI + skills, which is the P1 contract (`--json`
  everywhere). The verb list is derived, not copied: the parity test
  reads the domain command records + the registry (no hand twin — the
  hand list this row replaced had already drifted by construction).
- **A2 — doctor/init are host setup**, not library operations; they
  scaffold config and check the local machine. No UI/MCP sense.
- **A3 — CLOSED.** The Fleet ⌗ Archive tab serves the
  read tools' data (ingest status, mood profile, LOWQ, grid
  cross-check); ⌘K covers track search.
- **R1 — RETIRED (rev-43, #35/#36).** Hygiene quarantine restore was
  CLI-only because a remote surface lacked a target-volume picker and the
  safety story. Closed without one: restore/restore-all target the
  LEDGER-RECORDED original path only (never a free-form destination), MD5
  is verified before and after every copy, the empty requires the literal
  `{confirm:"DELETE"}` + the engine lease, and the whole family runs
  through megadj's CLI — the web tab is a remote control, exactly like
  scan/apply/decide. Rows emptied from quarantine flip to `archived`
  (receipt kept; the ledger keeps the audit trail).
- **L1 — cross-tier twin registry (the "same job, two packages" list).**
  These are structural twins that are deliberately NOT merged — the
  packages stay decoupled — with their alignment owned here instead:
  `cratedeck/src/db/core.ts` DBCore vs `src/shared/sqlite-ledger.ts`
  `openLedger()` (both open WAL + busy_timeout 5000 + synchronous NORMAL;
  aligned by convention Sep 18 per #87's ride-along — never a
  cross-package import; `cratedeck/shared/types.ts` stays the import
  leaf) and `src/shared/leaf/fmt.ts` `errMessage()` — the ONE body; src/
  callers alias it as `errorText` at the import site (#82; the
  `errorText` re-export shim merged away per #221). A third seam
  appearing between the tiers gets a row here before anyone reaches for
  a bridge import.

## 5. Enforcement — how the parity rule can't rot

The audit above is a snapshot; snapshots rot. Three layers keep it
honest, in order of strength:

1. **`cratedeck/test/surface-parity.test.ts` (shipped with this doc).**
   Source-parsed, zero fixtures: it re-derives each surface's census
   from the actual files (the `name:` rows in the #143 `src/command-registry.ts`
   help/census SSOT +
   `deckctl.ts`, tool keys in `mcp.ts`, exact-path table keys +
   `route ===`/`sub ===` literals across `index.ts` + `api_routes.ts`
   (+ `api_dispatch.ts`/`drive_routes.ts`/`fleet_routes.ts`),
   `run("`/`api(` strings in
   `web/**/*.tsx`) and asserts:
   - every megadj CLI command has a registry block and vice versa (the
     census and the help derive from ONE table; a command the help
     can't show is half an agent surface);
   - every deckctl verb has an MCP twin **or** an exemption-tagged skip;
   - every job kind in the `shared/types.ts` JOB_KINDS SSOT is
     enqueueable from the UI (or exempt) — and deckctl/mcp derive
     their kind lists FROM that SSOT (hand-copied lists are a
     regression; they each dropped a kind once already);
   - the help SSOT and note dismissal are reachable from all three
     surfaces (GAP-10/11 can't quietly reopen);
   - every mutating MCP tool keeps `destructive: true` plus its required
     server-side guard (source scan for `deck_run`/`deck_cancel`/
     `deck_hygiene`/`deck_fixes`/`deck_note`/`deck_rename`/`deck_dismiss`);
   - every `archive_*` tool source keeps the `readonly` DB handle;
   - census numbers match this doc's §1 table (the doc and the code
     can't drift apart silently).
2. **`cratedeck/test/api-parity-census.test.ts` (#249, shipped
   2026-09-19).** The client↔server contract pin that closes what
   surface-parity's G4 pass approximated: the server leg derives from
   the producers (slice-table return keys, delegator literals,
   drive-subroute literals, fleet literals, and the archive family from
   `archiveHandlers()`'s real keys — imported, not parsed), and the
   client leg walks `cratedeck/web` + the deckctl/MCP legs (including
   `src={`-shaped media fetches, nested-generic `api<...>` calls, and
   the `enqueueAndFollow` call-site families). Both directions are
   pinned: a client target with no server route is red (the genre-why
   Sep-17 class), and a server route no client reaches must carry a
   reasoned allowlist row in the test (the dead-endpoint #231 class). A
   route rename now fails the census in the same run that breaks the
   UI.
3. **API-first design rule** (architectural, enforced by review): a new
   capability lands as an `/api/...` route + spoke wrappers in the same
   PR, or it lands with an exemption row here. The parity test's census
   makes "forgot the MCP twin" a red build, not a discovery six weeks
   later.
4. **This doc is the exemption registry.** Adding an exemption = edit
   §4 + the test's exemption list in the same commit. Both or neither.

**Why this shape:** P1 says "if a feature can't be expressed as a
command an operator or an AI agent can run, it doesn't exist." This doc
extends it one step: a capability that exists on only one surface is a
capability half the operators can't use — and half of parity is just
thin wrappers over the API the server already owns.
