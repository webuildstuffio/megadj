# deckctl — CrateDeck CLI

Agent- and human-facing CLI for CrateDeck (the DJ USB dashboard). Talks to the
CrateDeck server on `127.0.0.1:7742`; auto-starts the server if it isn't running.

```bash
bun run cratedeck/src/deckctl.ts <command> [--json]
```

## Commands

| Command              | What it does                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `status`             | rekordbox lock state, every drive with badges, active jobs                                                                     |
| `drives`             | drive list with per-badge ✓/▲/✕ verdicts                                                                                       |
| `report <drive>`     | full health dossier: every check, its detail, why it matters, and the fix                                                      |
| `run <drive> <kind>` | enqueue + **follow** a job live: spinner, %, current step, rolling ETA. Kinds: `scan` `verify` `mirror` `benchmark` `checksum` |
| `coverage [min]`     | fleet coverage matrix: tracks per drive + at-risk list (tracks below `min` copies, default 2)                                  |
| `redundancy [min]`   | per-playlist redundancy audit: every track on ≥`min` drives? pass/warn/fail per playlist                                       |
| `diff <driveA> <driveB>` | drive-vs-drive inventory diff: added / removed / changed bytes                                                             |
| `jobs`               | recent jobs with progress/messages                                                                                             |
| `cancel <jobId>`     | cancel an active job                                                                                                           |
| `stop`               | stop the CrateDeck server                                                                                                      |

`<drive>` = volume name, nickname, or UUID.

## Fleet commands

`coverage`, `redundancy`, and `diff` are pure reads over fleet tables that are
refreshed on every **scan** — run `deckctl run <drive> scan` on each mounted
drive first, then:

```bash
deckctl coverage            # which tracks live on which drives + 1-copy risks
deckctl coverage 3          # custom redundancy floor
deckctl redundancy          # "every track in this playlist is on ≥2 drives — PASS"
deckctl diff MASTER MIRROR  # master vs mirror drift
deckctl coverage --json     # feed agents/dashboards
```

## Flags

- `--json` — machine-readable. `status`/`drives`/`report`/`jobs` print one JSON
  document; `run --wait --json` prints one JSON job line per state change
  (status/progress/message/eta) — ideal for agents polling progress.
- `--no-wait` — with `run`: enqueue and return immediately.

## Exit codes

| Code | Meaning                                              |
| ---- | ---------------------------------------------------- |
| 0    | success                                              |
| 1    | job failed / verify FAILED / drive not mounted       |
| 2    | usage error (unknown drive, bad kind)                |
| 3    | **interlock**: rekordbox is running — all ops locked |
| 4    | server unreachable and could not be started          |

## Safety model

- Jobs are refused with exit 3 while rekordbox is open (pid included in the
  message). This is the interlock — never bypass it; quit rekordbox instead.
- Everything except job execution is read-only. Scans/verifies/checksums never
  write to the drive.
- `verify` is slow (hashes every file, minutes). `scan` is ~10–60s.
  First `checksum` run hashes the whole library; later runs only hash files
  whose size/mtime changed.

## Typical agent flow

```bash
deckctl status --json                     # what's plugged in, locked?
deckctl run MASTER scan                   # refresh stats (follows live)
deckctl report MASTER                     # read verdicts + fixes
deckctl coverage                          # what survives a drive death?
deckctl run MASTER checksum --json --wait # machine-readable progress lines
```
