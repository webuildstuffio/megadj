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
#
# #341: every stage captures its exit code and aborts loudly on failure.
# A crashed stage used to say "done" unconditionally — the exact silent-
# success pattern 36bf059 fixed one layer up, replicated one layer down.
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

# run_stage N LABEL cmd...  — runs a stage, captures exit code, aborts on
# failure instead of printing "done". The log carries both the stage output
# AND the verdict so a crashed run is diagnosable from the log alone.
run_stage() {
  local num="$1" label="$2"; shift 2
  say "stage ${num}: ${label}"
  local rc=0
  "$@" >> "$MAIN_LOG" 2>&1 || rc=$?
  if [ "$rc" -ne 0 ]; then
    say "STAGE ${num} FAILED (exit ${rc}) — aborting pipeline"
    say "see log for details: $MAIN_LOG"
    exit "$rc"
  fi
  say "stage ${num} done (exit 0)"
}

say "full-pipeline start (shelf: $SHELF)"

if [ ! -d "$SHELF" ]; then
  say "SHELF NOT MOUNTED at $SHELF — nothing to do (exit 1)"
  exit 1
fi

run_stage "1/5" "shelf revote" env MEGADJ_MUSIC_DIR="$SHELF" bun src/cli.ts fetch --genres --revote --json
run_stage "2/5" "local revote" bun src/cli.ts fetch --genres --revote --json
run_stage "3/5" "mood --embeddings backfill" bun src/cli.ts mood --embeddings --json
run_stage "4/5" "cues" bun src/cli.ts cues --json

say "stage 5/5: genre --eval (gate ${GENRE_GATE}%)"
bun src/cli.ts genre --eval --json > /tmp/genre-eval-latest.json 2>&1
EVAL_RC=$?
if [ "$EVAL_RC" -ne 0 ]; then
  say "STAGE 5/5 genre --eval FAILED (exit ${EVAL_RC}) — aborting pipeline"
  say "see log for details: $MAIN_LOG"
  exit "$EVAL_RC"
fi
# Parse agreement — the bun -e extractor reads the eval JSON; on parse
# failure the agreement reads as 0 (gate refuses, honest gap stands).
AGREE=$(bun -e 'try{const r=await Bun.file("/tmp/genre-eval-latest.json").json();console.log(String(r.agreement ?? r.measured ?? 0))}catch{console.log("0")}' 2>/dev/null || echo 0)
if [ -z "$AGREE" ]; then
  say "genre --eval produced no agreement value — treating as 0"
  AGREE=0
fi
say "eval agreement: ${AGREE} (gate: ${GENRE_GATE}%)"
if bun -e "process.exit(Number(process.argv[1]??0)*100>=Number(process.argv[2]??65)?0:1)" "$AGREE" "$GENRE_GATE"; then
  run_stage "5/5 apply" "genre --apply" bun src/cli.ts genre --apply --json
else
  say "genre --apply SKIPPED (below gate — honest gap stands)"
fi

if [ "${1:-}" = "--with-sync" ]; then
  run_stage "6" "YouTube sync" bun src/cli.ts sync --sources LL --music-only --json
fi

say "full-pipeline ALL DONE — log: $MAIN_LOG"
