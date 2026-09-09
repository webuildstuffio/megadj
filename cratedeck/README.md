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

- **Ghosts**: unplug a drive — its card stays, dimmed, with last-known data.
- **Photos**: click a card → Rename, and set a photo via
  `POST /api/drives/:id/photo {"url": ...}` (Brave/Exa search proxy at
  `GET /api/images/search?q=`; set `provider`/`key` in `config.toml` or
  `CRATEDECK_IMAGE_KEY`).
- **Jobs**: Scan / Verify / Benchmark / Checksum. All refused while
  rekordbox is running (interlock).
- **Export**: per-drive JSON dossier from the drive page.
- **Your drives**: set `master_drive` / `mirror_drive` in `config.toml`
  (copy `config.sample.toml`) to your volume names so sync status and role
  detection work.

Read-only by construction: every disk write goes through `src/guard.ts`
(allow-list = `cratedeck/data/` only). Tests: `bun test cratedeck/`.

Beyond the core: **B12 preflight** (`deckctl preflight` — the gig-night
pass/fail gate, exit 1 gates cron/agents), the **N75/N78 player-compat
verdict** (`deckctl players`), the **O83 weekly digest** (`deckctl prep`),
and the **agent surface** (`bun run mcp` — 34 tools, archive reads
included).

Agents: the same surface is exposed over MCP — `bun run mcp` (from the repo
root) speaks stdio JSON-RPC; `deckctl --json` gives the same data one-shot.
The rekordbox interlock is enforced in both.

Docs: [PRD](../docs/cratedeck/02-prd.md) (brief merged in) ·
[architecture](../docs/cratedeck/03-architecture.md) ·
[acceptance](../docs/cratedeck/acceptance.md) ·
[deckctl guide](deckctl.md)
