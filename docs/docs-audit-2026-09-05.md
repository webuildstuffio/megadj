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

## Findings — pass 4 (2026-09-07, full re-audit + branch review)

Full pass over every markdown in the repo (docs/, docs/cratedeck/,
fulltags/, cratedeck/, plugin/, root README, AGENTS.md) against the code,
plus a branch-review audit of the shipped window `15accb0^..fac7f0e`.

| #   | Severity | File                     | Issue                                                                                                     | Fix                                        |
| --- | -------- | ------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 31  | HIGH     | `fulltags/README.md`     | Mood label order claimed `[not_X, X]` (positive LAST) — the code (and rev 6.1's own hotfix) says positive FIRST except mood_party; the stale line described the exact bug that was fixed | Corrected to the pinned reality            |
| 32  | HIGH     | `fulltags/src/models.ts` | Header comment carried the same inverted `[not_X, X]` claim (the in-function comment was right)            | Header fixed; `analyze()` comment is SSOT  |
| 33  | HIGH     | `plugin/README.md`       | MCP table said "17 tools" (never true: 19 → 21 at ship); requirements linked `nichm/megadj`, which does not exist | 21 tools; link → `webuildstuffio/megadj`   |
| 34  | MED      | `cratedeck/README.md`    | Surface list pre-dated preflight/players/prep; docs line missing acceptance + deckctl guide                | "Beyond the core" paragraph + links added  |
| 35  | MED      | `fulltags/README.md` + `AGENTS.md` | "94 tests" / "56 tests" — the suite is 98 across 12 files (env-gated count shifts runs)          | Both set to 98-across-12 (verified)        |
| 36  | MED      | `docs/cratedeck/03-architecture.md` §5 | "full snapshot history … pruned" implied wholesale retention; code keeps a 20/drive rolling window (events 2000) | Reworded to the real pruning contract      |
| 37  | LOW      | `docs/cratedeck/01-product-brief.md` | Status still "Draft v1 · 2026-09-03" though the product shipped and went far past the brief        | Status line + shipped-since note added     |

## Verified clean (pass 4)

- `docs/roadmap-proposal.md`, `docs/ideas.md`, `AGENTS.md`, `FEATURES.md`,
  `deckctl.md`, `acceptance.md`: pass-3 fixes all still accurate (21-tool
  census re-checked against `mcp.ts`; deckctl verbs; CLI commands).
- GitHub issues #1–#5 (§0) match `ideas.md` §0 wording; #4 already carries
  its shipped-2026-09-04 note.
- CLAUDE.md ↔ AGENTS.md symlink intact; docs-audit file is the audit SSOT;
  no `C12` (typo-class) references anywhere; no stale "19 tools"/"17
  tools" strings.
- Branch review of `15accb0^..fac7f0e` (23 commits): no deleted files, no
  lost features; enrich's `GenreResolver`/`TagWriter` seams preserved as
  claimed; beats/mood/cues all wired in `src/cli.ts`; MCP mutating tools
  flagged + interlock-guarded with server-side TOCTOU re-check; archive DB
  migrations additive (`CREATE TABLE IF NOT EXISTS` + column backfill).
- External links in README/docs resolve (repo-relative ones verified on
  disk; `webuildstuffio/megadj` exists on GitHub).

## Findings — pass 5 (2026-09-07 evening, verification + conciseness)

Independent /super-sure re-verification of passes 1–4 plus the original
ask's conciseness target (−5% tracked-doc lines, redundancy-only).

| #   | Severity | File                     | Issue                                                                                                    | Fix                                                     |
| --- | -------- | ------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 38  | HIGH     | `fulltags-roadmap.md`    | §7 (impl notes) preceded §6 (sequencing) — order broken by rev-6.2 inserts                                | Renumbered (§6 impl notes, §7 sequencing)               |
| 39  | HIGH     | `ideas.md` I46           | Sub-bullets collapsed onto one line (same paste class as pass-1 #5)                                      | List breaks restored; shipped-status line added         |
| 40  | MED      | `ideas.md` I45/I49/I51/I46/L62, Phase 3 | AI-section claims pre-dated rev 5–6.2 execution (keys/mood/fingerprints all shipped — gates now measured) | Shipped-status stamps with gate numbers                 |
| 41  | MED      | `roadmap-proposal.md`    | Move 2 + week-by-week sequencing + success metrics still described key/BPM/fingerprints/mood as future work; "key + BPM" completeness metric unreachable (BPM gate failed) | v3: Move 2 rewritten as shipped/pivoted/blocked per gate; sequencing + metrics reconciled to rev 6.2 |
| 42  | MED      | `ideas.md` B12           | N76 shipped-note duplicated (same fact stated twice in one item)                                         | Deduped                                                  |
| 43  | MED      | `ideas.md` Phase 3       | "C12 differential mirror" — typo for C21                                                                | Fixed                                                    |
| 44  | MED      | `FEATURES.md`            | "gateaway" typo                                                                                          | Fixed                                                    |
| 45  | LOW      | `ideas.md` §0 intro      | "§0 blocks §A–§L" — sections run to §O                                                                  | Range fixed                                              |
| 46  | LOW      | `ideas.md` §J note       | Cited "rev 2" of the FullTags roadmap inside a rev-6.2 world                                            | Updated to rev 6.2 state                                 |
| 47  | LOW      | `roadmap-proposal.md`    | Date stamps said 2026-09-05/v2 while the body carried pass-3 content                                     | v3 · 2026-09-06 stamps                                                   |
| 48  | LOW      | `ideas.md` O82           | Full tool-census prose duplicated deckctl.md §MCP verbatim                                              | Compressed; census link added                                            |

## Applied (pass 5)

All HIGH + MED fixed. Conciseness trims applied to redundancy only
(fulltags-roadmap revision-log compression, ideas.md verbosity in
C18/M-section/O82, execution-log bullets) — every fact preserved.
§0's "missing input" bullet became item 0e (it was already issue #5).
Post-fix link check: all relative links in tracked docs resolve.

## Verified clean (pass 5)

- MCP census re-counted directly in `mcp.ts`: 21 tools (14 deck + 7
  archive) — matches every claim.
- `cratedeck/src/` = 27 TS files; deckctl verb set matches the guide;
  `src/cli.ts` census (beats/mood/cues/years/doctor/init) matches docs.
- GitHub issues #1–#5 for §0 exist and are open.
- fulltags test count (98 across 12 files) consistent post pass-4 fix.
