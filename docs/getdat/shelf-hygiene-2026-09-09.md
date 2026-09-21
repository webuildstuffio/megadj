# Shelf Hygiene & Dedupe — Sep 9 2026 Session

**Status:** 🟡 PARTIAL — the Sep 10 core shipped; the `truncated-name`
detector (the #9/#37 slice) shipped Sep 17: prefix20 rename ladder +
pyrekordbox row seam + a real `--kind` filter (was parsed-then-dropped;
unknown kinds now exit 2). This snapshot previously overstated detector
and restore-surface coverage. `megadj shelf-hygiene` +
`deckctl hygiene` + `deck_hygiene` + the Hygiene tab are live; the
restore loop CLOSED Sep 19 (rev-43, #35/#36): `shelf-restore` /
`shelf-restore-all` / `shelf-quarantine` / `shelf-quarantine-empty --yes`
plus the QuarantinePanel (`/api/hygiene/*`), and empty flips rows to
`archived` behind the typed-confirm gate. Remaining detectors
(`stale-pointer`, `orphan-audio`, `re-download`) stay with #37. The landed
code is the truth: `src/archive/hygiene/` (engine/store/apply),
`cratedeck/src/hygiene_*.ts` (API/job/reader), parity pinned by
`cratedeck/test/surface-parity.test.ts`; current state lives in
[product-state-2026-09-07.md](../product-state-2026-09-07.md),
surface rows in [surface-parity.md](../surface-parity.md).**

Full record of the Sep 9 data work on SHELF1, the traps hit, and the
shipped spec. What was NOT kept: the §4/§5 phase-by-phase build guide and
implementation plan — the feature shipped as specced, and the code +
tests are the SSOT (a hand-kept build record would drift, per the
one-SSOT rule).

## 1. What the session did (numbers as of Sep 9)

- **Whole-shelf acoustic dupescan:** `megadj shelf-dupescan`
  fingerprinted 4,635 audio files (fpcalc → `shelf_fingerprints` ledger);
  **969 duplicate groups — 1,271 redundant copies, 38.9 GB**.
  Sep 16 (#10): the `--json` summary now self-identifies with
  `generatedAt` + `contentsDir` provenance stamps — a saved dossier
  dates itself instead of reading as current.
- **Quarantine-apply (human-gated):** 955 byte-identical copies moved to
  `Contents/.dupescan-quarantine/` (`--quarantine --yes`); post-apply MD5
  audit: **0 orphans**, 969/969 keepers intact. 312 left for human review.
- **YTMusic Liked cleanup:** the 419 "missing" tracks were stale DB
  pointers, not lost files (audit: every flagged track exists on disk).
  28 meme/tutorial files deleted against an exact user-approved list;
  one YT folder left (37 clean files). Collateral loss: "Eat Me Better"
  (nimino) — recovery = re-download (#11).
- **Artist-folder consolidation:** 14 token-set variant pairs merged;
  spot-check `ANOTR x 54 Ultra` vs `ANOTR, 54 Ultra` (fpcalc-identical)
  → re-encode quarantined; 6 true typo pairs fixed (Talor→Taylor,
  Tame Impara→Tame Impala, …); similar-name different-artists left
  separate (Belly/Nelly, Cassian/Kassian — edit distance alone is a trap).
- **File-level dedupe:** 55 suffix-twin losers + 321 acoustic losers
  quarantined; 10 genuinely-different recordings kept both; triple-check
  re-fpcalc: 0 mismatches. **Quarantine total: 1,703 files / 35.1 GB**,
  fully recoverable.
- **End state:** shelf live audio 3,748 files / 2,087 folders; verify red
  only on the known rekordbox desyncs (57 moved YTMusic rows + 70
  export.pdb drift — #7).

## 2. Issues filed

[#7](https://github.com/webuildstuffio/megadj/issues/7) rekordbox
reconcile runbook · [#8](https://github.com/webuildstuffio/megadj/issues/8)
YT-folder consolidation · [#9](https://github.com/webuildstuffio/megadj/issues/9)
truncated-name WAV twins · [#10](https://github.com/webuildstuffio/megadj/issues/10)
`shelf-restore` · [#11](https://github.com/webuildstuffio/megadj/issues/11)
re-download "Eat Me Better".

## 3. Traps hit (now encoded in the shipped feature)

1. **Stale snapshots lie** — a 14 MB dossier manifest predated cleanup and
   miscounted by 100+. Re-walk the live volume before batch ops (the
   feature does: fresh-walk sentinel before every apply).
2. **Same size ≠ same content** (291 BANGERS files) and **same
   fingerprint ≠ same bytes** — md5 first (cheap, decisive), then fp.
3. **exFAT truncates/mangles names** (Faithless WAVs, U+2010 `a‐ha`) —
   name matching necessary but never sufficient; fingerprints decide.
4. **Edit distance is a trap** — Akn/Ama/Arn, Belly/Nelly,
   Cassian/Kassian are different artists; human review with album/genre
   context is mandatory for anything not byte/fp-proven.
5. **`os.remove` bypasses the Trash** ("Eat Me Better" became
   unrecoverable) — destructive ops default to recoverable quarantine. No
   empty-quarantine command or remote surface has shipped.
6. **Deletions need a frozen keep-list approved BEFORE execution.**
7. **exFAT materializes `._` AppleDouble forks lazily** — filter
   `._`/`.DS_Store` in every walk and quarantine dir.

## 4. Current implementation

`megadj shelf-hygiene --json` computes six live finding kinds into the
`hygiene_findings` ledger: `appledouble-junk`, `byte-twin`, `acoustic-twin`,
`folder-variant`, `truncated-name` (Sep 17), and `zero-byte`. The status machine is
`open → confirmed → applied` or `open → dismissed`; **only `safe` findings
ever auto-apply**, and apply means quarantine. The current per-finding receipt
checks keeper presence and size, live MD5 equality for byte twins, and the
file-count delta. It does not yet re-fingerprint quarantined acoustic twins or
provide one-click revert; those remain in [issue #35](https://github.com/webuildstuffio/megadj/issues/35).

`megadj shelf-restore <finding-id|path> [--into F]` restores a quarantined
file through the ledger and hash gates. **Sep 19 (rev-43, #35/#36): the
restore loop closed** — `shelf-restore-all`, `shelf-quarantine` (census),
and `shelf-quarantine-empty --yes` (typed `{confirm:"DELETE"}` gate,
applied rows flip to `archived`, receipt kept) shipped, with the
QuarantinePanel + `/api/hygiene/restore|restore-all|quarantine[/empty]`
routes; the web tab is a remote control over the engine-owned CLI. The
`truncated-name` detector shipped Sep 17 (#9/#37 slice 3): dead master-DB
rows joined to same-directory disk files by the rb-fix-paths prefix20
ladder propose human-gated same-dir renames (`review`, never auto-safe);
the planned `stale-pointer`, `orphan-audio`, and `re-download` detectors
are not registered (still with #37); the planned `spelling-typo` kind is
also absent (the live `folder-variant` check handles token-set variants,
not typo heuristics).

The web surface provides the verdict, fix queue, and evidence-backed
confirmation flow for the live checks.
Non-goals, unchanged from the spec: no auto-downloading music, no
rekordbox DB writes (handoff stays instructional, #7), no background
auto-apply without human confirm, no second source of truth outside the
archive DB + filesystem.

### 4.1 Acoustic subcategories (shipped Sep 11)

Same fingerprint ≠ same decision — a 0.2% tag difference and a 30%
bitrate difference demand different levels of trust. Every acoustic-twin
finding carries `evidence.subcategory` from
`src/archive/hygiene/subcategory.ts`:

| subcategory     | size delta | meaning                                | batch-confirm? |
| --------------- | ---------- | -------------------------------------- | -------------- |
| `metadata-diff` | <0.5%      | same rip; tag/art chunk differences    | yes            |
| `re-encode`     | 0.5–3%     | transcoded once at similar bitrate     | yes            |
| `quality-diff`  | >3%        | genuinely different encode/source      | no — ears      |
| `oddball`       | same size  | different bytes — maybe another master | no — ears      |

Composite buckets: `safe-batch` (first two) and `ear-check` (last two).
The classification NEVER changes severity or autoSafe — the human gate
holds; buckets just let the boring confirmations batch and the real
decisions surface. Surfaces: `megadj shelf-hygiene --bucket NAME`,
`deckctl hygiene bucket <name>` (+ `bySub` in the census), and the
Hygiene tab's bucket strip. First live pass (Sep 11, SHELF1): 108
metadata-diff + 20 re-encode batch-confirmed + 2 byte-twins → 130
applied, 0 failed, 130 green receipts.
