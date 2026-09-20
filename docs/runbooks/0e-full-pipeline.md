# 0e — Drive-Day Full Pipeline (the one command)

**Status:** ✅ ACTIVE — the Sep 20 manual sequence, encoded. `ops/full-pipeline.sh`
owns the order; this runbook owns the WHY and the verification.

## The command

```bash
bash ops/full-pipeline.sh              # analysis chain (no YouTube)
bash ops/full-pipeline.sh --with-sync  # + YouTube sync LAST (owner go required)
```

Env knobs: `MEGADJ_SHELF` (default `/Volumes/SHELF1/Contents`).
Log lands in `/tmp/megadj-full-pipeline-<date>.log`.

## Stage order and why it is serial

1. **`fetch --genres --revote` (shelf scope)** — the vote ladder over the
   old-system rows (file genre present, row `genre_votes` empty). Shelf
   first: the biggest cohort (3.4k rows), while the drive is mounted.
2. **`fetch --genres --revote` (local scope)** — the `~/Music/DJ-Imports`
   batch folders (~100 rows).
3. **`mood --embeddings`** — backfills embedding gaps (mood-ledgered but
   unembedded rows). Runs BEFORE the kNN stage so the new rows can seed.
4. **`cues`** — derives 8-bar phrase cues for any beat-analyzed track
   missing them. After fetch so freshly-elected rows are covered.
5. **`genre --eval` → gate-conditional `genre --apply`** — the LOO harness
   measures agreement; `--apply` (audio-kNN inference) fires ONLY at ≥65%
   agreement. Below the gate the gap stands honestly — never a
   manufactured pass (genre-pipeline.md §V2).
6. **`--with-sync` only: YouTube sync** — ALWAYS last (owner policy,
   Sep 20: "dont do the new youtube videos though until the end"). Serial
   `--sources LL` by design (parallel yt-dlp = IP-403 storms). After sync,
   re-run the script WITHOUT `--with-sync` so the new rows get analyzed.

**One DB writer at a time.** `archive.db`'s busy_timeout is 5s — two
concurrent writers is the exact-5s parallel-suite flake. Never background
two stages.

## Pre-flight (the agent checks, not the script)

- rekordbox quit (interlock clear) — the shelf tags are file-writes, but
  any rb-* step later needs the app closed.
- `git status` + `git log --oneline -5` — concurrent-agent check; don't
  launch a multi-hour chain on a tree mid-refactor.
- Free disk / mount health: `df -h /Volumes/SHELF1`.
- **Stale-path check (Sep 20 trap):** rows whose `file_path` died in a
  folder reorg are INVISIBLE to every analysis pass (file-missing skip).
  Run `megadj adopt --shelf` (dry-run) first — any `repointed > 0` means
  heal with `--apply` BEFORE the chain, or those tracks never analyze.
- **bun `-e` gate hygiene:** `bun -e` indexes argv from the program name
  (argv[0]) — pass a placeholder and read operands from argv[2]+. And
  `genre --eval` returns a 0..1 FRACTION; compare `fraction*100 >= 65`,
  never the raw fraction (both bugs shipped in v1 of this script and
  would have made `genre --apply` unreachable — fixed 141d15bb).

## Verification (after ALL DONE)

- Genre cohorts through sqlite: voted vs unvoted vs no-genre counts
  (see usb-sync-log 2026-09-20 entry for the exact queries).
- Spot-check ONE track end-to-end: file tag (`ffprobe -show_entries
  format_tags=genre`) == DB `genre` == votes JSON non-empty.
- `megadj status --json` — counts move coherently; no status
  explosion.
- `megadj audit` — the completeness read-only verdict.
- Re-run the stale-path check: `megadj adopt --shelf` must report
  `repointed: 0`.

## History

The Sep 20 run that produced this script: manual stages, live in
`docs/usb-sync-log.md` (2026-09-20 entry). The orphan-runs bug found that
day (302 open run rows; sync crashed/killed between startRun and
finishRun) is fixed in the same pass — sync's `finally` now closes the
run row on ANY throw. Two more same-day catches, both fixed:
`tmp-purge --orphan-runs` (closes crashed-run rows, never the newest 24h
or any run that did work) and the gate-math fix above (141d15bb).
