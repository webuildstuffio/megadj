# megadj plugin

The whole DJ-ops surface as an installable Claude Code plugin (ideas.md
**O85**): skills + MCP server + hook, so any Claude Code instance gets the
megadj operator toolkit without repo-local setup.

## What's inside

| Component | Path | What it does |
| --- | --- | --- |
| Skills | `skills/cratedeck-deckctl` | Drive health, scans/verifies, gig readiness via `deckctl` |
| | `skills/rekordbox-usb-sync` | The USB sync pipeline + safety rules |
| | `skills/new-music-intake` | `megadj ingest` usage: tagging, art, dedupe |
| MCP | `.mcp.json` → `cratedeck` | 17 tools: drive health, fleet, preflight, players, archive reads, `deck_note` |
| Hook | `hooks/hooks.json` | SessionStart: drives + interlock status in context (async, 15s timeout) |

## Install (development, from this repo)

```bash
claude --plugin-dir "$PWD/plugin"
```

Or install into any session:

```
/plugin install megadj@<path-to-this-repo>/plugin
```

## Requirements

- [megadj](https://github.com/nichm/megadj) cloned locally (`bun` installed)
- The MCP server + hook shell out to `bun run cratedeck/src/mcp.ts` /
  `deckctl` relative to `${CLAUDE_PROJECT_DIR}` — i.e. this repo must be the
  working project (a packaged release would vendor a built CLI instead; see
  roadmap note below).
- macOS only (megadj is macOS by design — PRINCIPLES.md §2).

## Safety model (unchanged from the core product)

- The rekordbox interlock is enforced **server-side** — the MCP surface
  cannot bypass it (prompts are suggestions, exit codes are law).
- `deck_run`/`deck_cancel`/`deck_note` are the only mutating tools, all
  annotation-flagged; `deck_note` is human-dismissable in the UI.
- The hook is read-only (`deckctl status`).

## Roadmap note

This is the S-effort packaging step the ideas doc gated on O82 existing.
A published marketplace variant would pin a versioned megadj checkout in
the manifest and swap `${CLAUDE_PROJECT_DIR}` for an installed CLI path —
deliberately not done yet (the cap rule: something ships or leaves first).
