# Docs Audit — megadj (2026-09-05)

Successor to `docs-audit-2026-09-04.md` (superseded; that pass's fixes all
landed — it was deleted then). Scope: every markdown file in `docs/`,
`docs/cratedeck/`, plus the root `README.md` — checked against the actual
shipped state.

**Pass 2 (later the same day):** after the MCP-server + ⌘K-search drop
landed and a second external-claims research pass. Findings for both
passes below; this file is the current record.

## Findings — pass 1

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

## Findings — pass 2 (MCP/search drop + research re-verification)

| #   | Severity | File                              | Issue                                                                                                         | Fix                                                     |
| --- | -------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 11  | HIGH     | `docs/ideas.md` B9, O82, O86      | Listed as unbuilt; shipped 2026-09-05 (`mcp.ts` 10 tools, `/api/search` ⌘K)                                   | Marked ✅ SHIPPED with evidence; O82b split out         |
| 12  | HIGH     | `docs/roadmap-proposal.md`        | v1 pre-dated the MCP/⌘K drop; Move 3 and sequencing said "O86 → O82" as if unbuilt                            | v2: Move 3 re-scoped (rails live; archive half remains) |
| 13  | HIGH     | `docs/fulltags-roadmap.md`        | OpenKeyScan `:58721` REST API attributed to the open-source repo (it's the closed desktop app's)              | rev 3 correction; primary/fallback rewritten            |
| 14  | MED      | `docs/fulltags-roadmap.md`        | MusicFM recommended as step-up (dormant since 2024); MuQ-MuLan is the 2026 SOTA step-up                       | rev 3: MUSE → MuQ-MuLan ladder; research base updated   |
| 15  | MED      | `docs/ideas.md` K57/K58           | No source-health facts: SC impersonation merged Feb 2026; Bandcamp broken in yt-dlp since 2026-08-21 (#17506) | Status notes added; K58 sequenced after upstream fix    |
| 16  | MED      | `docs/fulltags-roadmap.md` §4/§6  | "rev 2" headers inside a rev-3 doc                                                                            | Retitled rev 3                                          |
| 17  | MED      | root `README.md` docs index       | `docs-audit-2026-09-05.md` not listed                                                                         | Added under Records; noted usb-sync-log is local-only   |
| 18  | LOW      | `AGENTS.md`                       | No memory of the MCP server / ⌘K search / roadmap rev 3                                                       | Added agent-surface bullet + rev-3 fact                 |
| 19  | LOW      | `docs/ideas.md` best-models block | MusicFM/MERT wording stale vs rev-3 research                                                                  | Rewritten (MuQ-MuLan pick, OpenKeyScan correction)      |
| 20  | LOW      | `docs/ideas.md` §0                | (other session) do-now items as prose only                                                                    | GitHub issues #1–#5 linked (verified to exist)          |

## Applied

All HIGH + MED fixed same day. No renames or archives needed;
`docs/archive/` still holds only the superseded cratekeeper draft.

## Verified clean (pass 2)

- All `.md` links across `docs/`, `docs/cratedeck/`, `README.md` resolve
  (checked programmatically; one apparent miss was a full URL, verified
  live with HTTP 200).
- Status claims spot-checked against code: `auto_schedule.ts` +
  config keys exist (B17 ✅), `fleet.ts` + Fleet page + deckctl verbs
  exist (B6–B8 ✅), ⌘K handler in `web/App.tsx` + `GET /api/search`
  route (B9 ✅), `mcp.ts` 10 tools + `bun run mcp` script (O82/O86 ✅),
  `fulltags/` 56 tests (suite run 2026-09-05), `writePatchSync`
  regression fix in `ab710f7`.
- One SSOT per topic holds: build order → `roadmap-proposal.md` (v2);
  model ladder → `fulltags-roadmap.md` (rev 3); parking lot →
  `ideas.md`; acceptance evidence → `cratedeck/acceptance.md`;
  docs-audit record → this file.
- External claims re-verified 2026-09-05 (second pass): BeatFM still
  codeless; beat_this v1.1.0 current; Essentia #1486/#1488 unchanged;
  rekordbox 7.2.18 current, no format changes; all-in-one-infer v3
  installs compiler-free on Apple Silicon; MuQ-MuLan AUC 79.3 SOTA;
  dupsonic v0.2.5 binaries; yt-dlp SoundCloud fixed / Bandcamp broken
  (#17506).
