# Docs Audit — megadj (2026-09-05)

Successor to `docs-audit-2026-09-04.md` (superseded; that pass's fixes all
landed). Scope: every markdown file in `docs/`, `docs/cratedeck/`, plus the
root `README.md` — checked against the actual shipped state (commits
`ada03a9`, `eac58fc`, `ab710f7`, `aa64e04` and earlier).

## Findings

| #   | Severity | File                                | Issue                                                                                             | Fix                                                 |
| --- | -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1   | HIGH     | `docs/FEATURES.md`                  | 5 relative links resolved from repo root, not `docs/` (broken on GitHub render)                   | Prefix `../` — verified all links resolve           |
| 2   | HIGH     | `docs/FEATURES.md`                  | Key-detection row cited libKeyFinder (corrected in roadmap rev 2: OpenKeyScan is the path)        | Rewrite to OpenKeyScan + verified numbers           |
| 3   | HIGH     | `docs/ideas.md` §A1                 | "drawer's Report tab" — drawer removed in the Sep 2026 rail+tabs redesign                         | Fix wording                                         |
| 4   | MED      | `docs/ideas.md` header              | Three stacked revision-log paragraphs (with stray `\*\*` escapes) before any content              | Compress to one grounded intro paragraph            |
| 5   | MED      | `docs/ideas.md` I46, D27            | Collapsed sub-bullets ran onto single lines (broken markdown from a paste)                        | Restore list breaks                                 |
| 6   | MED      | `docs/cratedeck/03-architecture.md` | "13 server files" — now 19 in `cratedeck/src/`; tree comment said "10 files"                      | Update counts + list the additions by name          |
| 7   | MED      | `docs/cratedeck/acceptance.md`      | B17 automation (auto-scan/weekly-verify, `aa64e04`) absent from evidence; M6 status vague         | Add automation section; M6 → partial with specifics |
| 8   | MED      | `docs/FEATURES.md`                  | CrateDeck status omitted automation; "Coming next" didn't note what already shipped since writing | Status line + shipped-since note                    |
| 9   | LOW      | `docs/usb-sync.md`                  | Hard-won facts didn't mention the automation that changed routine ops                             | One bullet                                          |
| 10  | LOW      | `docs/ideas.md` §A                  | Section framed "this week / in flight" but every item shipped or promoted                         | Terminal note pointing at `roadmap-proposal.md`     |

## Applied

All HIGH + MED fixed 2026-09-05. No renames or archives needed;
`docs/archive/` still holds only the superseded cratekeeper draft.
`docs-audit-2026-09-04.md` itself is now stale-by-definition (all its
findings applied) — deleted in this pass; this file is the current record.

## Verified clean

- All `.md` links across `docs/`, `docs/cratedeck/`, `README.md` resolve
  (checked programmatically, including the new `roadmap-proposal.md`).
- Status claims spot-checked against code: `auto_schedule.ts` +
  config keys exist (B17 ✅), `fleet.ts` + Fleet page + deckctl verbs
  exist (B6–B8 ✅), ⌘K handler in `web/App.tsx`, `fulltags/` tracked with
  49+ tests, `writePatchSync` regression fix in `ab710f7`.
- One SSOT per topic holds: build order → `roadmap-proposal.md`; model
  ladder → `fulltags-roadmap.md` (rev 2); parking lot → `ideas.md`;
  acceptance evidence → `cratedeck/acceptance.md`.
