# Booth-Check: verify the library plays + displays on the configured booth fleet

One reusable workflow: pick the fleet → audit → fix → (if needed) reload
rekordbox. Every step exits non-zero when something needs attention, so an
agent can chain them mechanically.

## 0. The fleet (once, or whenever the booth changes)

The compat floor is the INTERSECTION of the selected players — every check
(audit, booth-fix, ingest) enforces it. XDJ-XZ + CDJ-3000 + CDJ-2000NXS2 are
the standing default; the plain CDJ-2000 (no FLAC, 48 kHz, language-table
display) is opt-in.

```bash
# show the fleet + the derived floor
deckctl booth
# change it (ids: xdj-xz cdj-3000 cdj-2000nxs2 cdj-2000)
deckctl booth set xdj-xz cdj-3000 cdj-2000nxs2
```

Web: Fleet → Booth (checkboxes + clickable citations). MCP: `deck_booth {}`.
Selection persists in `config.toml [booth].fleet`; profiles + the triple
citations that justify every rule live in `fulltags/src/fleet.ts` (SSOT).

## 1. Audit (read-only, always safe)

```bash
megadj audit --json          # whole archive; exit 1 = gaps exist
# JSON fields that matter here:
#   .unreadable[]  — booth-text failures (chars/paths the fleet can't show)
#   .incomplete[]  — every gap with its reason flags
```

## 2. Fix (dry first, then apply)

```bash
megadj booth-fix                                  # dry by default: prints the plan
megadj booth-fix --json                           # machine-readable rows
megadj booth-fix --apply --yes                    # applies the SAFE subset
megadj booth-fix --apply --yes                    # idempotent: second run = 0 fixable
# scope to the shelf without touching the archive:
MEGADJ_MUSIC_DIR=/Volumes/SHELF1/Contents megadj booth-fix
```

What apply does, and what it refuses to do:

- **Renames** illegal-char (`;`, control bytes) and Windows-trailing
  dot/space filenames — sanitized copy of the same name; DB `file_path`
  follows automatically. Never deletes.
- **Rewrites tags** flagged `non-fleet-characters` (emoji, CJK, Hangul,
  fullwidth punctuation → ASCII-safe) and repairs `mojibake` (CP1252
  double-encode) in place via the atomic writer.
- **Proposes only** (action `none`): float-PCM WAVs (needs
  `megadj convert`), intentional-script names (e.g. YEИDRY), hi-res audio.

## 3. Rekordbox reload (only after shelf/stick renames)

Renaming files on SHELF1 (where rekordbox's master DB lives) breaks the
DB's paths. Recovery is one bulk pass:

1. Open rekordbox (requires SHELF1 attached).
2. Collection view → ⌘A → right-click → **Relocate Lost Files**
   (right-click is greyed in playlist/device views — the one-by-one trap).
3. Re-export to any stick that was synced after the rename
   (`.claude/skills/rekordbox-usb-sync/SKILL.md`).

Archive-only fixes (`~/Music/DJ-Imports`) need NO rekordbox step — the
sticks sync FROM the shelf, not from the archive.

## 4. Gates were here

- `bun test fulltags/test/player-compat.test.ts fulltags/test/booth-text.test.ts src/commands/booth-fix.test.ts src/commands/booth-fix.e2e.test.ts`
- Surface parity: `bun test cratedeck/test/surface-parity.test.ts`
- The fleet floor NEVER widens on a bad selection — empty/unknown ids fall
  back to the default trio (regression-tested).
