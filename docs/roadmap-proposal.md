# megadj — Future Roadmap Proposal

_Proposal v1 · compiled 2026-09-05 · after a full read of every doc in the
repo: [PRINCIPLES.md](PRINCIPLES.md) (the arbiter), [FEATURES.md](FEATURES.md),
[ideas.md](ideas.md) (the parking lot), [fulltags-roadmap.md](fulltags-roadmap.md)
(the model ladder), the CrateDeck doc set
([01](cratedeck/01-product-brief.md)–[04](cratedeck/04-build-plan.md) +
[acceptance](cratedeck/acceptance.md)), [usb-sync.md](usb-sync.md),
[fulltags/README.md](../fulltags/README.md), and the top-level README._

**What this doc is:** the opinionated middle layer the repo was missing.
`ideas.md` holds every idea; this doc holds the _proposal_ — what to build
next, in what order, and **why**, grounded in the eleven product principles
and the actual shipped state. When this doc and ideas.md disagree, this doc
wins on ordering; ideas.md wins on detail.

---

## 1. Where we are (state of the union, 2026-09-05)

The pipeline: **GetDat ─▶ FullTags ─▶ CrateDeck ─▶ the booth**. All three
projects have shipped cores:

| Project   | Shipped core (evidence)                                                                                                                      | The gap                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| GetDat    | `megadj sync` (YTM, 256k-first, rate-limited, SQLite state, `LOWQ` flag)                                                                     | one source (YouTube Music); quality ratchet has no swap tool  |
| FullTags  | `fulltags/` sub-project: one schema, one atomic writer (5 formats + gotchas), art ladder, conf-gated AI, `audit` gate; megadj = thin shims   | no key, no real BPM, no fingerprints, no research-grade moods |
| CrateDeck | v0.1: registry+ghosts, ANLZ hand-building, dual-DB verify, interlock, fleet superpowers (coverage/redundancy/diff), deckctl, auto-scan (B17) | preflight, gig mode, export runbook, set intelligence, MCP    |

Also true, from the acceptance doc: **four open items need real hardware**
(mirror-badge ground truth, drive-detail vs known counts, 1440×900 one-screen
check, M6 kill-9 resilience + tag `cratedeck-v0.1.0`). And from §0 of
ideas.md, which outranks everything in this doc: **the SSD evacuation and the
cold backup still gate all of it.**

---

## 2. The proposal — three moves

Everything in the backlog collapses into three consecutive moves. Each is
independently shippable, each makes the next one cheaper, and each maps to a
principle.

### Move 1 — Harden the moat (CrateDeck v1.x) · _why: P6, minutes saved per gig_

The fleet layer (coverage/redundancy/diff) shipped, but the _gig-day_ layer
is still manual. This move finishes the "is this stick safe for tonight?"
loop the product brief defines as CrateDeck's reason to exist:

1. **B9 — global search across ghosts** (⌘K over every snapshot). Highest
   daily-use feature in the app; the query engine already exists in
   `fleet.ts`, this is UI + one API route.
2. **B12 + N76 — preflight with firmware notes.** One pass/fail checklist
   per drive: sync state, grid coverage, integrity, space, plus the
   firmware-aware "shows on player, playlists empty → check which library
   format that firmware prioritizes" rule (the CDJ-3000 v3.30 incident
   class). One click before every gig.
3. **N75+77+78 — the player-compatibility verdict.** AlphaTheta's official
   Device-vs-OneLibrary matrix as `players.toml`, combined with the measured
   dual-DB state we already compute → a per-drive "works on: XZ ✓, AZ ✗"
   badge. Rekordbox cannot tell you this; it is the single clearest
   expression of what megadj is for, and it falls out of data already
   collected (effort S, mostly data entry).
4. **C18a — the assisted legacy-export runbook.** Priced honestly in the
   audit as "the right buy": captures most of the value of pdb automation
   (no missed steps, auto-detected stage completion via pdb row counts and
   `playlists3*.sync` mtimes) at none of the risk. The dance runs a few
   times a month; this makes those times un-failable.
5. **C21 + C22 — differential mirror + one-click "sync everything"** with
   notifications, safe under the interlock. Weekly mirror goes from hours
   to minutes (checksum ledger as change detector).

**Why now:** these are pure reads/jobs over data the scans already collect;
no new analysis stack; every item is S–M effort. They compound — preflight
consumes the compatibility verdict, which consumes the dual-DB gate that
already ships.

### Move 2 — Complete the metadata (FullTags v1.x) · _why: P8, AI does the labour_

The FullTags roadmap's P1 ladder is the highest payoff-per-risk sequence in
the repo, re-confirmed by the 2026-09-05 model re-check. In order, with its
verification gates:

1. **Harmonic key** — OpenKeyScan's analyzer server (primary;
   `keyfinder-cli` is _not_ in homebrew-core), Essentia `Key` as a
   cross-check vote. Writes `TKEY` + `TXXX:CAMELOT` — fields the CDJ
   hardware already displays. Gate: ≥80% agreement on 20 known-key tracks
   before any batch run (Mixed In Key output on this library is the
   reference).
2. **Real BPM + downbeats** — `beat_this` (ISMIR 2024, MIT, CPU-friendly).
   Feeds `TBPM` and anchors everything structural later. Gate: compare
   against rekordbox's re-analyzed grids (the 294 fixed Sep 2026 are ground
   truth); flag disagreements >2%.
3. **Chromaprint fingerprint ledger** — one brew dep (`fpcalc`), stored in
   the archive DB + `TXXX:ACOUSTID`. Unlocks four backlog items at once:
   content-based dupe detection (D25), verified `megadj upgrade` swaps
   (D24), smarter `adopt` (AcoustID lookup), mirror content audits (L63).
4. **Essentia ONNX heads** — genre/mood/danceability/DEAM valence-arousal
   under plain `onnxruntime` (works on macOS ARM64; the TF path is broken
   on ARM, ONNX sidesteps it). Replaces hand-rolled RMS energy and the
   LLM-only genre guess; valence-arousal plots as the CrateDeck vibe map.
5. **`megadj drop` (K61)** — the packaging win: drop a folder/URL → clean →
   analyze → tag → organize → stage for sync. Every component exists;
   Quickie Music charges $4/mo for less. P3: _super easy_.

**Why in this order:** each step is verifiable against ground truth the repo
already owns, each write goes through the one atomic writer (idempotent —
re-running is safe), and the fields land where hardware actually reads them.

### Move 3 — Agentify (the O layer) · _why: P1, agent-first is a principle_

`deckctl`, `--json`, and three SKILL.md files already exist; the 2026
agent-CLI taxonomy (MCP, headless one-shots, hooks) needs thin wrappers,
not new infrastructure:

1. **O86 first — the safety rails.** Mutating tools (mirror/format/anything
   drive-touching) absent from the agent surface or behind explicit
   confirmation; the interlock check lives in the tool layer, not the prompt
   ("prompts are suggestions, exit codes are law"); every agent action lands
   in the timeline with a session id.
2. **O82 — megadj MCP server.** `search_tracks`, `track_stats`,
   `drive_status`, `drive_report`, `enqueue_job` (scan/verify/checksum
   only), `playlist_diff`. Bun + official SDK; wrappers over existing
   functions.
3. **O83 — headless weekly agent loop.** Archive integrity sweep → scan
   deltas → redundancy → new-music-not-exported → markdown digest. The
   agent writes nothing; it reads and reports. Supersedes the F39 weekly
   digest as the preferred implementation. The cheapest reliability win in
   the entire backlog.
4. **O84/O85 after the surface is stable** — inbox-to-crate agent on top of
   `megadj drop`; skill/plugin packaging.

**Why:** the one-user-one-machine rule (P1) already says "if a feature can't
be expressed as a command an operator or an AI agent can run, it doesn't
exist." §O is the second half of that sentence, and the safety rails are
what keep agents inside P9/P11's idempotent, resumable discipline.

---

## 3. The AI model slate (chosen, with why + license + gate)

Re-verified 2026-09-05 (see the research notes in ideas.md for the ledger).
All local/offline — P9's zero-telemetry and §H's cloud non-goal hold.

| Task            | Pick                                                            | Why this pick (and what was rejected)                                                                                                                                                                        | License              | Verification gate                          |
| --------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- | ------------------------------------------ |
| Key / Camelot   | OpenKeyScan analyzer server                                     | CNN-based, ~79% community-tested, MPS-accelerated; `keyfinder-cli` rejected (not in homebrew-core, ARM friction); MIK not self-hostable                                                                      | check at integration | ≥80% on 20 known-key tracks                |
| Key cross-check | Essentia `Key` algorithm                                        | free second vote; disagreements → review queue                                                                                                                                                               | AGPL (code)          | agreement tracking per batch               |
| BPM / downbeats | `beat_this`                                                     | ISMIR 2024 SOTA without DBN; MIT; pip + Rust/ONNX ports. **BeatFM beats it on paper (+4.1pt downbeat F1) but ships no weights — rejected for now**, revisit if released                                      | MIT                  | vs the 294 rekordbox-fixed grids, >2% flag |
| Structure/cues  | `all-in-one-infer` (prefer `-mlx`)                              | functional segments + beats + demucs stems in one pip install; MIT. Labels are pop-trained → map to drop/outro heuristically and verify on EDM first                                                         | MIT                  | 20-track EDM spot check before batch       |
| Moods/genre/VA  | Essentia ONNX model zoo (MusiCNN etc.)                          | official ONNX exports run on ARM64 today; research-grade replaces hand-rolled RMS + LLM-only genre. **Models are CC BY-NC-SA — fine for a personal library per P9, re-review before any commercial release** | CC BY-NC-SA          | confidence history per tag; audit strays   |
| Energy          | danceability + DEAM arousal co-votes                            | replaces RMS-linear; keeps the 1–10 UI scale (Energy 2.0, roadmap #9)                                                                                                                                        | (via Essentia)       | A/B vs current TXXX:ENERGY on 50 tracks    |
| Embeddings      | MusiCNN MUSE first; **MusicFM** if a stronger encoder is needed | MusicFM = MIT code + CC-licensed FMA weights — the license-clean foundation model; **MERT weights are CC-BY-NC** (usable per P9, but riskier if the repo ever goes public)                                   | MIT (MusicFM)        | kNN sanity on "sounds like" queries        |
| Fingerprints    | chromaprint (`fpcalc`)                                          | standard, one brew dep, AcoustID lookup free at 3 rps                                                                                                                                                        | LGPL                 | same-recording check on every upgrade swap |
| Dupe scanning   | dupsonic design reference                                       | Rust, incremental, LSH — steal the incremental design before writing our own                                                                                                                                 | MIT                  | precision spot-check vs known dupes        |
| Vibe captions   | none (garnish only)                                             | I50 verdict stands: you'd read them twice and never filter by them. `megadj drop` prints one line; no infrastructure                                                                                         | —                    | none — deliberately not built              |
| Voice memo → ID | mlx-whisper (M68, later)                                        | 20–30× realtime on Metal; only after K59 mining exists (its trigger)                                                                                                                                         | MIT                  | transcribe→resolve→queue E2E on 5 memos    |

**Model-gate rules (from P5/P7/P11, applied to ML):** paper-SOTA ≠
usable-SOTA — no pick without runnable code/weights on macOS ARM; every
model is tuned-for or verified-on electronic music before batch; spot-check
verifications before any batch run; never batch >50 tracks without a sampled
diff review (the year-trap generalization: every model output gets
confidence gate + verify pass + human diff, exactly like flash-lite's
"everything is 2023").

---

## 4. Sequencing — the gated 90-day line

This is ideas.md's sequencing, made concrete. **§0 still gates it**: no
commit of substance while the SSD evacuation (0a) is open.

```
Weeks 1–2   §0 survival (0a–0d) + B9 global search        [Move 1 starts]
Weeks 3–5   FullTags: key → BPM (gates: 20-key, 294-grid)  [Move 2 starts]
Weeks 5–7   fingerprints + megadj upgrade (D24+L62 fused)
Weeks 6–9   CrateDeck: preflight+firmware notes (B12+N76),
            players.toml verdict (N75/77/78)               [Move 1 completes]
Weeks 8–10  C18a runbook → C21 differential mirror → C22
Weeks 10–13 O86 rails → O82 MCP → O83 weekly agent         [Move 3]
Rolling     S-effort palate cleansers: M69 format cmd, M70
            litter clean, M71 port-speed badge, M74 exporter
Later       Essentia heads → I46 cues (sliced: auto-cues
            first) → K57/K58 sources → K59 mining → `megadj drop`
```

**The reality gate still decides depth:** at monthly+ gig cadence, Moves 1–3
run as written and the I46 cue work earns its month. At a-few-times-a-year,
the honest build is: §0, FullTags P1 steps 1–3, O83, done — and M66/M67
(set copilot, double-drop) stay parked until B11 history harvest exists to
calibrate them.

**Stop condition (unchanged from the audit):** two consecutive months with
zero gigs and zero incident-log entries → finish Phase 1, keep the backup
running, freeze the rest.

---

## 5. What we will NOT build (and why, so it stays decided)

| Item                                    | Reason it stays out                                                                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine DJ / Serato anything (E31, E44)  | **Struck 2026-09-05.** P2 is absolute: Mac only, Pioneer only. We can hack Pioneer _because_ we stand only on it. Slots left empty per the cap rule                                                                                                     |
| Legacy-pdb writes (C18b/c)              | Gauntlet written down, priced, parked. Asymmetry (corrupted library at a venue vs deleting a few-times-a-month dance) is terrible at current frequency. The `fragmede/rekordbox-pdb` library makes it _possible_; the gauntlet keeps it _safe_, if ever |
| Personal affinity model (I52)           | Deleted in the audit; bounded sibling M64 waits for B11 real history                                                                                                                                                                                    |
| Synced lyrics (K56), setlist.fm (K60)   | No DJ-workflow payoff; triggers are "only if bored" / non-DJ gig mining                                                                                                                                                                                 |
| Multi-machine realtime, cloud, accounts | P1/P9. Merge-key design note (E34) exists so it stays cheap _if ever_ — that's all                                                                                                                                                                      |
| Stems as playback files                 | N81 keeps it analysis-side; CDJs can't play them. Explicitly parked, non-goal today                                                                                                                                                                     |

---

## 6. Risks & mitigations

1. **License wall** — the best tag models are NC (Essentia CC BY-NC-SA, MERT/MuQ CC-BY-NC). Irrelevant at zero commercial intent (P9); a hard wall if FullTags ever ships as a product. _Mitigation:_ per-model license ledger in the model-cache manifest from day one; MusicFM as the clean fallback for embeddings.
2. **Verifier scarcity** — key/BPM/structure models are only as good as the spot-checks. _Mitigation:_ labeled ground truth already identified (MIK output for key, the 294 fixed grids for BPM); batch caps + sampled diffs.
3. **The year-trap, generalized** — flash-lite guesses 2023 for every year. _Mitigation:_ FullTags' idempotent writer makes re-runs safe; every model output gets confidence gate + verify pass + diff view.
4. **Disk burn** — model caches (~1 GB Essentia zoo) + demucs temp stems on a 460 GB disk that runs hot. _Mitigation:_ cache to `~/.local/share/fulltags/`, stems to temp and deleted, and — first — actually do §0a (the SSD evacuation this whole list keeps deferring).
5. **Hardware-truth drift** — everything here assumes the dual-DB gate stays honest. _Mitigation:_ the four open acceptance items need one real-hardware session; M6 resilience pass + `cratedeck-v0.1.0` tag closes the loop.
6. **Solo-maintainer scope** — three projects, one human, finite evenings. _Mitigation:_ the cap rule (something ships or leaves before something new enters); the reality gate; this proposal's three moves instead of twelve parallel tracks.

---

## 7. Success criteria

| Metric                                    | Target                                                  | Measured by                               |
| ----------------------------------------- | ------------------------------------------------------- | ----------------------------------------- |
| Gig-day answer time ("is this stick ok?") | < 60 s, one click                                       | preflight (B12) latency                   |
| Metadata completeness                     | 100% art/title/artist/album/genre/year, now + key + BPM | `megadj audit` / `fulltags audit` exits 0 |
| Key/BPM accuracy vs ground truth          | ≥80% key agreement; >98% grid agreement                 | spot-check harnesses from Move 2          |
| Mirror cost                               | weekly mirror in minutes, not hours                     | C21 differential run timing               |
| Hands-off reliability                     | weekly agent digest, zero manual triggers               | O83 run log                               |
| Redundancy                                | every gig playlist ≥ 2 drives or explicitly accepted    | B7 redundancy verdicts                    |
| Zero manual labour                        | ingest→tagged→staged with no hands                      | `megadj drop` dry-run E2E                 |

The bar is P6's, verbatim: does it _sound_ and _look_ pro on the booth, and
did it cost zero manual labour.

---

## 8. If you read only one more doc

- Decide → [PRINCIPLES.md](PRINCIPLES.md)
- Browse → [ideas.md](ideas.md) (§0 first)
- Build AI features → [fulltags-roadmap.md](fulltags-roadmap.md)
- Touch drives → [usb-sync.md](usb-sync.md) + the interlock rules
- Trust status claims → [cratedeck/acceptance.md](cratedeck/acceptance.md)
