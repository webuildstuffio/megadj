#!/bin/bash
# megadj full-pipeline analysis (drive-day) — the reusable one-shot.
# Encodes the Sep 20 manual sequence so the next drive day is ONE command.
#
#   bash ops/full-pipeline.sh [--with-sync]
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
cd "$(dirname "$0")/.." || exit 1
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
if bun -e "process.exit(Number(process.argv[2]??0)*100>=Number(process.argv[3]??65)?0:1)" bun "$AGREE" "$GENRE_GATE"; then
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
