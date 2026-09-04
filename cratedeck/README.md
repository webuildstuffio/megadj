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
- **Jobs**: Scan / Verify / Benchmark / Checksum from the drawer. All
  refused while rekordbox is running (interlock).
- **Export**: per-drive JSON dossier from the drawer.

Read-only by construction: every disk write goes through `src/guard.ts`
(allow-list = `cratedeck/data/` only). Tests: `bun test cratedeck/`.

Docs: [product brief](../docs/cratedeck/01-product-brief.md) ·
[PRD](../docs/cratedeck/02-prd.md) ·
[architecture](../docs/cratedeck/03-architecture.md) ·
[build plan](../docs/cratedeck/04-build-plan.md)
