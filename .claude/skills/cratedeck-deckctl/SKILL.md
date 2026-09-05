---
name: cratedeck-deckctl
description: Drive health dashboard + agent CLI for the megadj DJ USB drives. Use when checking drive health, running scans/verifies/checksums, or answering "is my USB ready for a gig".
---

# CrateDeck / deckctl

CrateDeck is the local web dashboard (`bun run deck`, http://127.0.0.1:7742)
for the DJ USB drives. `deckctl` is its CLI — agents should use `deckctl`, not
curl, so they get the interlock check and consistent exit codes.

## Quick start

```bash
bun run cratedeck/src/deckctl.ts status          # lock state + all drives
bun run cratedeck/src/deckctl.ts report YOUR_MASTER
bun run cratedeck/src/deckctl.ts run YOUR_MASTER scan    # follows live w/ ETA
```

## Fleet questions (cross-drive)

After each drive has been scanned at least once (fleet tables refresh on
every scan):

```bash
bun run cratedeck/src/deckctl.ts coverage        # which tracks on which drives + 1-copy risks
bun run cratedeck/src/deckctl.ts redundancy      # per-playlist: every track on ≥2 drives?
bun run cratedeck/src/deckctl.ts diff YOUR_MASTER YOUR_MIRROR   # master vs mirror drift
```

`coverage`/`redundancy` take an optional floor (`coverage 3`). All three
support `--json`.

## Rules

1. **Interlock is sacred**: if rekordbox is running, every job exits with code
   3. Never bypass — quit rekordbox first (its DBs must not be touched while
   open).
2. Read `cratedeck/deckctl.md` for full flags/exit codes. Use `--json` when
   another program consumes the output.
3. Check statuses are honest: `unknown` means "not measured yet" — run the
   suggested job (Scan/Verify/Checksum/Benchmark) rather than assuming health.
4. Verdict meanings: `critical` = don't use for a gig (bitrot, too slow, pdb
   divergence, nearly full). `attention` = usable but fix soon. `healthy` =
   all measured checks pass.
5. A drive must be **mounted** to run jobs; ghosts show last-known data only.
