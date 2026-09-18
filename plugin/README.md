# megadj plugin

**Status:** ✅ SHIPPED — installable Claude Code plugin.

The whole DJ-ops surface as an installable Claude Code plugin (ideas.md
**O85**): skills + MCP server + hook, so any Claude Code instance gets the
megadj operator toolkit without repo-local setup.

## What's inside

| Component | Path                        | What it does                                                                                                                                                                                                                                                                           |
| --------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skills    | `skills/cratedeck-deckctl`  | Drive health, scans/verifies, gig readiness via `deckctl`                                                                                                                                                                                                                              |
|           | `skills/rekordbox-usb-sync` | SHELF1 preparation, playing-USB no-touch boundary, and read-only verification                                                                                                                                                                                                          |
|           | `skills/new-music-intake`   | `megadj ingest` usage: tagging, art, dedupe                                                                                                                                                                                                                                            |
| MCP       | `.mcp.json` → `cratedeck`   | 39 tools (22 `deck_*` + 2 `getdat_*` + 15 `archive_*`): drive health, fleet, preflight, players, notes, rename, dossier export, hygiene + booth fixes, booth fleet, GetDat intake/conversion, search, prep digest, archive reads (including grid cross-check, mood profile, and sweep) |
| Hook      | `hooks/hooks.json`          | SessionStart: drives + interlock status in context (async, 15s timeout)                                                                                                                                                                                                                |

**Skills are symlinks** into `../../.claude/skills/` — the in-repo skill
directories are the single source of truth; editing a skill updates the
plugin copy too (no byte-duplicated fork to drift). A published/marketplace
build would dereference them at package time.

## Install (development, from this repo)

```bash
claude --plugin-dir "$PWD/plugin"
```

Or install into any session:

```
/plugin install megadj@<path-to-this-repo>/plugin
```

## Requirements

- [megadj](https://github.com/webuildstuffio/megadj) cloned locally (`bun` installed)
- The MCP server + hook shell out to `bun run cratedeck/src/mcp.ts` /
  `deckctl` relative to `${CLAUDE_PROJECT_DIR}` — i.e. this repo must be the
  working project (a packaged release would vendor a built CLI instead; see
  roadmap note below).
- macOS only (megadj is macOS by design — PRINCIPLES.md §2).

## Safety model (unchanged from the core product)

- The rekordbox interlock is enforced **server-side** — the MCP surface
  cannot bypass it (prompts are suggestions, exit codes are law).
- `deck_run`/`deck_cancel`/`deck_note`/`deck_rename`/`deck_dismiss`/
  `deck_hygiene`/`deck_fixes` are the mutating tools (all
  `destructive`-flagged; the `archive_*` half is readonly by
  construction); `deck_note` is human-dismissable in the UI.
- The hook is read-only (`deckctl status`).

## Roadmap note

This is the S-effort packaging step the ideas doc gated on O82 existing.
A published marketplace variant would pin a versioned megadj checkout in
the manifest and swap `${CLAUDE_PROJECT_DIR}` for an installed CLI path —
deliberately not done yet (the cap rule: something ships or leaves first).

## Status (2026-09-17, #208 audit)

**KEEP — dormant but wired.** Who launches it: nobody today — this is
NOT in `~/.claude/plugins/installed_plugins.json` and has no Cursor MCP
entry; the operator works through the repo-local `deckctl` MCP + skills
instead. Last exercised: 2026-09-17 (the #208 audit re-proved the
wiring end-to-end — MCP initialize handshake + `tools/list` (43 tools),
SessionStart hook `deckctl status --json` returned a live payload). The
"1,740 LOC" in the audit issue was a symlink double-count: every
`plugin/skills` file is a git symlink (mode 120000) into
`.claude/skills/` — unique plugin content is 96 LOC across 4 files, and
it can never drift from the audited MCP surface by construction. Cut
candidate if a future pass wants the directory gone; nothing here is
load-bearing.
