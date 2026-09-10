# Surface Parity — CLI ↔ MCP ↔ UI

**The rule ([PRINCIPLES.md](PRINCIPLES.md) §1, made testable):** every
capability exposed on one surface must be reachable on the other two —
CLI (`megadj` + `deckctl`), MCP (`bun run mcp`), and the web UI — **or
carry an explicit, recorded exemption** in §4 of this doc. A gap without
an exemption row is a bug; `cratedeck/test/surface-parity.test.ts`
fails the build on it.

Rev 12 · 2026-09-10 — Shelf hygiene (docs/shelf-hygiene-2026-09-09.md):
`deckctl hygiene [scan|apply|confirm ID|dismiss ID]` + `deck_hygiene`
MCP tool + the Hygiene tab on the shelf drive page (all over the same
`/api/hygiene*` routes); KIND_DOCS/help SSOT gained the hygiene-scan +
hygiene-apply job docs; census re-derived — 22 verbs + 36 tools. Rev 11 · 2026-09-10 — GetDat ⌗ Intake tab (live `megadj ingest` runs
over the job engine, watch-folder + batch-folder allowlist, post-run
audit verdict); census re-derived — 21 verbs + 35 tools (the booth
fleet rev added `deck_booth` + the `booth` verb without bumping the
§1 table; the census test now derives the doc strings from source, so
this class of drift fails the build). Rev 10 · 2026-09-09 — I49 "sounds like" (`archive_similar_tracks`,
cosine kNN over the `embeddings` ledger, UI: FullTags ⌗ Similar) and
M66 set-builder copilot (`archive_set_build`, propose-only chain
builder) — 34 tools. Rev 9 · 2026-09-08 — the atomic web restructure: `web/` is now feature-
foldered (`app/` entry + router, `ui/` shared components, `products/`
SSOT + one folder per product, `styles/` split tokens/base/shell/rail/
canvas/pages) — same surfaces, new paths (`web/app/App.tsx`,
`web/products/shared.tsx`, …). Products gained educational ledes: a
phase chip on the nav strip ("1 · the drives stay honest"), a
`ProductIntro` band atop each canvas, and the Welcome route became the
megadj pipeline story with three product launcher cards (all copy from
the `products/shared.tsx` SSOT: `PRODUCTS` + `LEDE`). Rev 8 ·
2026-09-08 — the header redesign: the suite brand is **megadj**
(top-left), and the product nav moved to its own nav strip row with
exactly three products — **CrateDeck** (the DJ USB drives + their fleet),
**GetDat**, **FullTags**. Fleet is no longer presented as a fourth
product: it's a CrateDeck scope tab (Drives | Fleet), with Fleet's six
content tabs following it on the same strip when the Fleet route is
active. The tab strips for nav + pages now come from one SSOT table
(`web/products/shared.tsx` `PRODUCTS` + `PRODUCT_TABS`); page canvases no
longer render their own identity header. Rev 7 · 2026-09-08 — the
integration pass: the archive's own decision
records became surfaces. Three new readonly reads with same-commit twins
(`archive_skip_census` — why gone/skipped rows didn't land,
`archive_sources` — the source census the Sources diff form suggests
from, `archive_analysis_coverage` — one playable-vs-ledgers progress
picture), `ingest_status` grew run throughput (attempted + bytes), and
the GetDat/FullTags canvases render all of it. Rev 6 ·
2026-09-08 — the product split: the web shell grew top-level
product tabs (Drives / **GetDat** / **FullTags** / Fleet), giving the
archive's two sub-products their own canvases (GetDat: pipeline/backlog/
sources/library; FullTags: beatgrids/mood/cues/tags) instead of one
Archive card — and the two new readonly reads behind them
(`archive_library_overview`, `archive_cue_ledger`) got their MCP twins in
the same commit (29 tools). Rev 5 · 2026-09-08 — closed GAP-12: the
combined status read
(`GET /api/status`, the `deckctl status --json` envelope) 404'd because
only `/api/interlock`, `/api/drives`, `/api/jobs` existed; deckctl and MCP
assembled their status views client-side while the API hub had no single
read. Rev 4 · 2026-09-08 · the in-app help SSOT (`shared/help.ts`, served at
`GET /api/help`) and note dismissal got their CLI/MCP twins (`deckctl
help|dismiss` + `deck_help`/`deck_dismiss`), closing the last two true
gaps the Sep 8 UI help pass created. **Rev 3** (2026-09-07) took its
census from source the same day (every count below re-derived from
`src/cli.ts`, `cratedeck/src/deckctl.ts`,
`cratedeck/src/mcp.ts` + `archive_tools.ts`, `cratedeck/src/index.ts`,
`cratedeck/web/*.tsx`) and closed every remaining closeable exemption:
D1 (`report --dossier` + `deck_report {format: "dossier"}`),
D2-rename (`deckctl rename` + `deck_rename`), G2 (Fleet ⌗ Prep tab),
A3 (Fleet ⌗ Archive tab). Rev 2 closed GAP-1/2/3 (UI Mirror button,
`deck_prep` tool, `deckctl note|notes` verbs), G1 (Fleet ⌗ Preflight
tab), F2 (`deckctl search` + `deck_search`). What remains in §4 is
physically principled — host process control, photo upload, and archive
mutation safety rails. `cratedeck/test/surface-parity.test.ts` keeps it
that way.

---

## 1. The three surfaces, as they stand

| Surface | Entry points | Count |
| --- | --- | --- |
| megadj CLI | `megadj <cmd>` (`src/cli.ts`) | 19 commands + `--help` |
| deckctl | `bun run cratedeck/src/deckctl.ts <verb>` | 22 verbs |
| MCP | `bun run mcp` (`cratedeck/src/mcp.ts` + `archive_tools.ts`) | 36 tools |
| HTTP API | `cratedeck/src/index.ts` (localhost:7742) | ~35 routes |
| Web UI | `cratedeck/web/` (hash-routed pages) | 6 pages, ~22 actions |

The server's HTTP API is the **fourth surface** and the seam everything
converges on: deckctl and MCP are HTTP clients of it, and the UI talks to
it directly. Parity therefore has a natural hub-and-spoke shape — a
capability that reaches the API is one thin wrapper away from every
surface. That is the enforcement insight: **parity is cheapest to
guarantee at the API, and the spokes exist to expose it, not to own it.**

## 2. Capability × surface matrix (the audit)

Legend: ✅ reachable · ⛔ deliberate exemption (§4) · ❌ TRUE GAP.

### 2a. Drive operations

| Capability | CLI (deckctl) | MCP | UI | Verdict |
| --- | --- | --- | --- | --- |
| List drives + state | `status` / `drives` ✅ | `deck_status`/`deck_drives` ✅ | rail ✅ | — (GAP-12 closed rev 5: `GET /api/status`) |
| Drive report / health | `report` ✅ | `deck_report` ✅ | Health tab ✅ | — |
| Run scan | `run <d> scan` ✅ | `deck_run` ✅ | Scan button ✅ | — |
| Run verify | `run <d> verify` ✅ | `deck_run` ✅ | Verify button/tab ✅ | — |
| Run benchmark | `run <d> benchmark` ✅ | `deck_run` ✅ | Benchmark button ✅ | — |
| Run checksum | `run <d> checksum` ✅ | `deck_run` ✅ | Checksum button ✅ | — |
| **Run mirror** | `run <d> mirror` ✅ | `deck_run` ✅ | Mirror button ✅ (role-gated) | — (GAP-1 closed) |
| Job list / history | `jobs` ✅ | `deck_jobs` ✅ | JobsDock ✅ | — |
| Cancel job | `cancel <id>` ✅ | `deck_cancel` ✅ | JobsDock cancel ✅ | — |
| Stop server | `stop` ✅ | ⛔ §4-P1 (clients don't kill hosts) | ⛔ §4-P2 | — |
| Verify doc (explain) | `explain [kind]` ✅ | `deck_explain` ✅ | VerifyTab help ✅ | — |
| In-app help (glossary/tour) | `help [term]` ✅ | `deck_help {term?}` ✅ | tooltips + Welcome tour ✅ | — (GAP-10 closed rev 4) |
| Export dossier | `report --dossier [--out F]` ✅ | `deck_report {format:"dossier"}` ✅ | Export button ✅ | — (D1 closed rev 3) |
| Shelf hygiene queue (rev 12) | `hygiene [scan\|apply\|confirm\|dismiss]` ✅ | `deck_hygiene` ✅ | shelf drive ⌗ Hygiene tab ✅ | — |

### 2b. Fleet queries

| Capability | CLI | MCP | UI | Verdict |
| --- | --- | --- | --- | --- |
| Coverage matrix | `coverage` ✅ | `deck_coverage` ✅ | Fleet page ✅ | — |
| Redundancy audit | `redundancy` ✅ | `deck_redundancy` ✅ | Fleet page ✅ | — |
| Fleet diff | `diff A B` ✅ | `deck_diff` ✅ | Fleet page ✅ | — |
| Track locations | `coverage` output ✅ | via `deck_coverage` ⛔ §4-F1 | Fleet page ✅ | — |
| Global search | `search <q>` ✅ | `deck_search {q}` ✅ | ⌘K ✅ | — (F2 closed) |

### 2c. Gig-night + agent layer

| Capability | CLI | MCP | UI | Verdict |
| --- | --- | --- | --- | --- |
| Preflight verdict | `preflight` ✅ | `deck_preflight` ✅ | Fleet ⌗ Preflight tab ✅ | — (G1 closed) |
| Player compat | `players [d]` ✅ | `deck_players` ✅ | Preflight tab (per-drive expand) ✅ | — (G1 closed) |
| Booth fleet settings | `booth [set IDs]` ✅ | `deck_booth {ids?}` ✅ | Fleet ⌗ Booth tab ✅ (citations inline) | — |
| Weekly digest | `prep [--out]` ✅ | `deck_prep` ✅ (markdown; `--out` stays CLI) | Fleet ⌗ Prep tab ✅ | — (G2 closed rev 3) |
| Agent notes feed | `note`/`notes` ✅ | `deck_note`/`deck_notes` ✅ | Timeline cards ✅ | — (GAP-3 closed) |
| Note dismissal | `dismiss <d> <id>` ✅ | `deck_dismiss` ✅ (rev 4) | Timeline dismiss ✅ | — (GAP-11 closed rev 4) |
| Job attribution (O87) | jobs show `[origin]` ✅ | stamps `mcp:<session>` ✅ | timeline chips ✅ | — |

### 2d. Archive (GetDat/FullTags) operations

| Capability | CLI (megadj) | MCP | UI | Verdict |
| --- | --- | --- | --- | --- |
| sync / status / list / retry / adopt | ✅ | ⛔ §4-A1 (archive writes stay CLI) | ⛔ §4-A1 (Intake drives `ingest` only, as a CLI spawn) | — |
| ingest / fetch / enrich / artwork / audit / years | ✅ | reads only (`archive_*`) ⛔ §4-A1 | ingest: GetDat ⌗ Intake ✅ (rev 11 — runs the CLI as a job); fetch/audit reads ✅ | — |
| beats / mood / cues | ✅ | ⛔ §4-A1 | ⛔ §4-A1 | — |
| organize | ✅ | ⛔ §4-A1 | ⛔ §4-A1 | — |
| doctor / init | ✅ | ⛔ §4-A2 (host setup is human work) | ⛔ §4-A2 | — |
| Archive search | `megadj list` ✅ | `archive_search_tracks` ✅ | ⌘K + GetDat ⌗ Library ✅ | — (A3 closed rev 3) |
| Track stats | `status`/`list` ✅ | `archive_track_stats` ✅ | FullTags ⌗ Beatgrids/Mood cards ✅ | — (A3 closed rev 3) |
| Ingest status / LOWQ queue | `list LOWQ` ✅ | `archive_ingest_status`/`lowq_queue` ✅ | GetDat ⌗ Pipeline/Backlog ✅ | — (A3 closed rev 3; product split rev 6) |
| Source diff | — | `archive_source_diff` ✅ | GetDat ⌗ Sources (rev 6 — F3's UI half is here; F3's MCP row below keeps its original rationale) | — |
| Grid cross-check | `megadj beats` data ✅ | `archive_grid_cross_check` ✅ | FullTags ⌗ Beatgrids ✅ | — (A3 closed rev 3; product split rev 6) |
| Mood profile | `megadj mood` data ✅ | `archive_mood_profile` ✅ | FullTags ⌗ Mood ✅ | — (A3 closed rev 3; product split rev 6) |
| Similar tracks (I49 sounds-like) | `megadj similar <id>` ✅ | `archive_similar_tracks` ✅ | FullTags ⌗ Similar (rev 10) ✅ | — (rev 10) |
| Set-builder proposal (M66) | — (proposals render in the UI/agent surface; no write-back exists to expose) | `archive_set_build` ✅ (propose-only) | FullTags ⌗ Similar panel (rev 10) ✅ | — (rev 10; proposes, never writes) |
| Cue ledger | `megadj cues` data ✅ | `archive_cue_ledger` ✅ | FullTags ⌗ Cues ✅ | — (rev 6) |
| Library overview (FullTags mirror) | `megadj fetch`/`audit` data ✅ | `archive_library_overview` ✅ | FullTags ⌗ Tags + GetDat ⌗ Library ✅ | — (rev 6) |
| Skip census (why rows didn't land) | `megadj list` buckets ✅ | `archive_skip_census` ✅ | GetDat ⌗ Pipeline (decisions card) + Backlog ✅ | — (rev 7) |
| Source census | `megadj list` sources ✅ | `archive_sources` ✅ | GetDat ⌗ Sources (tag chips feed the diff form) ✅ | — (rev 7) |
| Analysis coverage | `megadj beats|mood|cues` counts ✅ | `archive_analysis_coverage` ✅ | FullTags header meters (one progress picture) ✅ | — (rev 7) |
| Archive integrity sweep | Prep digest (`archive integrity` section) ✅ | `archive_sweep` ✅ | Fleet ⌗ Prep (digest section) ✅ | — (D30) |
| Rename drive | `rename <d> [nick]` ✅ | `deck_rename` ✅ | inline rename ✅ | — (D2-rename closed rev 3) |
| Set drive photo | — | ⛔ §4-D2 (human picks the art) | Photo tab ✅ | — |

## 3. True gaps (all closed — kept as the record)

Every gap this audit found was closed the same day, each with the missing
spoke landing over the shared API route:

- **GAP-1 (CLOSED)** — UI Mirror button (role-gated to mirrors, interlock-disabled).
- **GAP-2 (CLOSED)** — `deck_prep` MCP twin for `deckctl prep`.
- **GAP-3 (CLOSED)** — `deckctl note|notes` CLI verbs (origin `deckctl`;
  dismissal stays a human UI action).
- **GAP-4 (rev 2, was exemption G1, CLOSED)** — Fleet ⌗ Preflight tab
  (verdict banner, per-drive checks + blockers + fixes, firmware
  advisories, N78 player compat per drive).
- **GAP-5 (rev 2, was F2, CLOSED)** — `deckctl search` + `deck_search`
  over the ⌘K route.
- **GAP-6 (rev 3, was D1, CLOSED)** — `deckctl report --dossier` +
  `deck_report {format:"dossier"}` streaming the export bundle.
- **GAP-7 (rev 3, was D2's rename half, CLOSED)** — `deckctl rename` +
  `deck_rename`. Photo upload stays UI-only (a human picks the art).
- **GAP-8 (rev 3, was G2, CLOSED)** — Fleet ⌗ Prep tab rendering the
  digest markdown from the same `fetchWeeklyPrepInput` seam.
- **GAP-9 (rev 3, was A3, CLOSED)** — Fleet ⌗ Archive tab (ingest
  status, mood profile, LOWQ queue, grid cross-check) over the same
  four readonly routes the MCP archive tools read.
- **GAP-10 (rev 4, CLOSED)** — the Sep 8 UI help pass shipped
  `shared/help.ts` (glossary, job explainers, surface tour) to the UI
  and `GET /api/help` only. Now every surface reads the same SSOT:
  `deckctl help [term|kind]` + `deck_help {term?}` import the module
  directly (they work with the server down, too).
- **GAP-11 (rev 4, CLOSED)** — note dismissal was UI-only (timeline
  button) while the notes themselves landed from every surface — the
  feed an agent fills had no agent-side off-ramp. `deckctl dismiss
  <drive> <noteId>` + `deck_dismiss {drive, note_id}` close it
  (mutating, confirm-first; history kept).
- **GAP-12 (rev 5, CLOSED)** — `GET /api/status` 404'd (agents/curl got
  `{error: "not found"}`) because the status envelope only existed
  client-side: `deckctl status` fetched `/api/interlock` +
  `/api/drives` + `/api/jobs?active=1` and assembled it. The route now
  serves that exact envelope in one read (drives leg shares the
  `/api/drives` builder, so the two can't drift); regression-tested in
  `cratedeck/test/e2e.test.ts`.
- **GAP-13 (rev 6, CLOSED)** — the web shell exposed one product (the
  drives) plus a Fleet page and a single Archive card; GetDat and
  FullTags — two of megadj's three named sub-products — had no canvas.
  Rev 6 split the shell into top-level product tabs (Drives / GetDat /
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
- **D1 — CLOSED (rev 3, GAP-6).** `report --dossier` / `deck_report
  {format: "dossier"}` now stream the same export bundle as the UI.
- **D2 — photo half remains: a human picks cover art** (agents don't
  choose aesthetics; O86 rails). The rename half closed rev 3
  (`deckctl rename` + `deck_rename`). Rev 5 extended the photo
  capability itself (drive cover photos now dual-save locally + on the
  stick at `Contents/CrateDeck/`, can be picked from files already on
  the drive, and re-sync at mount) — still UI-only under this same
  exemption: it is aesthetic human choice, served by
  `POST /api/drives/:id/photo` (multipart or `drive_rel`) and
  `GET /api/drives/:id/drive-images`.
- **F1 — track-locations detail rides `coverage`'s output**; no
  separate MCP tool (same data, one shape).
- **F3 — source-diff UI: CLOSED by rev 6's GetDat ⌗ Sources tab** (a
  source-vs-source diff form rendering only-in-A / only-in-B / shared).
  It had been exempted as a two-argument diagnostic; the product split
  gave it a natural home. Kept here as the record; the §2d row now shows
  the UI column covered.
- **G2 — CLOSED (rev 3, GAP-8).** The Fleet ⌗ Prep tab renders the
  digest.
- **A1 — archive mutation stays CLI-shaped.** `sync`/`ingest`/`fetch`/
  `beats`/`mood`/`cues`/`organize`/`upgrade` are long-running,
  file-mutating pipeline stages; MCP's archive half is **readonly by
  design** (`readonly: true` sqlite handle — a bug there cannot corrupt
  archive state). The UI does not re-implement pipeline logic — the
  GetDat ⌗ Intake tab (rev 11) SPAWNS `megadj ingest <folder> --json` as
  a job, so the CLI remains the single implementation (the tab is a
  remote control, not a second engine). Agents still drive archive work
  through `megadj` CLI + skills, which is the P1 contract (`--json`
  everywhere).
- **A2 — doctor/init are host setup**, not library operations; they
  scaffold config and check the local machine. No UI/MCP sense.
- **A3 — CLOSED (rev 3, GAP-9).** The Fleet ⌗ Archive tab serves the
  read tools' data (ingest status, mood profile, LOWQ, grid
  cross-check); ⌘K covers track search.

## 5. Enforcement — how the parity rule can't rot

The audit above is a snapshot; snapshots rot. Three layers keep it
honest, in order of strength:

1. **`cratedeck/test/surface-parity.test.ts` (shipped with this doc).**
   Source-parsed, zero fixtures: it re-derives each surface's census
   from the actual files (`case "..."` in `src/cli.ts` +
   `deckctl.ts`, tool keys in `mcp.ts`, `route ===`/`sub ===` literals
   in `index.ts`, `run("`/`api(` strings in `web/*.tsx`) and asserts:
   - every deckctl verb has an MCP twin **or** an exemption-tagged skip;
   - every job kind in `deck_run`'s enum is enqueueable from the UI
     (mirror closes GAP-1; the test is why it can't quietly regress);
   - the help SSOT and note dismissal are reachable from all three
     surfaces (GAP-10/11 can't quietly reopen);
   - every mutating MCP tool keeps `destructive: true` + interlock
     guard (source scan for `deck_run`/`deck_cancel`/`deck_note`/
     `deck_rename`/`deck_dismiss`);
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
