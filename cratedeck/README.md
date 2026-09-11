# CrateDeck

Local dashboard for every DJ USB drive you own — mounted or not.
Built with Bun + TypeScript inside the megadj repo.

```bash
cd cratedeck
bun install
cd web && bun install && bun run build && cd ..   # build the UI once
bun run dev                                        # → http://127.0.0.1:7742
```

Dev mode (hot reload): `bun run web:dev` in `cratedeck/web/` alongside `bun run dev`.

## ✨ What you get

- 👻 **Ghosts** — unplug a drive: its card stays, dimmed, with last-known
  data. Nothing you own ever disappears from the sidebar.
- 🖼️ **Photos** — click a card → Rename, and set a photo via
  `POST /api/drives/:id/photo {"url": ...}` (Brave/Exa search proxy at
  `GET /api/images/search?q=`; set `provider`/`key` in `config.toml` or
  `CRATEDECK_IMAGE_KEY`). Photos dual-save locally + on the stick at
  `Contents/CrateDeck/` and re-sync at mount.
- 🧰 **Jobs** — Scan / Verify / Benchmark / Checksum / Speed probe /
  Mirror, with live progress + honest ETAs. All refused while rekordbox is
  running (the interlock, exit 3).
- 📤 **Export** — per-drive JSON dossier from the drive page (or
  `deckctl report --dossier`).
- 🔧 **Your drives** — set `master_drive` / `mirror_drive` in `config.toml`
  (copy `config.sample.toml`) to your volume names so sync status and role
  detection work.
- 🗄️ **Shelf-aware** — the archive-tier shelf drive shows only
  archive-relevant checks (the role-aware matrix in
  `shared/check_matrix.ts`); it's marked "master library lives here ·
  sticks sync from this".

Read-only by construction: every disk write goes through `src/guard.ts`
(allow-list = `cratedeck/data/` + deliberate structured writes onto mounted
sticks). Tests: `bun test cratedeck/`.

## 🚀 Beyond the core

- 🌙 **B12 preflight** (`deckctl preflight`) — the gig-night pass/fail
  gate; exit 1 gates cron/agents.
- 🎛️ **N75/N78 player-compat verdict** (`deckctl players`) — which
  CDJs/XDJs can read each stick, from measured dual-DB rows vs the player
  matrix.
- 📰 **O83 weekly digest** (`deckctl prep`) — fleet verdict, redundancy
  gaps, archive status, LOWQ queue as markdown.
- 🧹 **Hygiene + booth fixes** — `deckctl hygiene` and `deckctl fixes`
  drive the shelf findings ledger and the booth-fix queue (same engines as
  `megadj shelf-hygiene` / `megadj booth-fix`; apply is always the SAFE
  subset, dry by default, human-confirmed).
- 🤖 **Agent surface** (`bun run mcp`) — **37 tools** (22 `deck_*` + 15
  readonly `archive_*`); `deckctl --json` gives the same data one-shot.
  The rekordbox interlock is enforced in both.

Agents: the same surface is exposed over MCP — `bun run mcp` (from the
repo root) speaks stdio JSON-RPC.

📖 Docs: [PRD](../docs/cratedeck/02-prd.md) (brief merged in) ·
[architecture](../docs/cratedeck/03-architecture.md) ·
[acceptance](../docs/cratedeck/acceptance.md) ·
[deckctl guide](deckctl.md)
