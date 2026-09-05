# Contributing

megadj is a zero-commercial, Mac-only hobby project. The lightest possible
contribution path — but the quality bar is real.

## Ground rules

- **macOS only. Pioneer only.** Cross-platform PRs will not be accepted.
- **No new heavyweight dependencies** without discussion first.
- Every command an operator or an agent can run must exist 1:1 — if you add
  a feature, add the `--json` output and the help text for it too.
- English only in code, docs, and commit messages.

## Setup

```bash
bun install          # Bun is the runtime (bun.sh)
uv tool install 'yt-dlp[default]'   # + ffmpeg via brew
bun run doctor       # verifies everything above
```

## Before you push

```bash
bun run check        # typecheck + lint (tsc + oxlint)
bun test             # full suite
```

Pre-commit hooks enforce both plus a per-file 800-line length cap. If a
commit is legitimately huge, the documented bypass is
`GIT_SKIP_FILE_LENGTH_CHECK=1 GIT_ALLOW_LARGE_COMMIT=1 git commit …` — use
it sparingly and say why in the commit body.

## Bugs and features

Open a GitHub issue. One topic per issue. For bugs, include: macOS version,
what you ran, what you expected, what happened (`--json` output welcome).

PRs: keep them small and focused. If it touches the rekordbox database
seam, read `docs/cratedeck/03-architecture.md` first — and never write to a
drive library in place.
