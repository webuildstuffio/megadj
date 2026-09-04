# AGENTS.md — megadj

## Learned User Preferences

- Tracks long multi-session sync work via a status canvas (`/~/.cursor/projects/canvases/rekordbox-usb-sync-status.canvas.tsx`) and expects it kept current — asks "wasn't there a canvas for this?" when returning to the repo.

## Learned Workspace Facts

- megadj is a YTMusic archiver (Bun/TypeScript CLI) feeding two DJ USB drives: `DJMASTER` (master) and `DJMIRROR` (mirror, kept identical).
- Rekordbox device libraries are dual-DB: OneLibrary `exportLibrary.db` (SQLCipher) plus legacy `export.pdb`/`exportExt.pdb`/`playlists3*.sync` that older players (XDJ-XZ, legacy CDJs) read; a sync is only done when the export.pdb live-row count equals the OneLibrary count. Full pipeline + safety rules (quit rekordbox before DB edits, never write drive DBs in place, never delete source files) live in `.claude/skills/rekordbox-usb-sync/SKILL.md`.
- `megadj ingest` (`src/commands/ingest.ts`) imports external downloads into the archive: MusicBrainz album/date fill, iTunes artwork embedding, genre inference, `--dry-run` flag; source files are never modified. User-facing guide: `.claude/skills/new-music-intake/SKILL.md`.
- CrateDeck (`cratedeck/`) is an in-repo Bun + TypeScript + Preact web dashboard showing USB drive status, playlists, analysis/beatgrid state, and health, reading rekordbox data through a Python seam (`cratedeck/python/rb_read.py`); canonical product docs live in `docs/cratedeck/` (brief, PRD, architecture, build plan, acceptance), ideas backlog in `docs/ideas.md`.
- CrateDeck's drive health report (`cratedeck/src/report.ts`) is the SSOT for readiness verdicts: dual-DB hardware gate, beatgrid coverage, space, bitrot, mirror parity — exposed at `GET /drives/:id/report` and folded into the `/drives/:id/export` dossier; served in the drawer's Report tab. Doc set status: `docs/cratedeck/acceptance.md`.
- `deckctl` (`cratedeck/src/deckctl.ts`) is the agent/user CLI over CrateDeck: `status|drives|report|run|jobs|cancel|stop`, `--json` for machines, live spinner+ETA on `run`, exit code 3 = rekordbox interlock. Never bypass the interlock; auto-starts the server. Guide: `cratedeck/deckctl.md`, agent skill: `.claude/skills/cratedeck-deckctl/SKILL.md`.
- CrateDeck engineering invariants: `rbSnapshot`/`checksumLedger` must stay async (spawnSync/hash loops once froze the server for minutes); snapshots capped at 20/drive and events at 2000/drive (disk-burn guard, enforced in `db.ts` migrations); `overall()` never reports `healthy` when every check is `unknown`; bitrot verdicts come from real checksum job results (`db.latestChecksum`), never hardcoded.
