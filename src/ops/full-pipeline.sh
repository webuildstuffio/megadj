#!/bin/bash
# megadj full-pipeline analysis (drive-day) — the reusable one-shot.
# Encodes the Sep 20 manual sequence so the next drive day is ONE command.
#
#   bash src/ops/full-pipeline.sh [--with-sync]
#
# Stages (serial — ONE DB writer at a time; sqlite busy_timeout is 5s and
# two writers = the exact-5s parallel-suite flake):
#   1. fetch --genres --revote on SHELF1/Contents (MEGADJ_MUSIC_DIR scope)
#   2. fetch --genres --revote local scope (DJ-Imports batches)
#   3. mood --embeddings (fills embedding gaps for the genre kNN)
#   4. cues (derive phrase cues from the beats ledger)
#   5. genre --eval (LOO harness) — gate-conditional apply at ≥65%
# YouTube sync (--with-sync) runs LAST by owner policy, never mid-chain.
set -u
# Repo root = two levels up from this script (src/ops → src → repo root).
# Do NOT use import.meta.dir-style single ".." here: from src/ops that lands
# in src/, where "src/cli.ts" does not exist and every stage no-ops with
# 'error: Module not found "src/cli.ts"' (caught live Sep 24, drive day).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT" || exit 1
if [ ! -f "src/cli.ts" ]; then
  echo "FATAL: repo root resolution failed — src/cli.ts not found at $REPO_ROOT" >&2
  exit 1
fi
MAIN_LOG=/tmp/megadj-full-pipeline-$(date +%F).log
SHELF="${MEGADJ_SHELF:-/Volumes/SHELF1/Contents}"
GENRE_GATE=65
say() { echo "=== [$(date +%H:%M:%S)] $*" | tee -a "$MAIN_LOG"; }

say "full-pipeline start (shelf: $SHELF)"

if [ ! -d "$SHELF" ]; then
  say "SHELF NOT MOUNTED at $SHELF — nothing to do (exit 1)"
  exit 1
fi

say "stage 1/5: shelf revote"
MEGADJ_MUSIC_DIR="$SHELF" bun src/cli.ts fetch --genres --revote --json >> "$MAIN_LOG" 2>&1
say "stage 1 done"

say "stage 2/5: local revote"
bun src/cli.ts fetch --genres --revote --json >> "$MAIN_LOG" 2>&1
say "stage 2 done"

say "stage 3/5: mood --embeddings backfill"
bun src/cli.ts mood --embeddings --json >> "$MAIN_LOG" 2>&1
say "stage 3 done"

say "stage 4/5: cues"
bun src/cli.ts cues --json >> "$MAIN_LOG" 2>&1
say "stage 4 done"

say "stage 5/5: genre --eval (gate ${GENRE_GATE}%)"
bun src/cli.ts genre --eval --json > /tmp/genre-eval-latest.json 2>&1
AGREE=$(bun -e 'try{const r=await Bun.file("/tmp/genre-eval-latest.json").json();console.log(String(r.agreement ?? r.measured ?? 0))}catch{console.log("0")}' 2>/dev/null || echo 0)
say "eval agreement: $AGREE"
# bun -e argv: [bun, arg1, arg2] — arg1 = agreement, arg2 = gate (argv[1]/argv[2]).
if bun -e "process.exit(Number(process.argv[1]??0)*100>=Number(process.argv[2]??65)?0:1)" "$AGREE" "$GENRE_GATE"; then
  bun src/cli.ts genre --apply --json >> "$MAIN_LOG" 2>&1
  say "genre --apply done (gate passed)"
else
  say "genre --apply SKIPPED (below gate — honest gap stands)"
fi

if [ "${1:-}" = "--with-sync" ]; then
  say "stage 6 (owner-approved): YouTube sync"
  bun src/cli.ts sync --sources LL --music-only --json >> "$MAIN_LOG" 2>&1
  say "sync done — then rerun this script WITHOUT --with-sync to analyze the new rows"
fi

say "full-pipeline ALL DONE — log: $MAIN_LOG"
