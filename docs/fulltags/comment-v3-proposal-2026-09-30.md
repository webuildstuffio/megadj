# Comment v3 Proposal — 2026-09-30

Status: **PROPOSAL** — awaiting format pick

## Problem

Current format: `Fm · E5.4 · Party+Dance+Electronic`

| Field | Issue |
|---|---|
| Key (`Fm`) | Redundant — RB shows Key in its own column |
| Energy (`E5.4`) | ✅ Good — real sorting value |
| Mood (`Party+Dance+Electronic`) | **94% of library identical** — zero sorting value |

## Available Data Per Track

| Data | Coverage | Already in RB column? |
|---|---|---|
| Energy (1–10, from arousal) | 4,553 / 4,569 (99.6%) | No |
| Primary genre | 4,490 / 4,569 (98.3%) | **Yes** (Genre column via genre-sync) |
| Secondary genre | 2,745 / 4,569 (60.1%) | No |
| Vibe (7-bucket, from mood model) | 4,553 / 4,569 (99.6%) | No |
| BPM | 4,536 / 4,569 (99.3%) | **Yes** (BPM column) |
| Bright/happy flag | 4,553 / 4,569 (99.6%) | No |
| Source (rekordbox/ingest/SC) | 4,569 / 4,569 (100%) | No |
| Vote confidence | 4,363 / 4,569 (95.5%) | No |

**Rule**: only put data in Comment that ISN'T already visible in another
RB column. Primary genre and BPM are already visible → skip them.

## Vibe System (7 buckets — from aggressive + happy + valence)

Derived from the ONNX mood model's raw dimensions. The current
`Party+Dance+Electronic` labels are 94% identical because dance/party/electronic
are saturated for an electronic music collection. The **aggressive**, **happy**,
and **valence** dimensions actually discriminate.

| Vibe | Logic | Count | % | DJ Use |
|---|---|---|---|---|
| Smooth | low aggro, not happy, mid valence | 1,353 | 29.7% | Opening, flowing transitions |
| Bright | low aggro, happy | 999 | 21.9% | Uplifting moments, euphoric builds |
| Driving | aggro 0.4–0.7 | 850 | 18.7% | Building energy, the ramp up |
| Medium | aggro 0.2–0.4, not happy | 577 | 12.7% | Solid sustain, neutral energy |
| Groovy | aggro 0.2–0.4, happy | 371 | 8.1% | Fun, bouncy, dance-focused |
| Hard | aggro > 0.7 | 304 | 6.7% | Peak-time, heavy drops |
| Deep | low aggro, not happy, low valence | 99 | 2.2% | Late night, moody, introspective |

No bucket over 30%. All 7 are musically meaningful for set building.

## Secondary Genre Vocabulary (27 labels)

| Genre | Count | | Genre | Count |
|---|---|---|---|---|
| EDM | 875 | | Progressive House | 141 |
| House | 584 | | Pop | 100 |
| Techno | 319 | | Deep House | 62 |
| Tech House | 278 | | Rock | 39 |
| Hip-Hop | 176 | | Afro House | 39 |

Plus 17 more: Trance (33), R&B (29), Electronica (9), Latin (8), Indie Dance
(7), D&B (7), Bass House (7), Disco (6), Nu Disco (5), Jazz (4), World (3),
Soundtrack (3), Reggae (3), Dance (2), Country (2), Classical (1).

## Character Budget

- RB DB: TEXT column, no hard limit
- CDJ-3000 / XDJ-XZ display: ~50–60 chars visible without scroll
- CDJ-2000NXS2: ~40 chars visible
- Current max in use: 36 chars
- **Target**: ≤50 chars (renders fully on modern hardware)

## Top 10 Format Options

All options drop Key (redundant) and use integer energy.

---

### 1. `E6 Driving · Tech House` (minimal, recommended)

- **Chars**: ~25
- **Fields**: energy + vibe + secondary genre
- **Pros**: Fits any screen, scannable, three useful dimensions
- **Cons**: No extras

### 2. `E6 · Tech House · Driving` (genre-first)

- **Chars**: ~25
- **Fields**: energy + secondary genre + vibe
- **Pros**: Genre is primary sort key for most DJs
- **Cons**: Vibe at end gets cut on small screens

### 3. `E6 Driving · Tech House · Bright` (with happy flag)

- **Chars**: ~35
- **Fields**: energy + vibe + secondary genre + bright/dark flag
- **Pros**: Adds emotional color (22% bright, 6% dark)
- **Cons**: 72% show no flag (blank = neutral)
- Flag only renders on tracks that ARE bright or dark — most are neutral (no tag)

### 4. `E6 Smooth · Tech House · RB` (with source)

- **Chars**: ~30
- **Fields**: energy + vibe + secondary genre + source abbreviation
- **Pros**: Know where it came from (RB=rekordbox, SC=soundcloud, IN=ingest)
- **Cons**: Source not useful mid-set

### 5. `E6 Driving Tech House` (no separators)

- **Chars**: ~22
- **Fields**: energy + vibe + secondary genre
- **Pros**: Maximum density, reads as a phrase
- **Cons**: Harder to visually parse

### 6. `E6 Driving · Tech House / Deep House` (two genre levels)

- **Chars**: ~38
- **Fields**: energy + vibe + secondary + tertiary genre
- **Pros**: More genre context when available
- **Cons**: Only 60% have secondary; tertiary rarer

### 7. `E6 Driving · Tech House · Peak` (with set-placement hint)

- **Chars**: ~33
- **Fields**: energy + vibe + secondary genre + placement
- **Pros**: Direct set-building label (Opener/Build/Peak/Closer/Floor)
- **Cons**: Derived from same data — partly redundant with vibe
- Placement logic: Hard+highE=Peak, Driving=Build, Bright+midE=Floor,
  Smooth+lowE=Opener, Deep+lowE=Closer

### 8. `E6 Driving · Tech House · High` (with vote confidence)

- **Chars**: ~34
- **Fields**: energy + vibe + secondary genre + confidence tier
- **Pros**: Know when the genre is solid vs a guess (High/Med/Low)
- **Cons**: Meta-data about data — not directly useful mid-set

### 9. `E6 · Driving · Tech House · SC:summer-2025` (full provenance)

- **Chars**: ~45
- **Fields**: energy + vibe + secondary genre + source detail
- **Pros**: Full audit trail — when/where you found it
- **Cons**: Too long for small screens, not useful for performance

### 10. `E6 Driving · Tech House · v0.71 a0.42` (raw model scores)

- **Chars**: ~40
- **Fields**: energy + vibe + secondary genre + valence + arousal
- **Pros**: Precise data for power users, enables numeric sorting
- **Cons**: Not human-readable at a glance

---

## Recommendation

**Option 1** (`E6 Driving · Tech House`) — start here.

Three fields, 25 chars, fits any screen, all three dimensions carry real
sorting value. Iterate later: the comment is re-writable, so adding a field
(option 3's bright flag, option 7's set placement) is a future one-command
upgrade.

## Implementation

1. Update `comment-sync.kit.py` `build_comment()` to emit v3 format
2. Update `comment-v2.ts` → `comment-v3.ts` in TS layer
3. Run `rb-comment-sync --apply --yes` to overwrite all 3,819 comments
4. Verify via delayed re-read

The vibe bucket logic:

```python
def vibe_label(aggressive, happy, valence):
    if aggressive > 0.7: return "Hard"
    if aggressive > 0.4: return "Driving"
    if aggressive > 0.2 and happy > 0.3: return "Groovy"
    if aggressive > 0.2: return "Medium"
    if happy > 0.3: return "Bright"
    if valence < 4.2: return "Deep"
    return "Smooth"
```
