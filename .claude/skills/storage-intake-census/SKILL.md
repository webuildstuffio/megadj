---
name: storage-intake-census
description: >-
  Answer storage questions and run safe cleanup for the megadj pipeline:
  how big the library is (honest ledger decomposition — never quote the DB
  row count as library size), which databases and backups exist and who
  owns their retention, how in-sync each source is, and how to free disk
  space with the reusable sweeps instead of one-off deletes. Use when
  asked about "size of our library", "the databases", "how in sync",
  "cleanup", "free space", "backups", or before deleting ANY file under
  ~/.local/state/megadj or ~/Library/Pioneer/rekordbox.
---

# Storage, databases, and cleanup

The Sep 18 storage audit took a full forensic session because the answers
lived in zero places. This skill is the shortcut: what exists, who owns its
retention, what is safe to sweep, and the one-command way to answer
"how big / how in sync".

## Rule zero: no one-off deletes

Every deletion path is a reusable, dry-run-default command or a documented
retention owner. If a target doesn't fit a sweep below, STOP — file an
issue describing the target and its owner instead of deleting by hand.
(Precedent: the `spike/` baselines nearly got classified as junk; they are
the compare side of the GA-07 harness — load-bearing data.)

## The databases (who holds what)

| Store                        | Path                                                               | Role                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `archive.db`                 | `~/.local/state/megadj/archive.db`                                 | THE pipeline ledger (tracks, runs, beats/mood/cues/embeddings/hygiene/fingerprints/rekordbox cross-ref) |
| lineage snapshot             | `~/.local/state/megadj/archive-db-before-<what>-<date>.db`         | "state before a risky change" evidence (e.g. the #108 drop)                                             |
| dated pipeline backups       | `archive.db.bak-<ts>`, `archive_bak_<ISO>.db`, `pre-restore-*.bak` | pre-migration / pre-restore saves                                                                       |
| `cratedeck.sqlite`           | `cratedeck/data/cratedeck.sqlite` (or `$CRATEDECK_DATA`)           | CrateDeck drives/events/jobs — NOT in the state dir                                                     |
| rekordbox master (SSOT)      | `/Volumes/SHELF1/PIONEER/Master/master.db`                         | the collection DB — only while SHELF1 is mounted                                                        |
| rekordbox master (app-local) | `~/Library/Pioneer/rekordbox/master.db`                            | the app's own DB; STALE BY DESIGN — do not delete, do not trust                                         |
| RB master backups            | `~/Library/Pioneer/rekordbox/backups-megadj/<date>-<what>/`        | SACRED (AGENTS.md) — archive by zipping, never plain-delete                                             |

Full retention table (including `spike/` and artwork stores):
[docs/getdat/data-model.md](../../docs/getdat/data-model.md) →
"The state dir and retention".

## "How big is the library?" — the honest answer

NEVER quote `SELECT COUNT(*) FROM tracks` as library size. One `tracks`
table mixes cohorts (rekordbox mirror + ingest + YouTube liked-video
metadata rows that mostly never downloaded; `pending` ≠ gap). The answer
has three parts:

```bash
# 1. bytes known to the ledger, per volume (paths must exist to count)
sqlite3 ~/.local/state/megadj/archive.db \
  "SELECT substr(file_path,1,20), COUNT(*), ROUND(SUM(file_size_bytes)/1e9,1)||' GB'
   FROM tracks WHERE file_size_bytes IS NOT NULL AND file_path != ''
   GROUP BY 1 ORDER BY 3 DESC;"

# 2. the ledger decomposition (why the raw count is ambiguous)
sqlite3 ~/.local/state/megadj/archive.db \
  "SELECT source, status, COUNT(*) FROM tracks GROUP BY 1,2 ORDER BY 1,2;"

# 3. per-source freshness — stale sources make every count a snapshot of the past
sqlite3 ~/.local/state/megadj/archive.db \
  "SELECT source, MAX(first_seen_at) FROM tracks GROUP BY 1;"
```

Honesty rules: name the volume each number lives on; if SHELF1 is unmounted
(`ls /Volumes/`), shelf-side bytes are an honest gap — say so, never a zero;
explain disk-count > DB-count by provenance (quarantine, dedupe twins), never
equate them. #253 tracks the census command that will make this one command.

## Cleanup: the two sweeps (dry-run by default, `--apply` to delete)

```bash
# 1. OS tmpdir — stale test-fixture dirs (the 16k-dir / 2.6 GB leak class)
bun src/cli.ts tmp-purge          # read-only report, >24h age gate
bun src/cli.ts tmp-purge --apply  # delete what the gate admits

# 2. the state dir — superseded archive.db backups, orphan -shm/-wal
#    sidecars of DBs not open, age-gated spike/ artifacts.
#    The NEWEST lineage snapshot per stem is ALWAYS kept; the live
#    archive.db matches no removable class by construction.
bun src/cli.ts tmp-purge --state          # report: shows kept[] + eligible
bun src/cli.ts tmp-purge --state --apply
```

Both print per-family counts + bytes and honor `--json`. Deletion classes
are test-pinned (`src/shelf/tmp-purge.test.ts`); anything new to sweep
means extending those classes WITH tests — never a manual `rm` habit.

Sep 18 measured receipts: 379 tmp dirs / 35.6 MB + 14 state items /
124.3 MB freed; live DB `quick_check` ok after both.

## Rekordbox backups: archive, never delete

Superseded backup SETS (whole dirs in `backups-megadj/`) collapse into one
dated zip + checksum, then the unzipped dirs go:

```bash
cd ~/Library/Pioneer/rekordbox/backups-megadj
ditto -c -k --sequesterRsrc --keepParent 20260904-194339-pilot \
  rekordbox_bak_2026-09-04-pilots.zip   # repeat per dir or zip the three together
shasum -a 256 rekordbox_bak_2026-09-04-pilots.zip > rekordbox_bak_2026-09-04-pilots.zip.sha256
unzip -t rekordbox_bak_2026-09-04-pilots.zip   # verify BEFORE removing sources
```

Only after `unzip -t` passes may the unzipped dirs be removed. The Sep 10
pre-pathfix set is CURRENT — untouched. (#252 owns the Sep 4 trio.)

## Before you call anything stale

- `lsof +D ~/.local/state/megadj` — any open handles? (WAL sidecars of an
  open DB are live state, not orphans.)
- Is a concurrent agent's test suite running? (`pgrep -f "bun test"`) —
  their fixtures are <24h old and the age gate already protects them; don't
  force `--all` while a suite is live.
- Rekordbox backups: sacred rule applies regardless of age.
- The playing USB (`flip-master`) is user-managed — it appears in NO
  storage inventory and no sweep ever touches it.

## Where this came from

The Sep 18 audit session: full inventory measured, P0 executed same-day
(commit 5668af4 added `tmp-purge --state`), remaining work filed as
#250–#254. The full story and the retention-owner table live in
`docs/getdat/data-model.md`.
