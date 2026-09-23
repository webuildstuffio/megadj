# Data Stores and Schema Ownership

**Status:** 📚 REFERENCE — current database roles and executable schema owners.

This page is a map, not a copy of the DDL. Schema definitions and migrations
remain executable beside the code that uses them; copying columns here would
create a second source of truth.

## The three database roles

| Store                | Role                                                                                  | Schema owner                                                                                                                                 | Read/write boundary                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `archive.db`         | GetDat pipeline state and FullTags/Set analysis ledgers                               | [`src/core/state-core.ts`](../../src/core/state-core.ts) plus the extension producers listed below                                     | megadj owns writes; CrateDeck opens its archive view read-only                                                      |
| `cratedeck.sqlite`   | Drive registry, events, snapshots, jobs, checksums, benchmarks, and fleet projections | [`src/deck/db/core.ts`](../../src/deck/db/core.ts) and the domain stores behind [`src/deck/db.ts`](../../src/deck/db.ts) | CrateDeck only; WAL-backed local application state                                                                  |
| rekordbox collection | `master.db` rows plus the `masterPlaylists6.xml` playlist twin                        | rekordbox/pyrekordbox, reached through `src/rekordbox/*` and the CrateDeck Python seam                                                       | rekordbox is authoritative; megadj mutations require rekordbox closed, dated backups, and full re-read verification |

`archive.db` is not a collection mirror and its row count is not the library
size. The `rekordbox_content` table is an explicit cross-reference created by
`megadj rb-adopt`; it does not change the database's pipeline-ledger role.

## `archive.db` producers

- [`src/core/state-core.ts`](../../src/core/state-core.ts) owns the connection,
  core `tracks`/`runs` tables, analysis tables, indexes, and additive column
  migration seam.
- [`src/core/ledgers.ts`](../../src/core/ledgers.ts),
  [`state_beats.ts`](../../src/core/state-beats.ts), and
  [`similar.ts`](../../src/core/similar.ts) own typed access to beats, mood,
  cues, embeddings, and key caches.
- [`src/core/hygiene/store.ts`](../../src/core/hygiene/store.ts) owns hygiene
  findings and the operation lock.
- [`src/core/sweeps.ts`](../../src/core/sweeps.ts) owns shelf-sweep receipts.
- [`src/rekordbox/rb-adopt.ts`](../../src/rekordbox/rb-adopt.ts) owns the
  rekordbox-content cross-reference.
- [`src/shelf/dupescan-shared.ts`](../../src/shelf/dupescan-shared.ts) owns the
  fingerprint cache used by shelf duplicate scans.

The stable public façade is [`src/core/state.ts`](../../src/core/state.ts).
Consumers import the façade or a documented narrow reader, not a copied table
shape.

## CrateDeck schema and stores

[`src/deck/db.ts`](../../src/deck/db.ts) is the stable public façade;
it is intentionally small. Ownership beneath it is split by concern:

- [`db/core.ts`](../../src/deck/db/core.ts) — connection settings, base DDL,
  additive migrations, and retention.
- [`db/drives.ts`](../../src/deck/db/drives.ts) — drive identity and registry.
- [`db/activity.ts`](../../src/deck/db/activity.ts) — events, snapshots,
  settings, notes, and jobs.
- [`db/bench.ts`](../../src/deck/db/bench.ts) and
  [`db/ledger.ts`](../../src/deck/db/ledger.ts) — speed/checksum ledgers.
- [`db/library.ts`](../../src/deck/db/library.ts) and
  [`fleet-db.ts`](../../src/deck/fleet-db.ts) — scanned library projections
  and fleet tables.

These stores share one SQLite connection. The split is code ownership, not a
set of extra databases.

## Migration rules

1. Migrations are additive and idempotent; startup may safely re-run them.
2. A schema change and every affected reader/writer/test land together.
3. Shared payload types derive from producers; no hand-maintained duplicate
   interfaces or table lists.
4. Persisted JSON is guarded at the read boundary and exposes corruption.
5. Numeric values crossing CLI, JSON, SQLite, or subprocess boundaries are
   checked for finiteness before they enter domain logic.
6. rekordbox and external-drive writes follow the stricter interlock and
   verification rules in `AGENTS.md`; a successful SQL commit alone is never
   proof of success.
7. Rekordbox IDs stay decimal strings across Python/JSON and convert to
   hexadecimal only at the playlist-XML boundary; JavaScript `number` is not a
   safe representation for arbitrary collection IDs.

## Live inspection

Use product commands for operational truth instead of pasting volatile counts
into docs:

```bash
megadj status --json
megadj shelf-sweeps --json
megadj intake-status --json
megadj audit --json
deckctl status --json
deckctl coverage --json
```

For schema debugging, inspect the producer first, then use SQLite metadata on
a copy or local application database. Never probe or modify a live rekordbox
database while rekordbox is running.

## The state dir and retention (who owns what on local disk)

`~/.local/state/megadj/` holds the pipeline's local state. Every path has
exactly one retention owner; nothing here is "junk with no owner" — if a
path's owner is unclear, that is a bug to file, not a file to delete.

| Path                                                                             | What it is                                                                      | Retention owner                                                                                                                  |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `archive.db` (+ `-wal`/`-shm` when open)                                         | the live pipeline ledger — the one and only                                     | never removable; matches no backup class by construction                                                                         |
| `archive.db.bak-<ts>`, `archive_bak_<ISO>.db`, `archive.db.pre-restore-<ts>.bak` | dated pipeline backups (pre-migration, pre-restore)                             | [`src/shelf/tmp-purge.ts`](../../src/shelf/tmp-purge.ts) `--state` — newest lineage per stem is always KEPT, older ones eligible |
| `archive-db-before-<what>-<date>.db`                                             | dated lineage snapshots (#108-class) — the "state before a risky change" record | same `--state` tier: newest snapshot kept verbatim                                                                               |
| `spike/`                                                                         | `rb-anlz-spike` baselines (the compare side of the GA-07 write-path harness)    | age-gated (>24h) by `tmp-purge --state` — but LOAD-BEARING: a baseline a future compare needs is data, not junk                  |
| `artwork-covers/`, `artwork-queue.jsonl`                                         | the art pipeline's cover store + AI-queue                                       | active; never swept                                                                                                              |
| `jobs/`                                                                          | CrateDeck job engine state                                                      | active; never swept                                                                                                              |
| `cratedeck.sqlite`                                                               | CrateDeck's own registry/events/jobs DB                                         | lives in `src/deck/data/` (or `$CRATEDECK_DATA`), not here                                                                      |

Backup-name classes are pinned in
[`src/shelf/tmp-purge.test.ts`](../../src/shelf/tmp-purge.test.ts); the sweep
is dry-run by default, and `--apply` deletes only what a name class + age
gate + (for sidecars) an `lsof` open-handle check admit.

## The rekordbox master backups (sacred)

`~/Library/Pioneer/rekordbox/backups-megadj/` holds the dated master.db
backups `rb-import`/`rb-adopt` create (AGENTS.md: sacred). Rules:

- Never plain-delete a dated RB backup dir. Superseded sets get zipped into
  ONE dated archive (`rekordbox_bak_<date>-<what>.zip`) plus a `.sha256`
  sidecar.
- The local `~/Library/Pioneer/rekordbox/master.db` is the rekordbox app's
  own DB and is stale by design — SHELF1's `PIONEER/Master/master.db` is the
  collection SSOT. Do not "clean up" the local one.
- The playing USB is user-managed; it appears in no storage inventory here.

## Library size: the honest decomposition

The ledger row count is NOT the library size. One `tracks` table mixes
cohorts: rekordbox mirror rows (real shelf audio), ingest rows (real, partly
rehomed to the shelf), and YouTube liked-video metadata rows (mostly never
downloaded; `pending` ≠ gap). When asked "how big is the library":

1. Report known on-disk bytes (`SUM(file_size_bytes)` over rows whose paths
   exist) and say which volume they live on.
2. Report the ledger decomposition per source and status (the Sep 18 audit:
   5,921 rows → 3,133 rekordbox · 750 ingest · 1,883 liked-videos · 135
   liked · 20 playlist; per-source snapshot freshness matters as much as
   counts — #253 tracks the census command that makes this one command).
   The operational loop for these questions is the
   `storage-intake-census` skill (`.claude/skills/storage-intake-census/SKILL.md`).
3. If SHELF1 is unmounted, say so — shelf-side bytes are an honest gap, not
   a zero.
