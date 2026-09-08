# Surface Parity — CLI ↔ MCP ↔ UI

**The rule ([PRINCIPLES.md](PRINCIPLES.md) §1, made testable):** every
capability exposed on one surface must be reachable on the other two —
CLI (`megadj` + `deckctl`), MCP (`bun run mcp`), and the web UI — **or
carry an explicit, recorded exemption** in §4 of this doc. A gap without
an exemption row is a bug; `cratedeck/test/surface-parity.test.ts`
fails the build on it.

Rev 4 · 2026-09-08 · the in-app help SSOT (`shared/help.ts`, served at
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
| deckctl | `bun run cratedeck/src/deckctl.ts <verb>` | 20 verbs |
| MCP | `bun run mcp` (`cratedeck/src/mcp.ts` + `archive_tools.ts`) | 27 tools |
| HTTP API | `cratedeck/src/index.ts` (localhost:7742) | ~33 routes |
| Web UI | `cratedeck/web/` (hash-routed pages) | 4 pages, ~22 actions |

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
| List drives + state | `status` / `drives` ✅ | `deck_status`/`deck_drives` ✅ | rail ✅ | — |
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
| Weekly digest | `prep [--out]` ✅ | `deck_prep` ✅ (markdown; `--out` stays CLI) | Fleet ⌗ Prep tab ✅ | — (G2 closed rev 3) |
| Agent notes feed | `note`/`notes` ✅ | `deck_note`/`deck_notes` ✅ | Timeline cards ✅ | — (GAP-3 closed) |
| Note dismissal | `dismiss <d> <id>` ✅ | `deck_dismiss` ✅ (rev 4) | Timeline dismiss ✅ | — (GAP-11 closed rev 4) |
| Job attribution (O87) | jobs show `[origin]` ✅ | stamps `mcp:<session>` ✅ | timeline chips ✅ | — |

### 2d. Archive (GetDat/FullTags) operations

| Capability | CLI (megadj) | MCP | UI | Verdict |
| --- | --- | --- | --- | --- |
| sync / status / list / retry / adopt | ✅ | ⛔ §4-A1 (archive writes stay CLI) | ⛔ §4-A1 | — |
| ingest / fetch / enrich / artwork / audit / years | ✅ | reads only (`archive_*`) ⛔ §4-A1 | ⛔ §4-A1 | — |
| beats / mood / cues | ✅ | ⛔ §4-A1 | ⛔ §4-A1 | — |
| organize | ✅ | ⛔ §4-A1 | ⛔ §4-A1 | — |
| doctor / init | ✅ | ⛔ §4-A2 (host setup is human work) | ⛔ §4-A2 | — |
| Archive search | `megadj list` ✅ | `archive_search_tracks` ✅ | ⌘K + Fleet ⌗ Archive ✅ | — (A3 closed rev 3) |
| Track stats | `status`/`list` ✅ | `archive_track_stats` ✅ | Fleet ⌗ Archive (mood/grid cards) ✅ | — (A3 closed rev 3) |
| Ingest status / LOWQ queue | `list LOWQ` ✅ | `archive_ingest_status`/`lowq_queue` ✅ | Fleet ⌗ Archive ✅ | — (A3 closed rev 3) |
| Source diff | — | `archive_source_diff` ✅ | ⛔ §4-F3 (see note) | — |
| Grid cross-check | `megadj beats` data ✅ | `archive_grid_cross_check` ✅ | Fleet ⌗ Archive ✅ | — (A3 closed rev 3) |
| Mood profile | `megadj mood` data ✅ | `archive_mood_profile` ✅ | Fleet ⌗ Archive ✅ | — (A3 closed rev 3) |
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
  (`deckctl rename` + `deck_rename`).
- **F1 — track-locations detail rides `coverage`'s output**; no
  separate MCP tool (same data, one shape).
- **F3 — source-diff has no UI card.** It's a two-argument diagnostic
  (which YouTube sources diverged between two sync states) — agent/
  operator-shaped, and its inputs surface in the Prep tab's archive
  section. Revisit if a "sources" view ever ships.
- **G2 — CLOSED (rev 3, GAP-8).** The Fleet ⌗ Prep tab renders the
  digest.
- **A1 — archive mutation stays CLI-only.** `sync`/`ingest`/`fetch`/
  `beats`/`mood`/`cues`/`organize`/`upgrade` are long-running,
  file-mutating pipeline stages; MCP's archive half is **readonly by
  design** (`readonly: true` sqlite handle — a bug there cannot corrupt
  archive state). The UI has no archive mutation either (P1's "describe
  & verify, don't create"). Agents drive archive work through `megadj`
  CLI + skills, which is the P1 contract (`--json` everywhere).
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
