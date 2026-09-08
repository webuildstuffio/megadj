# Surface Parity — CLI ↔ MCP ↔ UI

**The rule ([PRINCIPLES.md](PRINCIPLES.md) §1, made testable):** every
capability exposed on one surface must be reachable on the other two —
CLI (`megadj` + `deckctl`), MCP (`bun run mcp`), and the web UI — **or
carry an explicit, recorded exemption** in §4 of this doc. A gap without
an exemption row is a bug; `cratedeck/test/surface-parity.test.ts`
fails the build on it.

Rev 1 · 2026-09-07 · census taken from source the same day (every count
below re-derived from `src/cli.ts`, `cratedeck/src/deckctl.ts`,
`cratedeck/src/mcp.ts`, `cratedeck/src/index.ts`, `cratedeck/web/*.tsx`).
**Same-day enforcement pass:** GAP-1/2/3 closed (UI Mirror button,
`deck_prep` tool, `deckctl note|notes` verbs) and
`cratedeck/test/surface-parity.test.ts` shipped — the census table is
now test-checked, not hand-maintained.

---

## 1. The three surfaces, as they stand

| Surface | Entry points | Count |
| --- | --- | --- |
| megadj CLI | `megadj <cmd>` (`src/cli.ts`) | 18 commands (17 + `--help`) |
| deckctl | `bun run cratedeck/src/deckctl.ts <verb>` | 16 verbs |
| MCP | `bun run mcp` (`cratedeck/src/mcp.ts`) | 22 tools |
| HTTP API | `cratedeck/src/index.ts` (localhost:7742) | ~30 routes |
| Web UI | `cratedeck/web/` (hash-routed pages) | 4 pages, ~21 actions |

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
| Export dossier | `report` text ⛔ §4-D1 | ⛔ §4-D1 | Export button ✅ | — |

### 2b. Fleet queries

| Capability | CLI | MCP | UI | Verdict |
| --- | --- | --- | --- | --- |
| Coverage matrix | `coverage` ✅ | `deck_coverage` ✅ | Fleet page ✅ | — |
| Redundancy audit | `redundancy` ✅ | `deck_redundancy` ✅ | Fleet page ✅ | — |
| Fleet diff | `diff A B` ✅ | `deck_diff` ✅ | Fleet page ✅ | — |
| Track locations | `coverage` output ✅ | via `deck_coverage` ⛔ §4-F1 | Fleet page ✅ | — |
| Global search | ⛔ §4-F2 (deckctl lacks a `search` verb) | ⛔ §4-F2 | ⌘K ✅ | — |

### 2c. Gig-night + agent layer

| Capability | CLI | MCP | UI | Verdict |
| --- | --- | --- | --- | --- |
| Preflight verdict | `preflight` ✅ | `deck_preflight` ✅ | ⛔ §4-G1 (UI card is B12 remainder) | — |
| Player compat | `players [d]` ✅ | `deck_players` ✅ | ⛔ §4-G1 | — |
| Weekly digest | `prep [--out]` ✅ | `deck_prep` ✅ (markdown; `--out` stays CLI) | ⛔ §4-G2 | — (GAP-2 closed) |
| Agent notes feed | `note`/`notes` ✅ | `deck_note`/`deck_notes` ✅ | Timeline cards ✅ | — (GAP-3 closed) |
| Job attribution (O87) | jobs show `[origin]` ✅ | stamps `mcp:<session>` ✅ | timeline chips ✅ | — |

### 2d. Archive (GetDat/FullTags) operations

| Capability | CLI (megadj) | MCP | UI | Verdict |
| --- | --- | --- | --- | --- |
| sync / status / list / retry / adopt | ✅ | ⛔ §4-A1 (archive writes stay CLI) | ⛔ §4-A1 | — |
| ingest / fetch / enrich / artwork / audit / years | ✅ | reads only (`archive_*`) ⛔ §4-A1 | ⛔ §4-A1 | — |
| beats / mood / cues | ✅ | ⛔ §4-A1 | ⛔ §4-A1 | — |
| organize | ✅ | ⛔ §4-A1 | ⛔ §4-A1 | — |
| doctor / init | ✅ | ⛔ §4-A2 (host setup is human work) | ⛔ §4-A2 | — |
| Archive search | `megadj list` ✅ | `archive_search_tracks` ✅ | ⛔ §4-A3 (crate-side ⌘K covers browse) | — |
| Track stats | `status`/`list` ✅ | `archive_track_stats` ✅ | ⛔ §4-A3 | — |
| Ingest status / LOWQ queue | `list LOWQ` ✅ | `archive_ingest_status`/`lowq_queue` ✅ | ⛔ §4-A3 | — |
| Source diff | — | `archive_source_diff` ✅ | ⛔ §4-A3 | — |
| Grid cross-check | `megadj beats` data ✅ | `archive_grid_cross_check` ✅ | ⛔ §4-A3 | — |
| Mood profile | `megadj mood` data ✅ | `archive_mood_profile` ✅ | ⛔ §4-A3 | — |
| Rename drive / set photo | — | ⛔ §4-D2 | inline rename + Photo tab ✅ | — |

## 3. True gaps (action list)

**All three gaps found by this audit were closed the same day; the list
stays as the record of what was missing and why it mattered:**

- **GAP-1 — UI had no Mirror button (CLOSED).** CLI and MCP could
  mirror; the UI couldn't. Fix shipped: a role-aware Mirror button on
  the drive page — mirror drives only (never renders on the master),
  disabled under the interlock, `copy` icon added to the central set.
- **GAP-2 — `deckctl prep` had no MCP twin (CLOSED).** The weekly digest
  was the one deckctl verb agents couldn't produce. Fix shipped:
  `deck_prep` (readonly, renders markdown from the same four API reads
  `cmdPrep` uses; file output stays CLI-side).
- **GAP-3 — agent notes had no CLI verbs (CLOSED).** `deck_note`/
  `deck_notes` were MCP-only. Fix shipped: `deckctl note <drive> <text>
  [--severity s]` + `deckctl notes [drive]` over the same routes
  (origin `deckctl`; dismissal stays a human UI action).

## 4. Deliberate exemptions (the whitelist)

Each row is a decision, not an oversight. Changing one requires editing
this table AND the enforcement test together (that's the point).

- **P1 — MCP/UI can't stop the server.** `deckctl stop` kills the host
  process; an MCP client doing that kills its own transport, and the UI
  obviously can't stop itself. Localhost operator only.
- **P2 — UI can't stop itself** (same reasoning, explicit row so the
  test doesn't flag it from the other direction).
- **D1 — dossier export is UI/download-shaped.** `GET /drives/:id/export`
  streams a file; CLI/MCP users get the same content via `report`. A
  future `deck_report {format: "dossier"}` would close this if it ever
  matters.
- **D2 — drive rename/photo are human-in-the-loop UI actions.** MCP
  deliberately lacks them (agents don't pick cover photos; O86 rails).
- **F1 — track-locations detail rides `coverage`'s output**; no
  separate MCP tool (same data, one shape).
- **F2 — global search is UI-first.** ⌘K exists; `deckctl search`/MCP
  equivalent is deliberately not built (agents have `archive_search_tracks`
  + `deck_coverage` for the same questions). Revisit if an agent loop
  asks for it.
- **G1 — preflight/players UI cards are the recorded B12 remainder**
  ([ideas.md](ideas.md) B12 "remaining optional: UI card"). Data is on
  every surface; presentation is CLI/MCP for now.
- **G2 — weekly digest UI is deliberately absent** (`prep` is a
  terminal-shaped artifact; the UI surfaces its inputs — preflight +
  redundancy — live).
- **A1 — archive mutation stays CLI-only.** `sync`/`ingest`/`fetch`/
  `beats`/`mood`/`cues`/`organize`/`upgrade` are long-running,
  file-mutating pipeline stages; MCP's archive half is **readonly by
  design** (`readonly: true` sqlite handle — a bug there cannot corrupt
  archive state). The UI has no archive mutation either (P1's "describe
  & verify, don't create"). Agents drive archive work through `megadj`
  CLI + skills, which is the P1 contract (`--json` everywhere).
- **A2 — doctor/init are host setup**, not library operations; they
  scaffold config and check the local machine. No UI/MCP sense.
- **A3 — archive read tools are agent-facing, not UI-facing.** The UI
  is drive-centric; archive browsing/query belongs to agents (MCP) and
  operators (CLI). A future "library" page would revisit this.

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
   - every mutating MCP tool keeps `destructive: true` + interlock
     guard (source scan for `deck_run`/`deck_cancel`/`deck_note`);
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
