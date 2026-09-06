# Docs Audit — megadj (2026-09-05)

Successor to `docs-audit-2026-09-04.md` (superseded; that pass's fixes all
landed — it was deleted then). Scope: every markdown file in `docs/`,
`docs/cratedeck/`, plus the root `README.md` — checked against the actual
shipped state.

**Pass 2 (later the same day):** after the MCP-server + ⌘K-search drop
landed and a second external-claims research pass. Findings for both
passes below; this file is the current record.

**Pass 3 (2026-09-06, next morning):** after the rev 4–6.2 burst landed
(fingerprints/BPM/key stages → beats ledger → mood/MB harvest → cues +
CrateDeck mood surface). Docs had drifted behind the code again — same
class as pass 2: shipped-status staleness, this time concentrated in the
MCP tool count and the roadmap "shipped-since" blocks.

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

## Findings — pass 3 (2026-09-06, rev 4–6.2 burst aftermath)

| #   | Severity | File                              | Issue                                                                                                        | Fix                                                        |
| --- | -------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 21  | HIGH     | `docs/ideas.md` O82               | "19 tools / archive half (O82b, 5)" — actually 21 tools; rev 6/6.2 added `archive_grid_cross_check` + `archive_mood_profile` | 21 tools; O82b = 7, both new tools named                   |
| 22  | HIGH     | `cratedeck/deckctl.md` §MCP       | Tool list ended at `archive_source_diff`; grid + mood tools missing                                          | Both added, "21 tools total"                               |
| 23  | HIGH     | `AGENTS.md`                       | Same 19-tool claim + archive half missing the two new tools                                                  | 21 tools; tool list extended                               |
| 24  | HIGH     | `docs/roadmap-proposal.md`        | State-of-the-union table: CrateDeck "10 tools", gaps listed preflight/players/archive-MCP as open — all shipped; FullTags gap said "no key/BPM/fingerprints/moods" — all shipped | Table rewritten against rev 6.2 reality                     |
| 25  | MED      | `docs/roadmap-proposal.md`        | Move 3 listed O82b + O83 as unbuilt — both shipped (`deckctl prep`)                                          | Marked ✅ shipped with evidence; sequencing line updated    |
| 26  | MED      | `README.md`                       | "Coming next: …preflight, fingerprint dedupe, key detection" — all three shipped Sep 5                        | Reworded to what actually remains (gig mode, sources, dupe hunt) |
| 27  | MED      | `docs/FEATURES.md`                | CrateDeck status omitted preflight/players/MCP/prep; no shipped-since block; FullTags commands missed beats/mood/cues; "Coming next" moves stale | Status extended, shipped-since callout added, moves annotated, pipeline commands updated |
| 28  | MED      | `docs/cratedeck/acceptance.md`    | Agent-surface section pre-dated B12/N75/O82b/O83/O85/O87/O88 (described the 10-tool era)                      | New "Gig-night + agent surface" evidence section; audit date bumped |
| 29  | MED      | `docs/cratedeck/03-architecture.md` | "19 TS files" — now 27; added-since list missing 7 newer modules                                            | Count + module list updated                                |
| 30  | LOW      | `docs/ideas.md` B12               | "Remaining optional: UI card" lacked the N76 shipped note                                                     | `firmware_advisories` shipped note added                   |

## Applied (pass 3)

All HIGH + MED fixed same session. No renames, no archives. Link check
re-run after edits: all relative `.md` links across `docs/`,
`docs/cratedeck/`, `README.md`, `AGENTS.md`, `fulltags/README.md`,
`cratedeck/*.md` resolve.

## Verified clean (pass 3)

- MCP tool census against `cratedeck/src/mcp.ts`: 21 `deck_*`/`archive_*`
  tools (14 + 7), matching every updated claim.
- `cratedeck/src/` file census: 27 TS files.
- `deckctl` verb census: `status|drives|report|run|coverage|redundancy|
diff|jobs|cancel|stop|explain|preflight|players|prep` — guide matches.
- megadj CLI census: beats/mood/cues present in `src/cli.ts` +
  `src/commands/`; FEATURES.md command lists now match.
- fulltags-roadmap rev 6.2 claims spot-checked against CHANGELOG entries
  (same-day, rev-by-rev consistent) and `src/commands/{beats,mood,cues}.ts`.
- No stale "19 tools" strings remain anywhere (`rg` verified).
