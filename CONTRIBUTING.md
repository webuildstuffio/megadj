# Contributing

**Status:** ✅ CURRENT — local contribution and verification contract.

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
bun run check        # TypeScript + lint + format + knip + web build
bun test             # full suite, parallel
# or the superset:
bun run check:full   # adds tests, 100% type coverage, and Python gates
```

Pre-commit runs staged-scope tests plus the repository guards, so another
worktree participant's unrelated untracked test does not block your commit.
Pre-push runs the full Bun suite. The hooks also enforce the per-file 800-line
cap. If a commit is legitimately huge, the documented bypass is
`GIT_SKIP_FILE_LENGTH_CHECK=1 GIT_ALLOW_LARGE_COMMIT=1 git commit …` — use
it sparingly and say why in the commit body.

## Local data and experiments

Keep the checkout source-only. Reusable experiment harnesses belong in
`tools/` with tests and a durable result summary in `docs/`; generated tables,
plots, and review bundles belong in the gitignored `reports/` directory.
Disposable scratch uses the OS temporary directory, while expensive reusable
experiment caches belong under `~/.cache/megadj/`.

Product state is not an experiment artifact: embeddings and analysis results
live in `archive.db`, FullTags models live in
`~/.local/share/fulltags-models/`, and CrateDeck uses `CRATEDECK_DATA` (with
the gitignored `cratedeck/data/` fallback for local development). Raw audio
belongs in the configured archive or shelf, never in this repository. Runtime
logs belong under `~/.local/state/megadj/`, not beside source files.

The normal quality gate runs `bun run repo:hygiene`, which fails if a tracked
path also matches the repository's ignore policy. Do not force-add generated
files to bypass it.

## Bugs and features

Open a GitHub issue. One topic per issue. For bugs, include: macOS version,
what you ran, what you expected, what happened (`--json` output welcome).

PRs: keep them small and focused. If it touches the rekordbox database
seam, read `docs/cratedeck/03-architecture.md` first — and never write to a
drive library in place.
