# Perf Plan — runtime speedups (round 3), deferred until a USB drive is mounted

Status: **planned, not started.** Rounds 1–2 (landed) took the dev gate from
36s → 7.4s. This plan targets the *runtime* paths (scans, sweeps, CLI), which
need a real USB volume mounted to measure honestly — the internal-SSD archive
fits in the page cache, so warm numbers silently 50× the disk truth
(measured: "15.5 GB/s" warm vs plausible ~1 GB/s cold; `sudo purge` needs a
TTY password prompt this agent doesn't have).

## Measurement harness (ready to use)

`tools/prof_sweep.ts` (commit or keep local) — read-only profiler:

```
bun tools/prof_sweep.ts /Volumes/DJMASTER     # stat walk + full read + blake2b, serial vs pooled
```

Plug the drive in, run cold (freshly mounted), run again warm, unplug.
Compare `stat serial` vs `stat batch32` and `read/hash serial` vs pools.

## Target 1 — walkTree: parallel file stats (`cratedeck/src/walk.ts`)

**Current:** recursive async walk, but `await stat(p)` one file at a time
inside the dirent loop. On a spinning/USB drive each stat is a seek —
thousands of audio files = thousands of serial round-trips.

**Change:** per directory, `await Promise.all` the file stats (dirents
already tell file vs dir for free); recurse into dirs after. Keep it
**async-only** — `walk-async.test.ts` bans `statSync`/`readdirSync` and
pins event-loop liveness; batched `fs/promises` stat satisfies both.

**Expected:** stat phase dominates on HDD USB; batching 32-wide typically
cuts walk wall time 3–8× cold. Feeds scan (light snapshot), bench
(biggestFiles), and checksumLedger (file list).

## Target 2 — sweepArchive: concurrent hashing (`cratedeck/src/archive_sweep.ts`)

**Current:** strict `for` loop — `stat` then `hashFile` then ledger compare,
one file at a time; ~15s for 3.8GB on the real archive (HDD-class) and the
long pole of `deckctl prep` / weekly digest (client timeout budgeted 60s
just for this leg).

**Change:** fixed-width worker pool (start 4–8, tune with the harness).
Constraints that must survive:
- `update()` ledger writes stay serialized — run them on the single
  coordinator loop after each worker's compare, never inside workers
  (sqlite upsert + Map mutations are not concurrent-safe).
- `signal.aborted` still checked per file; findings order may interleave —
  sort findings by path before return if any test pins order (none
  currently do — `archive_sweep.test.ts` uses `[0]` on single-finding
  fixtures only).
- Verdicts stay byte-identical: same hash, same trusted-hash logic
  (flagged rows compare vs `known_good_*`), same first-sighting baseline.

**Expected:** 3–6× on the sweep leg on USB-class disks (queue depth is the
win; blake2b on ASi is not the bottleneck — warm it is: 1.07 GB/s hash vs
1.55 GB/s read).

## Target 3 — bench.ts benchmarkDrive random reads: small-batch concurrency

**Current:** 4000 sequential `await file.slice().arrayBuffer()` — correct
for measuring a drive's serial random-IOPs, but the *job* wall time is long.

**Change (optional, changes semantics):** batch 8–16 reads per await.
⚠️ This alters what the benchmark measures (queued vs single outstanding
read) — only do it if we accept the metric shift, or add a depth knob and
keep depth=1 as the default. Needs a deliberate product call, hence
last in the plan.

## Non-targets (checked, already fast or intentionally serial)

- CLI cold start (`deckctl status --json`, `megadj status --json`):
  50–70ms — Bun startup, nothing to win.
- `fetchWeeklyPrepInput`: already `Promise.all` fan-out.
- preflight/report/fleet: pure in-memory over snapshot JSON — sub-ms.
- rb_read.py: one sqlite open per snapshot; ~1s per call measured, driven
  by the dual-DB read itself, not fixable from TS.

## Verification protocol (when a drive is mounted)

1. `bun tools/prof_sweep.ts /Volumes/<drive>` cold → record.
2. Apply Target 1; re-run; confirm walk speedup + `bun test
   cratedeck/test/walk-async.test.ts cratedeck/test/scan-detect.test.ts`.
3. Apply Target 2; re-run; confirm sweep speedup + `bun test
   cratedeck/test/archive_sweep.test.ts`.
4. Full `bun run check:full` (must stay green, 100% typecov).
5. E2E against the mounted drive: `deckctl run <drive> scan`, then
   `deckctl prep` — confirm the digest still includes the D30 section.
