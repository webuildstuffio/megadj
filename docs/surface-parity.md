# Surface Parity — CLI ↔ MCP ↔ UI

**Status:** ✅ CURRENT — parity contract and census source of truth.

**The rule ([PRINCIPLES.md](PRINCIPLES.md) §1, made testable):** every
capability exposed on one surface must be reachable on the other two —
CLI (`megadj` + `deckctl`), MCP (`bun run mcp`), and the web UI — **or
carry an explicit, recorded exemption** in §4 of this doc. A gap without
an exemption row is a bug; `cratedeck/test/surface-parity.test.ts`
fails the build on it.

## Revision history

- rev-25 (2026-09-15): MegaSet rename — verb/route/tool renamed (`megadj megaset`, `/api/archive/megaset`, `megaset_propose`); census unchanged.

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

| Surface    | Entry points                                                | Count                  |
| ---------- | ----------------------------------------------------------- | ---------------------- |
| megadj CLI | `megadj <cmd>` (`src/cli.ts`)                               | 45 commands + `--help` |
| deckctl    | `bun run cratedeck/src/deckctl.ts <verb>`                   | 23 verbs               |
| MCP        | `bun run mcp` (`cratedeck/src/mcp.ts` + `archive_tools.ts`) | 41 tools               |
| HTTP API   | `cratedeck/src/index.ts` (localhost:7742)                   | 63 routes              |
| Web UI     | `cratedeck/web/` (hash-routed pages)                        | 6 pages, ~22 actions   |

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

| Capability       | CLI                  | MCP                          | UI            | Verdict       |
| ---------------- | -------------------- | ---------------------------- | ------------- | ------------- |
| Coverage matrix  | `coverage` ✅        | `deck_coverage` ✅           | Fleet page ✅ | —             |
| Redundancy audit | `redundancy` ✅      | `deck_redundancy` ✅         | Fleet page ✅ | —             |
| Fleet diff       | `diff A B` ✅        | `deck_diff` ✅               | Fleet page ✅ | —             |
| Track locations  | `coverage` output ✅ | via `deck_coverage` ⛔ §4-F1 | Fleet page ✅ | —             |
| Global search    | `search <q>` ✅      | `deck_search {q}` ✅         | ⌘K ✅         | — (F2 closed) |

### 2c. Gig-night + agent layer

| Capability                 | CLI                                                     | MCP                                          | UI                                      | Verdict              |
| -------------------------- | ------------------------------------------------------- | -------------------------------------------- | --------------------------------------- | -------------------- |
| Preflight verdict          | `preflight` ✅                                          | `deck_preflight` ✅                          | Fleet ⌗ Preflight tab ✅                | — (G1 closed)        |
| Player compat              | `players [d]` ✅                                        | `deck_players` ✅                            | Preflight tab (per-drive expand) ✅     | — (G1 closed)        |
| Booth fleet settings       | `booth [set IDs]` ✅                                    | `deck_booth {ids?}` ✅                       | Fleet ⌗ Booth tab ✅ (citations inline) | —                    |
| Booth fixes queue          | `fixes [scan\|apply]` ✅                                | `deck_fixes {action?}` ✅                    | Drive ⌗ Fixes tab ✅                    | —                    |
| Hygiene queue              | `hygiene [scan\|apply\|confirm\|dismiss]` ✅            | `deck_hygiene {action?}` ✅                  | Drive ⌗ Hygiene tab ✅                  | —                    |
| Restore hygiene quarantine | `megadj shelf-restore <finding-id\|path> [--into F]` ✅ | ⛔ §4-R1                                     | ⛔ §4-R1                                | —                    |
| Weekly digest              | `prep [--out]` ✅                                       | `deck_prep` ✅ (markdown; `--out` stays CLI) | Fleet ⌗ Prep tab ✅                     | —(G2 closed)         |
| Agent notes feed           | `note`/`notes` ✅                                       | `deck_note`/`deck_notes` ✅                  | Timeline cards ✅                       | — (GAP-3 closed)     |
| Note dismissal             | `dismiss <d> <id>` ✅                                   | `deck_dismiss` ✅                            | Timeline dismiss ✅                     | — (GAP-11/12 closed) |
| Job attribution (O87)      | jobs show `[origin]` ✅                                 | stamps `mcp:<session>` ✅                    | timeline chips ✅                       | —                    |

### 2d. Archive (GetDat/FullTags) operations

| Capability                                        | CLI (megadj)                                                                                              | MCP                                                       | UI                                                                         | Verdict                                                                       |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| sync / status / list / retry / adopt              | ✅ `adopt --shelf [--apply]` repoints moved-file rows at shelf copies                                     | ⛔ §4-A1 (archive writes stay CLI)                        | ⛔ §4-A1 (Intake drives `ingest` only, as a CLI spawn)                     | —                                                                             |
| ingest / fetch / enrich / artwork / audit / years | ✅                                                                                                        | `getdat_ingest` ✅; reads only (`archive_*`) for the rest | ingest: GetDat ⌗ Intake ✅; fetch/audit reads ✅                           | —                                                                             |
| archive WAV→AIFF conversion                       | `megadj convert` ✅                                                                                       | `getdat_convert` ✅ (async CLI seam; JSON summary)        | GetDat ⌗ Intake / FullTags pipeline ✅                                     | —                                                                             |
| beats / mood / cues                               | ✅                                                                                                        | ⛔ §4-A1                                                  | ⛔ §4-A1                                                                   | —                                                                             |
| organize                                          | ✅                                                                                                        | ⛔ §4-A1                                                  | ⛔ §4-A1                                                                   | —                                                                             |
| doctor / init                                     | ✅                                                                                                        | ⛔ §4-A2 (host setup is human work)                       | ⛔ §4-A2                                                                   | —                                                                             |
| Archive search                                    | `megadj list` ✅                                                                                          | `archive_search_tracks` ✅                                | ⌘K + GetDat ⌗ Library ✅                                                   | —(A3 closed)                                                                  |
| Track stats                                       | `status`/`list` ✅                                                                                        | `archive_track_stats` ✅                                  | FullTags ⌗ Beatgrids/Mood cards ✅                                         | —(A3 closed)                                                                  |
| Ingest status / LOWQ queue                        | `list LOWQ` ✅                                                                                            | `archive_ingest_status`/`lowq_queue` ✅                   | GetDat ⌗ Pipeline/Backlog ✅                                               | — (A3 closed (product split))                                                 |
| Source diff                                       | —                                                                                                         | `archive_source_diff` ✅                                  | GetDat ⌗ Sources                                                           | —                                                                             |
| Grid cross-check                                  | `megadj beats` data ✅                                                                                    | `archive_grid_cross_check` ✅                             | FullTags ⌗ Beatgrids ✅                                                    | — (A3 closed (product split))                                                 |
| Mood profile                                      | `megadj mood` data ✅                                                                                     | `archive_mood_profile` ✅                                 | FullTags ⌗ Mood ✅                                                         | — (A3 closed (product split))                                                 |
| Similar tracks (I49 sounds-like)                  | `megadj similar <id> [--space raw\|whitened]` ✅                                                          | `archive_similar_tracks` ✅ (space param)                 | FullTags ⌗ Similar ✅                                                      | —                                                                             |
| MegaSet proposal                                  | `megadj megaset [--preset --minutes --opener --limit --search]` ✅ (`setbuild` alias retired Sep 15 2026) | `megaset_propose` ✅ (propose-only; `search` A/B param)   | MegaSet product (#/megaset) + saved draft/M3U8 download ✅ (Sequencer row) | — (same read-only proposal; requested/actual duration stays explicit)         |
| Set-build → master playlist                       | `megadj rb-playlist [drive] [--preset …] [--apply --yes]` ✅                                              | ⛔ §4-A1 (master-DB mutation stays CLI)                   | ⛔ §4-A1                                                                   | — (links existing content rows; dry-run predicts the link count)              |
| Rekordbox master → archive census                 | `megadj rb-adopt [drive] [--apply --yes]` ✅                                                              | ⛔ §4-A1 (archive DB mutation stays CLI)                  | ⛔ §4-A1                                                                   | — (master read-only; exact Content-ID cross-reference + full metadata mirror) |
| Cue ledger                                        | `megadj cues` data ✅                                                                                     | `archive_cue_ledger` ✅                                   | FullTags ⌗ Cues ✅                                                         | —                                                                             |
| Library overview (FullTags mirror)                | `megadj fetch`/`audit` data ✅                                                                            | `archive_library_overview` ✅                             | FullTags ⌗ Tags + GetDat ⌗ Library ✅                                      | —                                                                             |
| Skip census (why rows didn't land)                | `megadj list` buckets ✅                                                                                  | `archive_skip_census` ✅                                  | GetDat ⌗ Pipeline (decisions card) + Backlog ✅                            | —                                                                             |
| Source census                                     | `megadj list` sources ✅                                                                                  | `archive_sources` ✅                                      | GetDat ⌗ Sources (tag chips feed the diff form) ✅                         | —                                                                             |
| Analysis coverage                                 | `megadj beats`, `mood`, and `cues` counts ✅                                                              | `archive_analysis_coverage` ✅                            | FullTags header meters (one progress picture) ✅                           | —                                                                             |
| Tag census (FullTags ↔ rekordbox mirrors)         | `megadj audit` + `rb-adopt` data ✅                                                                       | `archive_tag_census` ✅                                   | FullTags ⌗ Tags ✅ (tab)                                                   | — (DB mirrors only; files never read on the census path)                      |
| Tag compare (one track, three sources)            | `megadj status <id>` + file tags ✅                                                                       | `archive_tag_compare` ✅ (live file ground truth)         | FullTags ⌗ Tags track view ✅                                              | — (file = truth; one ffprobe+mutagen read per request)                        |
| Archive integrity sweep                           | Prep digest (`archive integrity` section) ✅                                                              | `archive_sweep` ✅                                        | Fleet ⌗ Prep (digest section) ✅                                           | — (D30)                                                                       |
| Rename drive                                      | `rename <d> [nick]` ✅                                                                                    | `deck_rename` ✅                                          | inline rename ✅                                                           | —(D2-rename closed)                                                           |
| Set drive photo                                   | —                                                                                                         | ⛔ §4-D2 (human picks the art)                            | Photo tab ✅                                                               | —                                                                             |

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
- **A1 — archive mutation stays CLI-shaped.** `sync`/`ingest`/`fetch`/
  `beats`/`mood`/`cues`/`organize`/`upgrade`/`rb-adopt` are long-running,
  file-mutating pipeline stages; MCP's archive half is **readonly by
  design** (`readonly: true` sqlite handle — a bug there cannot corrupt
  archive state). The UI does not re-implement pipeline logic — the
  GetDat ⌗ Intake tab SPAWNS `megadj ingest <folder> --json` as
  a job, so the CLI remains the single implementation (the tab is a
  remote control, not a second engine). Agents still drive archive work
  through `megadj` CLI + skills, which is the P1 contract (`--json`
  everywhere).
- **A2 — doctor/init are host setup**, not library operations; they
  scaffold config and check the local machine. No UI/MCP sense.
- **A3 — CLOSED.** The Fleet ⌗ Archive tab serves the
  read tools' data (ingest status, mood profile, LOWQ, grid
  cross-check); ⌘K covers track search.
- **R1 — hygiene quarantine restore is CLI-only.** `shelf-restore`
  copies only a source owned by an applied `hygiene_findings` ledger row,
  verifies MD5 before and after the copy, refuses an existing destination,
  and shares the hygiene mutation lease with `shelf-hygiene --apply`. A
  remote/UI restore surface would need an explicit target-volume picker and
  the same local-volume safety controls; until then, agents use the CLI.

## 5. Enforcement — how the parity rule can't rot

The audit above is a snapshot; snapshots rot. Three layers keep it
honest, in order of strength:

1. **`cratedeck/test/surface-parity.test.ts` (shipped with this doc).**
   Source-parsed, zero fixtures: it re-derives each surface's census
   from the actual files (the `*_COMMANDS` family registries delegated by
   `src/cli.ts` +
   `deckctl.ts`, tool keys in `mcp.ts`, exact-path table keys +
   `route ===`/`sub ===` literals across `index.ts` + `api_routes.ts`
   (+ `drive_routes.ts`/`fleet_routes.ts`), `run("`/`api(` strings in
   `web/**/*.tsx`) and asserts:
   - every megadj CLI command appears in `src/usage.ts`'s help (a
     command the help can't show is half an agent surface);
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
2. **API-first design rule** (architectural, enforced by review): a new
   capability lands as an `/api/...` route + spoke wrappers in the same
   PR, or it lands with an exemption row here. The parity test's census
   makes "forgot the MCP twin" a red build, not a discovery six weeks
   later.
3. **This doc is the exemption registry.** Adding an exemption = edit
   §4 + the test's exemption list in the same commit. Both or neither.

**Why this shape:** P1 says "if a feature can't be expressed as a
command an operator or an AI agent can run, it doesn't exist." This doc
extends it one step: a capability that exists on only one surface is a
capability half the operators can't use — and half of parity is just
thin wrappers over the API the server already owns.
