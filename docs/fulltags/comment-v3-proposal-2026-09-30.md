# FullTags Booth Metadata v4 — Comment, Color & My Tag Spec

**Sep 30 2026** · Status: **PROPOSAL** — format pick + implementation spec

## Summary

v4 replaces the mood-label comment with a mix-first booth string, backed
by My Tags for filtering and track color for scanning:

```
E8 IN:32 OUT:16 VOX Drop Dark · MelTechno
```

Read mid-set: energy 8 of 9, 32-bar mixable intro (you have 32 bars of
instrumental music at the start to blend over before vocals or the main
melody kicks in), 16-bar clean outro (16 bars of instrumental at the end
after the last vocal or melodic phrase fades), vocals appear inside those
mix zones so watch for clash, a big build-and-drop track, dark for its
genre, melodic techno subgenre.

**Key decisions:**

- **Comment shows only what no other rekordbox column shows.** Key, BPM,
  primary genre and rating stay in their own columns.
- **Mix window first.** IN/OUT bar counts and vocal clash risk decide
  whether a blend works; that is the question asked most at the booth.
- **Mood is relative to genre.** "Dark" means dark *for a techno track*,
  so the words stay informative in a library of similar songs.
- **Three channels, not one.** Comment for reading, My Tags for on-deck
  filtering (the XDJ-XZ has Track Filter), color for scanning energy
  down a list.
- **Words, not symbols.** The token itself is the check mark: if `VOX`
  is present, the track has vocals. No emoji, no arrows, no symbols.
- **Accuracy over reuse.** v4 re-derives energy, vocals and structure
  rather than reformatting v3's uncalibrated classifier outputs.

**Why it beats v3:** v3's A/H percentages repeat the vibe word, its
two-digit precision is noise, and its set placement is a pure function
of fields already shown. v4 drops all three and adds mix window, vocal
clash and drop/roll shape — none of which exist anywhere in rekordbox
today.

---

## Hardware Facts

The XDJ-XZ has Track Filter, so My Tags are worth writing: they become
filterable at the booth, not just in rekordbox.

| Fact | Detail | Confidence |
|---|---|---|
| XDJ-XZ has Track Filter | Inherited from the CDJ-2000NXS2 alongside QWERTY search and shortcuts (Soundstore XL) | Medium — retailer listing; confirm on unit |
| NXS2-style Track Filter criteria | BPM, key, rating, color and My Tags, combinable with AND/OR (Bonedo review) | High |
| Filter follows the master deck | e.g. only tracks within 3% BPM of the playing track, updating as you load new tracks (RA review) | High |
| Filters are set at the player | Cannot be preset from rekordbox for USB playback (Digital DJ Tips) | High |
| Track colors | 8 fixed colors (Pink, Red, Orange, Yellow, Green, Aqua, Blue, Purple); one per track; no gradients | High |
| Comment charset | ASCII letters, digits and `· - / | % ( ) :`; no emoji, arrows, check marks or geometric symbols (from `booth-text.ts`) | High |
| `+` renders | Already in the live library (`Party+Dance+Electronic`) | High |

**2-minute hardware check:** hold Track Filter on the XDJ-XZ, confirm
My Tag appears as a criterion, and test an AND of two tags. This single
check gates Phase 3.

---

## Three Channels

Each channel does one job. All three are written by the same sync run
from the same analysis row.

| Channel | Job | Content | Where it shows |
|---|---|---|---|
| **Comment** | Read a track at a glance | `E8 IN:32 OUT:16 VOX Drop Dark · MelTechno` | Deck info, browse list, rekordbox column; scrolls on long strings |
| **My Tags** | Filter a playlist at the booth | `[Vocal]` `[Drop]` `[Dark]` `[MelTechno]` `[TechHouse 58%]` `[Trance 22%]` | Track Filter on XDJ-XZ / CDJ-3000; rekordbox filter |
| **Track color** | Scan energy down a list | 6 colors mapped from E1–E9 | Color bar in every browse list |

**Booth filter recipes this enables:**

- **Long blend candidates:** `[Roll]` AND `[Vocal] = INST`, BPM ±3%
- **Peak moment:** `[Drop]` AND color Red or Orange
- **Mood switch:** `[Euph]`, when the room needs lifting after a dark run
- **Subgenre dive:** `[AfroHouse]` to browse only that style

The comment carries a word only when it fires. My Tags carry **every
value** including `INST` and `Mid`, because a filter needs an explicit
value to match against.

---

## Comment Grammar v4

The first two tokens (energy and mix window) are always present. Every
other token appears only when it fires — the token itself is the check
mark.

```
E{1-9} IN:{bars} OUT:{bars} [VOX|HOOK] [Drop|Roll] [Hard|Soft] [Dark|Euph] [VAR] [· Subgenre]
```

### Token Reference

| Token | Values | What it means | When it fires |
|---|---|---|---|
| `E` | E1–E9 | Energy band, library-relative; higher = more energy. E9 is the hardest-hitting ninth of your own library. | Always |
| `IN:` | 0, 8, 16, 32, 64 | **Intro mix window in bars.** How many bars of clean instrumental music at the START of the track before the first vocal or main melody kicks in. A DJ blends over this window. `IN:32` = "you have 32 bars to mix in before anything melodic or vocal starts." `IN:0` = "vocals or melody start immediately — no room to blend." `IN:64` = "64 or more bars of intro — extended mix, lots of room." Always rounded DOWN to the nearest value so you never promise mix room that isn't there. | Always |
| `OUT:` | 0, 8, 16, 32, 64 | **Outro mix window in bars.** How many bars of clean instrumental music at the END of the track after the last vocal or melodic phrase fades out. `OUT:16` = "16 clean bars at the end to mix out of." `OUT:0` = "track ends abruptly or vocals/melody run to the end — mix early or use a loop." | Always |
| `VOX` | present or absent | **Vocal clash warning.** Vocals appear inside the intro or outro mix window, meaning you might hear two vocal tracks at once during a blend. Does NOT mean the track has no vocals overall — just that they creep into the zones where you'd be mixing. | ~15–35% of library |
| `HOOK` | present or absent | **Vocals in the body only.** The track has vocals, but ONLY in the main body — the intro and outro mix windows are clean and safe to blend. You get a vocal track that mixes like an instrumental. | ~15–35% of library |
| `Drop` | present or absent | **Build-and-drop structure.** The track has a clear tension arc: a breakdown (drums/bass drop out), a build (energy ramps up), and a drop (everything hits at once). Classic peak-time EDM shape. Absence means the track grooves steadily without a big contrast moment. | ~20–30% |
| `Roll` | present or absent | **Rolling groove.** The track maintains a steady, driving energy without a big build-and-drop moment. The floor keeps moving with no dramatic contrast. Think rolling techno, hypnotic house. Absence does NOT mean it has a drop — it might be neither (midsection utility tracks). | ~20–30% |
| `Hard` | present or absent | **Aggressive for its genre.** In the top 20% of aggression within its primary genre family. A "Hard" house track is hard *for house*, not compared to techno. Genre-relative so the word stays meaningful in a library of similar music. | ~20% |
| `Soft` | present or absent | **Gentle for its genre.** In the bottom 20% of aggression within its primary genre family. Opposite of Hard. | ~20% |
| `Dark` | present or absent | **Dark for its genre.** In the bottom 20% of happiness within its primary genre family. Minor keys, moody pads, no euphoria. | ~20% |
| `Euph` | present or absent | **Euphoric for its genre.** In the top 20% of happiness within its primary genre family. Uplifting melodies, major chords, festival energy. | ~20% |
| `VAR` | present or absent | **Variable tempo warning.** The beat grid is not constant — tempo changes, live drums, or edits that shift the BPM. Do NOT trust sync; beatmatch by ear or loop a stable section. Rare in quantized EDM; common in live recordings and edits. | Under 5% |
| `· Sub` | abbreviated subgenre | **Subgenre label.** The specific style within the broader genre family (which is already in the rekordbox Genre column). Only shown when the classifier is confident. Appears after `·` so the eye separates the glance zone from the scroll zone. | ~30–60% |

### How to Read IN/OUT

The intro/outro numbers answer one question: **"How long can I blend
over this track before it gets busy?"**

| IN: value | What you have at the start | Example scenario |
|---|---|---|
| `IN:0` | Nothing — vocals or melody from bar 1 | Radio edit, vocal house that starts singing immediately. Must loop-in or hard-cut. |
| `IN:8` | Short intro — 8 bars (~16 seconds at 128 BPM) | Quick intro, tight timing needed for the blend. |
| `IN:16` | Standard intro — 16 bars (~32 seconds) | Enough for a basic blend. Most club edits. |
| `IN:32` | Long intro — 32 bars (~64 seconds) | Comfortable blend, standard extended mix. Room to EQ and filter. |
| `IN:64` | Extended intro — 64+ bars (~2+ minutes) | Lots of room. Long extended mixes, DJ tools, transition tracks. |

Same logic for `OUT:` — how long you have at the END to blend the next
track in before this one finishes.

**Why bars, not seconds:** bars scale with BPM. 16 bars at 128 BPM is
32 seconds; at 140 BPM it's 27 seconds. But the DJ thinks in bars and
phrases, not seconds — "I have two 8-bar phrases to work with" is more
useful than "I have 32 seconds."

### Format Rules

- **Separator:** single space between tokens; `·` only before the
  subgenre so the eye sees *glance zone* and *scroll zone* as two parts.
- **Order is fixed** so the parser and your eye both know where to look.
  Glance zone max is 35 characters; worst case with subgenre is 48.
- **Search-safe:** E1–E9 (never E10), so searching `E1` cannot match
  `E10`; words are unique and do not appear in other tokens.
- **Parser regex** (both builders):
  `^E[1-9] IN:(0|8|16|32|64) OUT:(0|8|16|32|64)( (VOX|HOOK))?( (Drop|Roll))?( (Hard|Soft))?( (Dark|Euph))?( VAR)?( · [A-Za-z]+)?$`

---

## Energy Scale

Energy is E1 to E9 — nine bands, higher means more energy. E9 is the
hardest-hitting ninth of your own library.

- **Library-relative:** tracks are ranked by energy score, then cut into
  nine equal groups (~11% each, roughly 420 tracks per band at 3,800
  tracks). E5 is the middle of *your* collection, not the middle of all
  music.
- **Why relative:** in a library of similar EDM, an absolute scale piles
  most tracks into E7–E8 and the number stops telling tracks apart.
  Ranking guarantees the full spread.
- **Why 9, not 10:** single digit, so rekordbox search for `E1` never
  matches `E10`, and one character less on screen.
- **Peak energy, not average:** the band reflects the loudest sustained
  phrase (the drop), because that is what hits the floor. A track with a
  long quiet intro and a huge drop is still E9.
- **Consequence:** adding 500 harder tracks shifts some existing tracks
  down a band. That is correct (they are now less energetic relative to
  what you own), and the hysteresis guard prevents jitter: a track moves
  band only when 2 percentile points past the boundary.

---

## Color Mapping

rekordbox allows one of 8 fixed colors per track (no gradients), so v4
uses 6 colors as a cold-to-hot heat ramp over energy and keeps 2 free.

| Color | Energy bands | Share of library | Booth meaning |
|---|---|---|---|
| Blue | E1–E2 | ~22% | Warm-up, ambient, closers |
| Aqua | E3 | ~11% | Early set |
| Green | E4–E5 | ~22% | Sustain the floor |
| Yellow | E6 | ~11% | Lifting |
| Orange | E7–E8 | ~22% | Build toward peak |
| Red | E9 | ~11% | Peak-time bangers only |
| Pink | manual | — | Reserved for you (e.g. new, untested) |
| Purple | manual | — | Reserved for you (e.g. personal anthems) |

Red stays rare on purpose — a red bar in a playlist means something.
Sync never overwrites Pink or Purple; it only writes a color when the
track has none or already has a ramp color.

---

## My Tags — Genre Tags with Confidence

My Tags carry every value explicitly (filters need a value to match),
including genre information that goes beyond the main Genre column.

### Genre tags

Every genre vote that is NOT already in the rekordbox Genre column gets
its own My Tag with the vote percentage — how confident the system is
that this track belongs to that genre:

```
[TechHouse 58%]  [Progressive 22%]  [DeepHouse 12%]
```

If a track's Genre column says "House" and the vote breakdown has
Tech House at 58%, Progressive House at 22%, and Deep House at 12%,
all three become tags. The DJ can then Track-Filter for `[TechHouse]`
to narrow a House playlist to just the tech house subset.

**Confidence display:** always show the percentage — it's one glance
to know if the label is solid (58%) or a guess (12%). No mid/high/low
tiers — the number IS the tier, and it keeps things simple.

### Mood, shape and vocal tags

| Tag | Values | What it does |
|---|---|---|
| `[Vocal]` or `[Inst]` | every track gets one | Filter for instrumentals only (safe blends) or vocal tracks |
| `[VOX]` | only when vocal clash exists | Find tracks where you need to watch the blend zones |
| `[HOOK]` | only when body-only vocals | Find vocal tracks that blend cleanly |
| `[Drop]` or `[Roll]` or `[Steady]` | every track gets one | Filter by track structure/shape |
| `[Hard]` or `[Soft]` or `[Mid]` | every track gets one | Filter by aggression (genre-relative) |
| `[Dark]` or `[Euph]` or `[Neutral]` | every track gets one | Filter by mood (genre-relative) |
| `[VAR]` | only when tempo varies | Find tracks that need manual beatmatching |

Tags use `[ ]` display notation. Every category assigns a value to every
track so the filter always has something to match — unlike the comment,
which omits mid-range values.

---

## Genre Plan

Split genre into two levels: the rekordbox Genre column holds the broad
family, and the comment subgenre + My Tags hold the specific style.

- **Genre column = family:** House, Techno, Trance, Bass, EDM, Hip-Hop.
  Few values, sortable, rarely wrong.
- **Subgenre = the useful detail:** shown after `·` in the comment and
  written as a My Tag so Track Filter can isolate it.
- **Confidence gate for comment:** emit in the comment only when the top
  subgenre score is ≥ 0.5 and beats the runner-up by ≥ 0.15. Otherwise
  omit — a blank is better than a wrong label at the booth. (My Tags
  still get ALL subgenre votes with their percentages regardless.)
- **No tertiary genre, no dash-joined pairs.** One label or none in the
  comment. All candidates go into My Tags.
- **Dedup:** casefold-compare against the family; drop if equal.

### Subgenre Abbreviations

One word each, max 12 characters, so the parser never splits them:

| Subgenre | Token | Subgenre | Token |
|---|---|---|---|
| Tech House | TechHouse | Melodic Techno | MelTechno |
| Deep House | DeepHouse | Peak-Time Techno | PeakTechno |
| Afro House | AfroHouse | Hard Techno | HardTechno |
| Progressive House | ProgHouse | Minimal / Deep Tech | Minimal |
| Melodic House | MelHouse | Big Room | BigRoom |
| Organic House | OrgHouse | Future House | FutHouse |
| Bass House | BassHouse | Drum & Bass | DnB |
| Trance | Trance | Psytrance | Psy |
| Dubstep | Dubstep | Trap | Trap |
| Hip-Hop | HipHop | UK Garage | UKG |

The exact list follows the FullTags v3 genre rebench taxonomy
(epic [#346](https://github.com/webuildstuffio/megadj/issues/346));
the table is the naming rule, not the final set.

---

## Analysis Upgrades

Every token is re-derived from stronger signals. If a token can't meet
the accuracy bar, it stays out of the comment until analysis improves —
it can always be re-derived and rewritten later as better models or
sources become available.

| Token | Current source | v4 source | Why more accurate |
|---|---|---|---|
| Energy | Mood-head arousal mapping (96.6% stuck at 5.0) | Drop-phrase loudness + kick/onset density + spectral flux, percentile-ranked | Measures what hits the floor; ranked so the full E1–E9 spread is guaranteed |
| IN/OUT bars | none | rekordbox phrase analysis (PSSI in ANLZ) snapped to beat grid; own novelty detection as fallback | Uses rekordbox's own phrase labels already parsed |
| VOX / HOOK | none | Demucs vocal stem, RMS per bar, located against the intro/outro windows | Stem-level energy beats a whole-track classifier; tells you WHERE vocals are |
| Drop / Roll | none | Loudness contrast between peak phrase and breakdowns, plus drums-stem dropout in breakdowns | Directly measures the build-and-drop shape |
| Hard/Soft, Dark/Euph | Global thresholds on Essentia heads | Same heads, percentile within primary genre | Stops re-encoding genre (a "hard" house track != a "hard" techno track) |
| Subgenre | Secondary genre votes | FullTags v3 rebench model with confidence gate | Tracks epic #346 |
| VAR | none | Beat grid tempo changes read from ANLZ | Exact measurement, not estimated |

**No hand-labeling required up front.** The analysis pipeline runs
automatically. If results need refinement later, every token can be
re-derived and all comments rewritten with one command — nothing is
baked in permanently. The accuracy bar (see CI section) catches broken
tokens automatically.

---

## Stress Tests

Twelve edge cases run against the grammar. Five exposed rule changes,
now folded into the spec. Outputs are illustrative until the v4 analysis
ships.

### Case 1: Vocal house — vocals only in the breakdown

**Scenario:** A deep house track where the vocal melody only appears
during the breakdown/build section (the middle of the track). The intro
is a long instrumental groove, and the outro returns to the same groove.
Mix zones are completely clean.

**Output:** `E6 IN:32 OUT:32 HOOK Roll · DeepHouse`

**Reading:** Energy 6, 32-bar intro (long, clean), 32-bar outro (long,
clean), vocals exist but only in the body (HOOK — safe to blend), rolling
groove structure, deep house.

**What this exposed:** a single `VOX` flag would warn you off this track
— but it blends perfectly because vocals never touch the mix zones.
**Fix:** split into `VOX` (vocals IN the mix zones = clash warning) and
`HOOK` (vocals only in the body = safe blends).

### Case 2: Acapella from bar 1

**Scenario:** A vocal house track where the singer starts immediately
on bar 1. No instrumental intro at all.

**Output:** `E6 IN:0 OUT:32 VOX`

**Reading:** Energy 6, zero-bar intro (vocals from the start — no room
to blend in), 32-bar clean outro, vocal clash in the intro zone.

**What this exposed:** intro length must be measured to the first
vocal/melodic entry, not the first phrase change.
**Fix:** IN = bars before first vocal or lead-instrument entry.

### Case 3: Radio edit — short track, no intro, no outro

**Scenario:** A radio edit downloaded from YouTube. Vocals start
immediately, and the track fades out at the end. No mix-friendly zones.

**Output:** `E7 IN:0 OUT:0 VOX Drop`

**Reading:** Energy 7, zero intro, zero outro, vocal clash everywhere, a
build-and-drop structure. Looks alarming — but that IS the most useful
warning: this track needs special handling (loop a section, hard-cut, or
find the extended mix).

**What this exposed:** `0/0` looks broken but is correct.
**Fix:** keep as-is. CrateDeck can flag `IN:0 OUT:0` tracks with a
"find extended mix" suggestion.

### Case 4: Extended mix with 128-bar intro

**Scenario:** A DJ tool or extended mix with a very long instrumental
intro — 128 bars of drums-only before anything melodic happens.

**Output:** `E6 IN:64 OUT:64 Roll`

**Reading:** Energy 6, extended intro (64+ bars — over 2 minutes of mix
room), extended outro, rolling groove.

**What this exposed:** three-digit bar counts waste display width and no
DJ actually blends over 128 bars.
**Fix:** cap at 64, meaning "64 or more bars." Plenty of room regardless.

### Case 5: Intro of 30 bars — rounding rules

**Scenario:** A track with a 30-bar instrumental intro. Should that
round to 32?

**Output:** `E7 IN:16 OUT:32 Drop`

**Reading:** Energy 7, 16-bar intro (rounded DOWN from 30), 32-bar outro,
build-and-drop structure.

**What this exposed:** rounding UP would promise mix room that isn't
there. A DJ who sees `IN:32` expects 32+ bars. 30 bars is closer to 32
than 16, but the wrong direction is dangerous.
**Fix:** always round DOWN to the nearest step (0/8/16/32/64), so the
number is a guaranteed minimum.

### Case 6: Rap / trap — small genre family

**Scenario:** A trap track. The Hip-Hop family only has ~176 tracks
in the library. Within-family mood percentiles would be noisy.

**Output:** `E6 IN:8 OUT:8 VOX · Trap`

**Reading:** Energy 6, short 8-bar intro, short 8-bar outro, vocal
clash in the mix zones, trap subgenre. No Hard/Soft/Dark/Euph because
the genre family is too small for reliable percentile ranking.

**What this exposed:** families under ~300 tracks make within-family
percentiles unreliable (20% of 176 = 35 tracks — too few for a
meaningful "top 20%").
**Fix:** families under 300 tracks fall back to global percentiles
instead of within-family.

### Case 7: Euphoric hard trance — contradictory moods

**Scenario:** A trance anthem that is both aggressive (driving bassline,
distorted leads) and euphoric (uplifting breakdown, major-key melody).

**Output:** `E9 IN:32 OUT:16 Drop Hard Euph · Trance`

**Reading:** Energy 9, 32-bar intro, 16-bar outro, build-and-drop, hard
AND euphoric, trance. Both mood tokens fire together.

**What this exposed:** `Hard Euph` looks contradictory but isn't.
"Hard but euphoric" is a real and musically useful description — think
festival trance or uplifting hardstyle.
**Fix:** allowed. They measure different dimensions (aggression vs
happiness). Both can be in the top 20%.

### Case 8: Afro House mislabelled Techno in v3

**Scenario:** "Aura" by Anthony P. — an Afro House track that v3's
secondary genre vote called "Techno." The techno label was low-confidence.

**Output:** `E6 IN:32 OUT:32 Roll Soft · AfroHouse`

**Reading:** Energy 6, long intro, long outro, rolling groove, soft for
its genre, afro house subgenre. The Genre column says "House" (correct
family). The comment says "AfroHouse" (correct subgenre). No misleading
"Techno" label.

**What this exposed:** low-confidence subgenres in v3 put wrong labels
at eye level.
**Fix:** confidence gate — subgenre only emits when score ≥ 0.5 and lead
≥ 0.15 over runner-up. Family in Genre column stays correct regardless.

### Case 9: Live-drum edit with drifting tempo

**Scenario:** An edit of a live recording. The drummer plays slightly
ahead/behind the grid. BPM drifts between 120 and 123.

**Output:** `E5 IN:16 OUT:16 VAR`

**Reading:** Energy 5, 16-bar intro, 16-bar outro, **variable tempo
warning** — do not trust sync, beatmatch by ear.

**What this exposed:** sync fails on these tracks and bar counts are
approximate. The DJ needs a heads-up.
**Fix:** add the `VAR` warning token, sourced from ANLZ grid data.

### Case 10: Utility track — nothing extreme

**Scenario:** A mid-energy house track with no vocals, no dramatic
drop, average aggression, average happiness. A solid floor filler with
no standout characteristics.

**Output:** `E5 IN:32 OUT:32`

**Reading:** Energy 5, long intro, long outro. No other tokens fire.
Sparse, but honest: a safe tool track with nothing to warn about and
nothing to get excited about.

**What this exposed:** nothing; confirms that absence of tokens is the
correct signal for "average everything."

### Case 11: Worst-case string — every token fires

**Scenario:** Hypothetical peak-time techno with vocals in the mix zone,
a big drop, hard and dark for its genre, variable tempo, and a confident
subgenre label.

**Output:** `E9 IN:64 OUT:64 VOX Drop Hard Dark VAR · PeakTechno`

**Reading:** 48 characters total. Glance zone (before `·`) is 38 chars.

**What this exposed:** even the worst case fits within the CDJ-3000's
~50-char display and within the 48-char target.

### Case 12: 500 harder tracks added — energy band churn

**Scenario:** You import 500 tracks that are all harder than your
current library average. Many existing tracks should shift down one
energy band because they're now relatively less energetic.

**Output:** Many tracks drop from, say, E7 to E6.

**What this exposed:** every import could churn band assignments,
changing colors and comments across the library.
**Fix:** hysteresis guard — a track moves band only when 2 percentile
points past the boundary, preventing jitter on small imports.

---

## Guards and CI Tests

The saturation guard fails at 80%, not 50%, because the library is
intentionally homogeneous; it exists to catch a broken token, not to
punish a consistent crate.

| Test | Rule | Fails on |
|---|---|---|
| Saturation | Any absolute token (VOX, HOOK, VAR, any single subgenre) fires on > 80% of the library | Hard fail |
| Family saturation | Same check within one genre family | Warning only (VOX near 100% in hip-hop is expected) |
| Dead token | Any token except VAR fires on under 2% | Hard fail: threshold is wrong or signal is broken |
| Percentile drift | Relative tokens (E bands, Hard/Soft, Dark/Euph) off target share by > 3 points | Hard fail: bug in ranking code |
| Round-trip | `parse(build(x)) == x` in TS and Python, and both builders emit identical strings | Any mismatch |
| Grammar | Every comment matches the parser regex | Any non-match |
| Charset | Every comment passes `booth-text.ts` allowlist | Any blocked character |
| Length | Glance zone at most 38, full string at most 48 | Any overrun |
| Stability | Re-running analysis on unchanged audio changes at most 1% of comments | Over 1% |
| Accuracy | Each token agrees with analysis confidence bars | Token is suppressed, not the build |

The audit prints a fire-rate table per token on every run, so threshold
tuning is a read of one table rather than a debugging session.

---

## Rollout

Six phases. Nothing touches the live library until Phase 5, and each
phase has a gate.

1. **Hardware check.** Confirm My Tag filtering on the XDJ-XZ Track
   Filter. **Gate:** works, or My Tags drop to a rekordbox-only
   nice-to-have.

2. **Analysis pipeline.** Phrase extraction from ANLZ, Demucs
   vocal/drum stem pass (one-time overnight batch — cache bar-level
   RMS, not the stems), energy model fit, within-family percentiles.
   **Gate:** every token meets its accuracy bar, or is suppressed.

3. **Builders and CI.** TS `comment-v4.ts` and Python `comment-sync` in
   lockstep, My Tag and color writers, all guards green.
   **Gate:** CI passes on the full library in dry-run.

4. **Field test.** Export one USB with v4 comment, My Tags and color;
   play a practice set on the XDJ-XZ; note which tokens you actually
   used. **Gate:** cut anything you ignored.

5. **Library run.** `megadj rb-comment-sync --apply --yes`, delayed
   re-read verify, then CrateDeck renderer update (energy color chip,
   token pills).

6. **Iterate.** Any token can be re-derived and all comments rewritten
   with one command. Nothing is permanent — if better analysis arrives,
   re-run and every track updates.

---

## Comparison with Previous Formats

| Format | Example | Problem |
|---|---|---|
| v1 | `8A · E6 · Party+Dance+Electronic` | Key redundant; moods 94% identical |
| v2 | `Fm · E5.4 · Party+Dance+Electronic` | Same saturation, same waste |
| v3 | `E6·Driving·A46·H27·Tech House` | A/H repeat the vibe word; no mix window; no vocal clash |
| **v4** | `E8 IN:32 OUT:16 VOX Drop Dark · MelTechno` | Every token answers a DJ question; mix window is new; mood is genre-relative |

---

## Open Questions

- [ ] Does My Tag show up as a Track Filter criterion on XDJ-XZ firmware?
- [ ] Do you already use track colors by hand? If yes, which ones must
      sync leave alone besides Pink and Purple?
- [ ] Is rekordbox phrase analysis enabled for your library (PSSI data
      in the ANLZ files)?
- [ ] Should rap and trap share the same energy ranking as EDM, or get
      their own?
- [ ] Is the subgenre list final once the FullTags v3 rebench (#346)
      lands, or should v4 ship with the current labels first?

---

## Sources

- Soundstore XL: Pioneer XDJ-XZ — XDJ-XZ inherits Track Filter from the CDJ-2000NXS2
- Bonedo: CDJ-2000NXS2 test — Track Filter criteria and AND/OR
- Resident Advisor: CDJ-2000NXS2 review — dynamic filtering against the master deck
- Digital DJ Tips: CDJ-2000NXS2 review — filters set at the player
