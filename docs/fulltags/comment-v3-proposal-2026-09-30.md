# Comment v3 Proposal — 2026-09-30

Status: **PROPOSAL v2** — format pick + implementation spec

## Problem

Current format: `Fm · E5.4 · Party+Dance+Electronic`

| Field | Issue |
|---|---|
| Key (`Fm`) | Redundant — RB shows Key in its own column |
| Energy (`E5.4`) | ✅ Good — real sorting value |
| Mood (`Party+Dance+Electronic`) | **94% of library identical** — zero sorting value |

Every track in an EDM collection fires party (94.7%), electronic (90.0%),
and dance (96.4%). Showing those three labels tells the DJ nothing.

## Pioneer Hardware: No Emoji, No Symbols

`booth-text.ts` NON_FLEET_TEXT blocks **all** of:
- Emoji (U+1F000–1FAFF) — render as empty boxes or vanish on CDJs
- Miscellaneous Symbols (U+2600–27BF) — includes ☀ ★ ♪ ♠
- Geometric Shapes (U+25A0–25FF) — includes ▲ ▼ ● ○ ■
- Arrows (U+2190–21FF) — includes ↑ ↓ ← →
- All CJK, Cyrillic, Arabic, Hebrew

**Safe characters**: ASCII letters, digits, `·` (U+00B7 Latin-1 Supplement),
`-`, `/`, `|`, `%`, `(`, `)`, `:`, space. That's it.

So "smile icon 23% / dark icon 70%" must use **text abbreviations**,
not Unicode pictograms. This is actually better — abbreviations are
legible at arm's length on a dim CDJ screen where a tiny glyph isn't.

## Character Budget

| Surface | Visible chars | Scrolls? |
|---|---|---|
| RB DB (`djmdContent.Commnt`) | TEXT column — **no hard limit** | n/a |
| CDJ-3000 / XDJ-XZ display | ~50–60 | Yes — jog display auto-scrolls |
| CDJ-2000NXS2 | ~40 | Yes (slower) |
| CDJ-900NXS | ~32 | Yes |
| rekordbox app (list view) | Column-width dependent, 80+ | No (truncated) |
| CrateDeck web UI | Unlimited | n/a |
| Current max in library | 36 chars | — |

**Key insight**: all modern Pioneer hardware scrolls the comment field.
There is NO hard character limit — the only constraint is "how much is
visible at a glance" vs "how much scrolls". A DJ can read the first
50 chars instantly; the rest scrolls for deeper info.

This means we can design TWO tiers in ONE string:
- **First 40-50 chars**: the at-a-glance data (energy, vibe, key moods)
- **Chars 50+**: extended data that scrolls (extra genres, set placement)

## Available Data — Discriminative Analysis

Measured from archive.db, 4,555 mood-analyzed tracks (Sep 30 2026 12:53 ET).

### Dimensions Worth Showing (discriminative)

| Dimension | Range | Coverage | Distribution | Why useful |
|---|---|---|---|---|
| Energy (1–10) | Integer | 4,644/4,569 (99.6%) | Full 1–10 spread | Mixing energy levels — the #1 sorting field |
| Aggressive | 0–97% | 4,555 (99.6%) | Smooth ramp, no bucket > 8% | How hard/heavy — distinguishes a chill house track from a peak techno banger |
| Happy | 0–99% | 4,555 (99.6%) | 49% below 20%, 25% at 20–40%, 14% at 40–60% | Emotional tone — euphoric vs dark vs neutral |
| Vibe (7 buckets) | Word | 4,555 (99.6%) | Smooth 29.7%, Bright 21.9%, Driving 18.7%, Medium 12.7%, Groovy 8.1%, Hard 6.7%, Deep 2.2% | Quick-read character label, no bucket > 30% |
| Secondary genre | 27 labels | 2,744/4,569 (60.1%) | EDM 875, House 584, Techno 319, Tech House 278, Hip-Hop 176 | Style context beyond the primary genre column |
| Tertiary genre | Parsed from votes | Variable | Long tail | Extra style depth when available |

### Dimensions NOT Worth Showing (saturated for EDM collection)

| Dimension | Why skip |
|---|---|
| Danceability | **96.4%** of tracks are 95–100% — everything is danceable, zero info |
| Electronic | **90.0%** fire > 0.5 — it's an EDM collection, everything is electronic |
| Party | **94.7%** fire > 0.5 — same saturation |
| Valence | **90.7%** cluster at 4.0, 9.3% at 5.0 — nearly no spread |
| Arousal | **96.6%** cluster at 5.0 — already captured by Energy mapping |
| Primary genre | Already in RB Genre column via genre-sync |
| BPM | Already in RB BPM column |
| Key | Already in RB Key column |

### What About "Aggressive" as a Word?

The current vibe system maps `aggressive > 0.7` → "Hard". But "Hard" hides
the granularity: a track at 71% aggro and one at 95% aggro are both "Hard"
but feel very different in a mix. Showing the **raw percentage alongside the
vibe word** gives DJs both the quick label AND the precision:

```
E9·Hard·A95·H3·Techno       ← REALLY hard, dark
E7·Hard·A72·H34·Tech House  ← hard but with some fun
```

The vibe word is the "what kind of track is this?" glance. The A/H numbers
are the "how much of each?" precision for mixing decisions.

## Data Quality Edge Cases Found

**83 tracks** have secondary genre = primary genre (e.g., genre "House",
genre_secondary "House"). The v3 builder must deduplicate: if secondary
matches primary, skip it and promote tertiary. Implementation: casefold
compare in `build_comment()` and `buildCommentV3()`.

## Format Design: Three Tiers in One String

All tiers share the same builder — it just emits more fields as data
is available. The "tier" is what the DJ sees at a glance on their
hardware; the rest scrolls.

### Anatomy

```
E6·Driving·A46·H27·Tech House-Progressive·Build
│  │       │   │   │                       │
│  │       │   │   │                       └─ Set placement (scrolling zone)
│  │       │   │   └─ Secondary-Tertiary genres (dash-joined)
│  │       │   └─ Happy % (0-99, omit if <5 — reads as neutral)
│  │       └─ Aggressive % (0-99, omit if <5 — reads as chill)
│  └─ Vibe bucket (7 labels)
└─ Energy integer (1-10)
```

### Tier 1: Compact — any CDJ screen (20–30 chars)

For tracks with sparse data or when only the essentials matter:

```
E6·Driving·Tech House
E9·Hard·Techno
E5·Smooth
```

### Tier 2: Mood-Rich — CDJ-3000/XDJ-XZ at a glance (30–45 chars)

The recommended default. Adds the raw aggressive/happy percentages:

```
E6·Driving·A46·H27·Tech House
E9·Hard·A95·H3·Techno
E5·Smooth·A2·H80·Deep House
E10·Driving·A67·H34·Tech House
E7·Groovy·A25·H46·House
E8·Bright·A3·H72·EDM
```

Reading these mid-set: "E9 Hard A95 H3 Techno" = energy 9, hard,
95% aggressive, 3% happy, techno subgenre → peak-time dark techno.
"E8 Bright A3 H72 EDM" = energy 8, bright, barely aggressive, very
happy → euphoric buildup track.

### Tier 3: Full — scrolls on CDJ, visible in rekordbox (40–60 chars)

Adds tertiary genre and set placement when available:

```
E6·Driving·A46·H27·Tech House-Progressive·Build
E9·Hard·A95·H3·Techno-Trance·Peak
E5·Smooth·A2·H80·Deep House·Opener
E3·Deep·A8·H5·Electronica·Closer
E8·Bright·A3·H72·EDM-Pop·Floor
```

### Real Library Examples

| Track | Primary | Comment v3 (Tier 2) | Chars |
|---|---|---|---|
| MEDUZA - NO SLEEP (BEARKAT RMX) | Techhouse | `E10·Driving·A67·H34·Tech House` | 31 |
| Diamond Girl - CIREZ D | Techno | `E5·Driving·A58·H27·EDM` | 23 |
| Creamfields 2019 ID - Cirez D | Techno | `E9·Driving·A63·H3·Trance` | 25 |
| Walking On A Dream - prodbyocx | Techno | `E8·Driving·A46·H27·EDM` | 24 |
| Wonders - Neelix et al. | Trance | `E9·Medium·A24·H3·Techno` | 25 |
| The Rush - entity_A | EDM | `E8·Medium·A21·H36·Tech House` | 30 |
| Would You (Go To Bed…) | Electronic | `E9·Medium·A21·H46·EDM` | 23 |
| Petrichor - RIGOONI | EDM | `E8·Smooth·A3·H2·House` | 22 |
| Aura - Anthony P. | Afro House | `E9·Smooth·A2·H3·Techno` | 23 |

**Max observed: 31 chars** at Tier 2. Fits any modern CDJ with room.
Tier 3 adds ~15–20 chars for genres/placement → 45–50 chars, still
within the no-scroll zone on CDJ-3000.

## Set Placement Derivation

A bonus field for Tier 3, derived from energy + vibe (zero new analysis):

| Vibe + Energy | Placement | DJ meaning |
|---|---|---|
| Hard + E ≥ 8 | Peak | Main room climax |
| Hard + E < 8 | Build | Ramping up intensity |
| Driving + E ≥ 7 | Build | The ramp before peak |
| Driving + E < 7 | Floor | Sustain energy, keep moving |
| Groovy (any) | Floor | Fun, bouncy, dance-focused |
| Bright + E ≥ 6 | Floor | Uplifting, euphoric |
| Bright + E < 6 | Opener | Warm, inviting |
| Medium (any) | Floor | Solid sustain |
| Smooth + E ≥ 5 | Floor | Flowing, easy transitions |
| Smooth + E < 5 | Opener | Set start, ease in |
| Deep (any) | Closer | Late night, moody wind-down |

Five labels: Peak / Build / Floor / Opener / Closer. Distribution will
follow the energy × vibe cross-product — no bucket should dominate.

## A/H Percentage: Why This Beats the Old Mood Heads

The old v2 showed one binary label: `AGGRO` or `HAPPY` or nothing.
Problems: (1) only one label shown per track, (2) boolean (fired or not),
(3) thresholded at library fire rate, (4) saturated heads suppressed.

The v3 A/H percentages fix all four:
1. **Both shown** — you see aggressive AND happy simultaneously
2. **Continuous** — 70% aggressive is different from 95%
3. **No threshold** — the number IS the data
4. **No saturation gate** — A and H are the two non-saturated dimensions

The "vibe word + A/H numbers" pattern gives the DJ two reading speeds:
- Scanning: read "Hard" or "Bright" → instant character
- Mixing: check A95 H3 vs A72 H34 → this track is darker than that one

## Omission Rules

- **A < 5**: omit `A` field entirely (reads as "not aggressive / chill")
- **H < 5**: omit `H` field entirely (reads as "not particularly happy")
- **Secondary = primary**: skip, promote tertiary
- **No secondary**: genres field omitted
- **Placement**: only in Tier 3; omit when redundant (e.g., Groovy is
  always "Floor" — the vibe word already tells you)

These keep the string tight: a track at A2 H3 shows only `E5·Smooth·Deep House`
(18 chars) — the absence of A/H IS the information (nothing stands out).

## Comparison with Existing Formats

| Format | Example | Info content | Problem |
|---|---|---|---|
| v1 | `8A · E6 · Party+Dance+Electronic` | Key + energy + mood | Key redundant; moods 94% identical |
| v2 (current) | `Fm · E5.4 · Party+Dance+Electronic` | Same | Same — 94% identical strings |
| v3 (this proposal) | `E6·Driving·A46·H27·Tech House` | Energy + vibe + aggro% + happy% + subgenre | Every field discriminates; 7 dimensions in 25–35 chars |

**Information density gain**: v2 carries ~3 useful bits (energy decile).
v3 carries ~18 useful bits (energy + 7 vibes + aggro 0–100 + happy 0–100
+ 27 genre labels). That is a ~6× information increase in fewer characters.

## Separator: `·` (kept, no spaces)

The compact `·` separator (no spaces) from the current v3 spec is retained.
Spaces waste chars on a CDJ display. The `·` is visually clean and
fleet-safe (U+00B7, Latin-1 Supplement).

## Implementation

### Phase 1: TS builder + tests

Update `src/fulltags/booth/comment-v3.ts`:
- Add `aggressive` and `happy` fields to `CommentV3Input`
- Add `placement` field (optional, Tier 3)
- Omission rules (A < 5, H < 5, secondary = primary dedup)
- Update `parseCommentV3` to round-trip the new fields
- Add `setPlacement()` function deriving from energy + vibe

### Phase 2: Python builder sync

Update `comment-sync.kit.py`:
- `build_comment()` emits Tier 2/3 format
- `resolve_data()` returns aggressive, happy raw percentages
- Secondary = primary dedup in the genre fields
- `set_placement()` mirrors the TS derivation

### Phase 3: Library rollout

```
megadj rb-comment-sync --apply --yes
```

One command rewrites all 3,819+ comments. Idempotent — re-run safe.
Verify via delayed re-read (existing contract).

### Phase 4: CrateDeck render

Update the Comment column renderer to parse and colorize v3 fields:
- Energy: color-coded (green → yellow → red)
- Vibe: badge/pill
- A/H: mini bar or gradient
- Placement: icon or label

## Recommendation

**Tier 2** as the default: `E6·Driving·A46·H27·Tech House`

Five fields, 25–35 chars, fits any screen, every field carries real
discriminative value. The aggressive + happy percentages replace the
useless party+dance+electronic labels with actual mixing data.

Tier 3 (set placement + tertiary genre) is opt-in for power users
who want the scrolling extra data.
