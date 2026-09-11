# Shelf Hygiene & Dedupe — Sep 9 2026 Session

**Status: ✅ SHIPPED — the spec in this doc was built and landed Sep 10
2026 (P2+P3, commit 7754756): `megadj shelf-hygiene` + `deckctl hygiene` +
`deck_hygiene` + the Hygiene tab (the shelf-intake skill's hygiene step is
the one Phase-6 item still open). The landed code is the truth:
`src/hygiene/` (engine/store/apply), `cratedeck/src/hygiene_*.ts` (API/job/
reader), parity pinned by `cratedeck/test/surface-parity.test.ts`; current
state lives in [product-state-2026-09-07.md](product-state-2026-09-07.md),
surface rows in [surface-parity.md](surface-parity.md).**

Full record of the Sep 9 data work on SHELF1, the traps hit, and the
shipped spec. What was NOT kept: the §4/§5 phase-by-phase build guide and
implementation plan — the feature shipped as specced, and the code +
tests are the SSOT (a hand-kept build record would drift, per the
one-SSOT rule).

## 1. What the session did (numbers as of Sep 9)

- **Whole-shelf acoustic dupescan:** `megadj shelf-dupescan`
  fingerprinted 4,635 audio files (fpcalc → `shelf_fingerprints` ledger);
  **969 duplicate groups — 1,271 redundant copies, 38.9 GB**.
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
   unrecoverable) — destructive ops default to recoverable quarantine;
   empty-quarantine is the only true delete, double-confirmed.
6. **Deletions need a frozen keep-list approved BEFORE execution.**
7. **exFAT materializes `._` AppleDouble forks lazily** — filter
   `._`/`.DS_Store` in every walk and quarantine dir.

## 4. The shipped feature (what the spec became)

`megadj shelf-hygiene --json` computes findings into the
`hygiene_findings` ledger (kinds: byte-twin, acoustic-twin, folder-variant,
spelling-typo, truncated-name, zero-byte, appledouble-junk, stale-pointer,
orphan-audio, re-download; severity safe/likely/review/info — **only
`safe` ever auto-applies**, and auto-apply means quarantine). The status
machine is `open → confirmed → applied` or `open → dismissed`; apply moves
to quarantine with restore affordances; post-apply validation re-md5s
keepers, re-fps losers, and checks the file-count delta before showing a
receipt. The web surface follows the two-thirds UX law: verdict banner →
fix-first queue with Copy-able fix commands → evidence confirm dialogs.
Non-goals, unchanged from the spec: no auto-downloading music, no
rekordbox DB writes (handoff stays instructional, #7), no background
auto-apply without human confirm, no second source of truth outside the
archive DB + filesystem.

### 4.1 Acoustic subcategories (shipped Sep 11)

Same fingerprint ≠ same decision — a 0.2% tag difference and a 30%
bitrate difference demand different levels of trust. Every acoustic-twin
finding carries `evidence.subcategory` from
`src/hygiene/subcategory.ts`:

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
