# megadj — Future Roadmap Proposal

_Proposal v3 · 2026-09-06 — reconciled with what shipped in the rev 4–6.2
burst + the failed BPM/genre gates. Grounded in a full read of every doc in
the repo._

**What this doc is:** the opinionated middle layer the repo was missing.
`ideas.md` holds every idea; this doc holds the _proposal_ — what to build
next, in what order, and **why**, grounded in the eleven product principles
and the actual shipped state. When this doc and ideas.md disagree, this doc
wins on ordering; ideas.md wins on detail. The live re-scored state lives in
[product-state-2026-09-07.md](../product-state-2026-09-07.md).

---

## 1. Where we are (state of the union, 2026-09-06)

The pipeline: **GetDat ─▶ FullTags ─▶ CrateDeck ─▶ the booth** — all three
cores shipped (the per-project detail and its gaps live in
[product-state-2026-09-07.md](../product-state-2026-09-07.md) §State by
project). Standing caveats: **four open acceptance items need real
hardware** ([acceptance.md](../cratedeck/acceptance.md)), and ideas.md §0 —
the SSD evacuation and the cold backup — outranks everything in this doc.

---

## 2. The proposal — three moves

Everything in the backlog collapses into three consecutive moves. Each is
independently shippable, each makes the next one cheaper, and each maps to a
principle.

### Move 1 — Harden the moat (CrateDeck v1.x) · _why: P6, minutes saved per gig_

The fleet layer (coverage/redundancy/diff) shipped, but the _gig-day_ layer
is still manual. This move finishes the "is this stick safe for tonight?"
loop the product brief defines as CrateDeck's reason to exist:

1. **B9 — global search across ghosts — ✅ shipped 2026-09-05** (⌘K).
2. **B12 + N76 — preflight with firmware advisories — ✅ shipped**
   (worst-status-wins per drive, exit 1 for cron/agents, the CDJ-3000
   v3.30 "playlists vanished" rule attached).
3. **N75+77+78 — the player-compatibility verdict — ✅ shipped**
   (`deckctl players`: AlphaTheta's official matrix × measured dual-DB
   rows → "works on: XZ ✓, AZ ✗" — the join rekordbox itself can't make).
4. **C18a — the assisted legacy-export runbook** — the remaining "right
   buy": no missed steps, auto-detected stage completion via pdb row
   counts and `playlists3*.sync` mtimes; makes the few-times-a-month
   dance un-failable.
5. **C21 + C22 — differential mirror + one-click "sync everything"** —
   safe under the interlock, checksum ledger as change detector; weekly
   mirror goes from hours to minutes.

**Why now:** these are pure reads/jobs over data the scans already collect;
no new analysis stack; every item is S–M effort. They compound — preflight
consumes the compatibility verdict, which consumes the dual-DB gate that
already ships.

### Move 2 — Complete the metadata (FullTags v1.x) · _why: P8, AI does the labour_

**Shipped (rev 4–6.2 + drop, Sep 5–7 2026) — gates executed against the
real 88-track archive, not just built:**

1. **Harmonic key — ✅ SHIPPED** (OpenKeyScan → `TKEY`+`TXXX:CAMELOT`,
   all 88 written; gate 80.7% exact vs RB — PASS). Remaining: the RB
   gauntlet at next drive mount.
2. **Real BPM — 🔶 pivoted** (TBPM writes gate-BLOCKED at 12/24 → 16/24
   within 2%; the value shipped as the `megadj beats` DB ledger +
   CrateDeck's independent `archive_grid_cross_check`).
3. **Fingerprint ledger — ✅ SHIPPED** (chromaprint, 88/88, idempotent;
   D24/D25/L62/L63 unblocked).
4. **Essentia heads — ✅ mood shipped, genre blocked** (`--mood` +
   energy 2.0 + `megadj mood` ledger; genre head saturated 0.87–1.0 —
   writes stay blocked).
5. **`megadj drop` (K61) — ✅ SHIPPED 2026-09-07** (one command:
   download → ingest → beats → mood → cues → organize).

**What remains of Move 2:** the RB key gauntlet (operational, 30 s),
vocal density, similarity embeddings. Full per-stage detail (models,
gates, gotchas): [fulltags-roadmap.md](../fulltags-roadmap.md).

### Move 3 — Agentify (the O layer) · _why: P1, agent-first is a principle_

**Functionally shipped (Sep 5–7 2026).** `bun run mcp` exposes
the whole product as **26 tools** (18 `deck_*` + 8 `archive_*`) over stdio
JSON-RPC — readonly tools annotation-marked, mutating ones flagged
`[MUTATES DRIVE STATE]` and gated by the interlock **inside the tool
layer** (where O86 said it must live); the archive half reads megadj's DB
through a physically readonly handle; O87 attribution rides every job; O88
notes + O85 plugin packaging shipped. Full census:
[cratedeck/deckctl.md](../../cratedeck/deckctl.md#mcp).

**What remains:** **O84** (the inbox-to-crate agent on top of `megadj
drop`) and the optional `claude -p` cron wrapper for the weekly digest.
The D30 archive-integrity sweep shipped inside `deckctl prep` (2026-09-07,
first run caught 88/88 stale DB sizes).

**Why:** the one-user-one-machine rule (P1) already says "if a feature can't
be expressed as a command an operator or an AI agent can run, it doesn't
exist." §O is the second half of that sentence, and the shipped rails are
what keep agents inside P9/P11's idempotent, resumable discipline.

---

## 3. The AI model slate (chosen, with why + license + gate)

Re-verified 2026-09-05 (see the research notes in ideas.md for the ledger).
All local/offline — P9's zero-telemetry and §H's cloud non-goal hold.

| Task            | Pick                                                                                                                                                                              | Why this pick (and what was rejected)                                                                                                                                                                                                                                              | License                         | Verification gate + result                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| Key / Camelot   | OpenKeyScan analyzer — **open-source repo mode** (stdin/stdout JSON, device auto-select CUDA>MPS>CPU); the `:58721` REST server belongs to the _closed desktop app_, not the repo | CNN extending MusicalKeyCNN, GiantSteps-trained, Rekordcloud-maintained; site claims beat RB/MIK/Serato on a 500-track set (marketing figures — verify locally before trusting); `keyfinder-cli` rejected (not in homebrew-core)                                                   | MIT (code)                      | ≥80% vs RB: **80.7% — PASS, 88/88 written**                                                         |
| Key cross-check | Essentia `Key` algorithm                                                                                                                                                          | free second vote; disagreements → review queue                                                                                                                                                                                                                                     | AGPL (code)                     | agreement tracking per batch                                                                        |
| BPM / downbeats | `beat_this`                                                                                                                                                                       | ISMIR 2024 SOTA without DBN; MIT; pip + Rust/ONNX ports; v1.1.0 current. **BeatFM beats it on paper (+4.1pt downbeat F1) but ships no code/weights — rejected again**; watch `livechord-beat-refiner` as a downbeat post-processor                                                 | MIT                             | vs RB grids, >2% flag: **12/24, re-gate 16/24 — FAIL → TBPM blocked, beats ledger shipped instead** |
| Structure/cues  | `all-in-one-infer` v3.x                                                                                                                                                           | functional segments + beats + demucs stems; **v3 rewrote NATTEN in pure PyTorch — installs on Apple Silicon with no compiler**; MLX port claims ~12.6× on AS (repo-reported). Labels pop-trained → map to drop/outro heuristically, verify on EDM first                            | MIT                             | 20-track EDM spot check before batch; **8-bar cue v0 shipped from the beats ledger (88/88)**        |
| Moods/genre/VA  | Essentia ONNX model zoo (MusiCNN etc.)                                                                                                                                            | official ONNX exports run on ARM64 today; research-grade replaces hand-rolled RMS + LLM-only genre. **Models are CC BY-NC-SA — fine for a personal library per P9, re-review before any commercial release**                                                                       | CC BY-NC-SA                     | **mood shipped 88/88 + energy 2.0; genre head saturated — writes blocked**                          |
| Energy          | danceability + DEAM arousal co-votes                                                                                                                                              | replaces RMS-linear; keeps the 1–10 UI scale (Energy 2.0)                                                                                                                                                                                                                          | (via Essentia)                  | **shipped** (`0.5·RMS + 0.3·dance + 0.2·arousal`)                                                   |
| Embeddings      | MUSE first → **MuQ-MuLan** as the strong step-up                                                                                                                                  | MuQ-MuLan (~700M, Tencent, MIT code) is 2026 SOTA zero-shot music tagging (MagnaTagATune AUC 79.3 vs CLAP 73.9–75.5); **weights CC-BY-NC** — same personal-use carve-out; MERT effectively superseded; MusicFM dormant since 2024                                                  | MIT (code) / CC-BY-NC (weights) | kNN sanity on "sounds like" queries                                                                 |
| Fingerprints    | chromaprint (`fpcalc`)                                                                                                                                                            | standard, one brew dep, AcoustID lookup free at 3 rps; chromaprint unchanged since 1.5.1 (2021) — stable and boring is good                                                                                                                                                        | LGPL                            | **shipped 88/88, idempotent**                                                                       |
| Dupe scanning   | dupsonic                                                                                                                                                                          | **Rust, v0.2.5, first release Jul 2026, ships macOS-aarch64 prebuilt binaries** — chromaprint + LSH + SQLite cache, built for 100k+ libraries; `soundalike` (Go, mature) is the safe fallback                                                                                      | MIT                             | precision spot-check vs known dupes                                                                 |
| Vibe captions   | none (garnish only)                                                                                                                                                               | I50 verdict stands: you'd read them twice and never filter by them. `megadj drop` prints one line; no infrastructure                                                                                                                                                               | —                               | none — deliberately not built                                                                       |
| Voice memo → ID | mlx-whisper (M68, later)                                                                                                                                                          | 20–30× realtime on Metal; only after K59 mining exists (its trigger)                                                                                                                                                                                                               | MIT                             | transcribe→resolve→queue E2E on 5 memos                                                             |
| Source health   | yt-dlp SoundCloud/Bandcamp watch                                                                                                                                                  | SC works (DataDome 403s fixed by merged browser-impersonation, Feb 2026; DRM-wrapped go+/premium tracks 404 — unsupported upstream by design). **Bandcamp broken since 2026-08-21** (yt-dlp #17506, open) — keep yt-dlp on nightly + `curl_cffi`; sequence K58 after the fix lands | —                               | nightly smoke test before K57/K58 batch                                                             |

**Model-gate rules (from P5/P7/P11, applied to ML):** paper-SOTA ≠
usable-SOTA — no pick without runnable code/weights on macOS ARM; every
model is tuned-for or verified-on electronic music before batch; spot-check
verifications before any batch run; never batch >50 tracks without a sampled
diff review (the year-trap generalization: every model output gets
confidence gate + verify pass + human diff, exactly like flash-lite's
"everything is 2023").

---

## 4. Sequencing

The 90-day time-box collapsed in the Sep 5–7 window — "Weeks 3–7" of
work happened in one evening once the gates were built. What survives is
the **order**, now owned by
[product-state-2026-09-07.md](../product-state-2026-09-07.md) §The queue
(1 RB gauntlet → 2 §0 survival → 3 memory-cue writes → 4 vocal
density + similarity → 5 C18a/C21/C22 → 6 O84, palate cleansers
whenever). §0 still gates it: no commit of substance while the SSD
evacuation (0a) is open.

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
4. **Disk burn** — model caches (~1 GB Essentia zoo) + demucs temp stems on a 460 GB disk that runs hot. _Mitigation:_ cache to `~/.local/share/fulltags/`, stems to temp and deleted, and — first — do §0a (the SSD evacuation this whole list keeps deferring).
5. **Hardware-truth drift** — everything here assumes the dual-DB gate stays honest. _Mitigation:_ the four open acceptance items need one real-hardware session; M6 resilience pass + `cratedeck-v0.1.0` tag closes the loop.
6. **Solo-maintainer scope** — three projects, one human, finite evenings. _Mitigation:_ the cap rule (something ships or leaves before something new enters); the reality gate; this proposal's three moves instead of twelve parallel tracks.

---

## 7. Success criteria

Re-measured against the real archive after the Sep 5–7 window — the
live scorecard (same eight metrics, now with measured verdicts) lives in
[product-state-2026-09-07.md](../product-state-2026-09-07.md) §Scorecard;
that page owns the numbers, this doc keeps the bar: **P6, verbatim —
does it sound and look pro on the booth, and did it cost zero manual
labour.**

---

## 8. If you read only one more doc

- Decide → [PRINCIPLES.md](../PRINCIPLES.md)
- Browse → [ideas.md](../ideas.md) (§0 first)
- Build AI features → [fulltags-roadmap.md](../fulltags-roadmap.md)
- Touch drives → [usb-sync.md](../usb-sync.md) + the interlock rules
- Trust status claims → [cratedeck/acceptance.md](../cratedeck/acceptance.md)
