# AGENTS.md — megadj

This file contains only rules and traps. Product detail belongs in
[`docs/`](docs/) and the full incident history is in
[`docs/agent-playbook.md`](docs/agent-playbook.md).

## Non-negotiables

- English only. Product decisions follow [`docs/PRINCIPLES.md`](docs/PRINCIPLES.md).
- macOS/Pioneer only; no CI. Before pushing: `bun run check && bun test`.
  Type coverage is a hard 100%: `bun run check:full`. `check` also runs knip
  and the web vite build; `check:full` additionally runs the Python gates
  (`lint:py` ruff + `typecheck:py` mypy strict over `cratedeck/python` and
  `tools/*.py`) and coverage lives in `test:coverage`.
- Pre-commit runs STAGED-SCOPED tests (`SC_HOOK_TEST_SCOPE=staged` in
  `.shell-config-hooks.conf`): only test files in packages touched by the
  staged paths. That makes untracked WIP test files from concurrent agents
  invisible to your commit — the FULL suite is still the pre-push gate, so
  run `bun test` before pushing.
- Never use `git add -A`; preserve concurrent work. Re-read before editing and
  verify the worktree diff, not only a commit hash.
- No bare production `catch {}` or `.catch(() => {})`. Boundary `JSON.parse`
  uses a guarded parser and exposes failure. Gate numeric boundaries with
  `Number.isFinite`; CLI numeric options use `nonNegOpt` (bad input: exit 2,
  zero work).
- Strict TypeScript is live: `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noUncheckedSideEffectImports`, and
  `allowUnreachableCode:false`. Oxlint and formatting are part of the gate.
- One source of truth per shared surface. Derive types, job lists, help,
  counts, and census strings from producers; never maintain hand-copied twins.
- Do not commit private identifiers, local paths, stored state, or secrets.
  After every commit verify `git log --oneline -1` and `git status`.
- No dependency bumps without the release-age floor and a full gate.

## Core workflow

`megadj sync` downloads; `megadj ingest` imports; `megadj fetch`/`audit`
enriches and verifies; `megadj shelf-sync` sends archive → shelf;
`megadj shelf-archive` sends drive → shelf. Every command supports `--json`
with one summary object on stdout and a meaningful exit code.

The shelf is the archive master. `shelf-archive` is additive, junk-filtered,
NFC/casefold matched, MD5 verified, and preserves divergent same-name files.
Use `--deep` for byte comparison and `--trashes --into F` for flat trash
intake. Quarantine/staging directories belong at the shelf root, never under
`Contents/`; never walk `PIONEER/`, but do walk `PIONEER REC/`.

ExFAT rsync can wedge. Use the proven per-directory tar-pipe/file-count
resume flow in the shelf-intake skill. Move files individually and verify the
destination hash; whole-directory moves can lose files.

Ingest batches live inside the archive music directory. Re-ingesting the same
batch is a safe no-op, and each dump gets its own fresh folder. The hygiene
engine owns the listen-first guard: `quality-diff`, `oddball`, and `ear-check`
findings cannot be batch-confirmed from any spoke.

## Rekordbox and hardware safety

- Quit rekordbox before DB work. Never write drive DBs in place or delete
  source files. Dated `~/Music/rekordbox/rekordbox_bak_*.zip` backups are
  sacred.
- The master DB is `/Volumes/SHELF1/PIONEER/Master/master.db` by default;
  configured volume names always win over examples. Pass DB paths
  positionally to Python seams and verify every row's file exists after any
  path rewrite. The local `~/Library/Pioneer/rekordbox/master.db` is stale.
- CrateDeck reads scratch copies of device DBs and refuses while rekordbox is
  running. Shelf-tier empty `PIONEER/rekordbox/` is correct; do not export to
  the shelf. Role-aware checks come only from
  `cratedeck/shared/check_matrix.ts`.
- Import order is `megadj shelf-sync`, then drag from the shelf volume, never
  from local staging. WAV artwork is unsupported by rekordbox: ingest converts
  WAV → AIFF. TKEY is reliable on AIFF/MP3 and RB analysis can overwrite it.

## CrateDeck invariants

- `cratedeck/shared/types.ts` is the import leaf. Keep web payloads derived
  from it and run the documented madge cycle check when changing boundaries.
- Keep snapshot/checksum work async; only physical external hardware passes
  `detect.ts`. Unknown-only checks are never healthy; bitrot requires real
  checksum results.
- API legs have longer client deadlines, SSE has a heartbeat/reaper, and UI
  coalesces job events. Caps are 20 snapshots and 2,000 events per drive.
- Jobs watch progress fraction, not log activity. Every leg has a wall-clock
  budget; cancellation never forces progress to 1. `setJobProgress` is
  tri-state (`undefined` keep, `null` clear).
- `deckctl help` works with the server down. `--help` is stdout/exit 0.
  `deckctl`/MCP/web capabilities need a twin or an explicit row in
  [`docs/surface-parity.md`](docs/surface-parity.md). Hover cards are portal
  rendered through `tipPlace.ts`, never clipped CSS descendants.

## FullTags invariants

- `setFileTags` and `writePatchSync` stay synchronous; do not spawn Bun to
  bridge sync work. Writers are format-specific: mutagen for AIFF/WAV art and
  AIFF tags, ID3v2.3 for MP3, and atomic temp-file replacement.
- Analysis lives in DB ledgers until its write gate passes. Positive ONNX
  labels come first except `mood_party`; saturated heads fail loudly. Audit
  requires mood + energy and reruns are idempotent.
- Booth compatibility is data-driven by `[booth].fleet`/
  `MEGADJ_FLEET`; `player-compat.ts` and `booth-text.ts` enforce the selected
  fleet. `megadj booth-fix` proposes by default.

## Documentation and local state

- Docs changes go through the docs audit before pushes. Dated docs are
  snapshots; completed work gets a status header and shipped marker. State
  belongs in the DB, not hand-maintained markdown.
- Keep this file short and durable: record rules, invariants, and failure
  traps only. Do not embed volatile file trees, counts, session notes, or
  duplicated product detail; link to the owning document instead.
- For GitHub work, use one `type:*`, one `priority:*`, and one `effort:*`
  label per issue. Bug fixes require a reproducer/regression test, local
  verification, and an evidence-based close; docs issues close only when the
  documented outcome is live and cross-links validate.
- Use `megamem search` for tracked Markdown discovery; do not manually
  re-index after edits. Local index/artifacts and the ops log stay gitignored.
- No one-off scripts in the repo. Encode safety in reusable commands, tests,
  and skills. Hardware-gated work ends as an executable runbook.
