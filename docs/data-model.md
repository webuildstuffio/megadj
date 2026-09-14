# Data Stores and Schema Ownership

**Status:** 📚 REFERENCE — current database roles and executable schema owners.

This page is a map, not a copy of the DDL. Schema definitions and migrations
remain executable beside the code that uses them; copying columns here would
create a second source of truth.

## The three database roles

| Store                | Role                                                                                  | Schema owner                                                                                                                           | Read/write boundary                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `archive.db`         | GetDat pipeline state and FullTags/MegaSet analysis ledgers                           | [`src/archive/state_core.ts`](../src/archive/state_core.ts) plus the extension producers listed below                                  | megadj owns writes; CrateDeck opens its archive view read-only                                                      |
| `cratedeck.sqlite`   | Drive registry, events, snapshots, jobs, checksums, benchmarks, and fleet projections | [`cratedeck/src/db_core.ts`](../cratedeck/src/db_core.ts) and the domain stores behind [`cratedeck/src/db.ts`](../cratedeck/src/db.ts) | CrateDeck only; WAL-backed local application state                                                                  |
| rekordbox collection | `master.db` rows plus the `masterPlaylists6.xml` playlist twin                        | rekordbox/pyrekordbox, reached through `src/rekordbox/*` and the CrateDeck Python seam                                                 | rekordbox is authoritative; megadj mutations require rekordbox closed, dated backups, and full re-read verification |

`archive.db` is not a collection mirror and its row count is not the library
size. The `rekordbox_content` table is an explicit cross-reference created by
`megadj rb-adopt`; it does not change the database's pipeline-ledger role.

## `archive.db` producers

- [`src/archive/state_core.ts`](../src/archive/state_core.ts) owns the connection,
  core `tracks`/`runs` tables, analysis tables, indexes, and additive column
  migration seam.
- [`src/archive/ledgers.ts`](../src/archive/ledgers.ts),
  [`state_beats.ts`](../src/archive/state_beats.ts), and
  [`similar.ts`](../src/archive/similar.ts) own typed access to beats, mood,
  cues, embeddings, and key caches.
- [`src/archive/hygiene/store.ts`](../src/archive/hygiene/store.ts) owns hygiene
  findings and the operation lock.
- [`src/archive/sweeps.ts`](../src/archive/sweeps.ts) owns shelf-sweep receipts.
- [`src/rekordbox/rb-adopt.ts`](../src/rekordbox/rb-adopt.ts) owns the
  rekordbox-content cross-reference.
- [`src/shelf/dupescan-shared.ts`](../src/shelf/dupescan-shared.ts) owns the
  fingerprint cache used by shelf duplicate scans.

The stable public façade is [`src/archive/state.ts`](../src/archive/state.ts).
Consumers import the façade or a documented narrow reader, not a copied table
shape.

## CrateDeck schema and stores

[`cratedeck/src/db.ts`](../cratedeck/src/db.ts) is the stable public façade;
it is intentionally small. Ownership beneath it is split by concern:

- [`db_core.ts`](../cratedeck/src/db_core.ts) — connection settings, base DDL,
  additive migrations, and retention.
- [`db_drives.ts`](../cratedeck/src/db_drives.ts) — drive identity and registry.
- [`db_activity.ts`](../cratedeck/src/db_activity.ts) — events, snapshots,
  settings, notes, and jobs.
- [`db_bench.ts`](../cratedeck/src/db_bench.ts) and
  [`db_ledger.ts`](../cratedeck/src/db_ledger.ts) — speed/checksum ledgers.
- [`db_library.ts`](../cratedeck/src/db_library.ts) and
  [`fleet-db.ts`](../cratedeck/src/fleet-db.ts) — scanned library projections
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
megadj audit --json
deckctl status --json
deckctl coverage --json
```

For schema debugging, inspect the producer first, then use SQLite metadata on
a copy or local application database. Never probe or modify a live rekordbox
database while rekordbox is running.
