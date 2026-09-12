# Set Builder: propose a DJ mix from the measured ledgers (M66)

One reusable workflow: pick the energy arc → run the proposal → read it →
hand the chain to a human or an agent. Every step is a **read** — the
builder proposes, never writes (no tags, no playlists, no drives).

## 0. When to reach for it

- "build me a warm-up set", "propose a 60-minute peak-time mix",
  "what flows from this track?" — anything that needs an ORDERED chain
  from the archive's measured data (BPM, Camelot key, mood axes).
- Prereqs: `megadj beats` + `megadj mood` populated the ledgers (empty
  pool = run those first); keys live on the FILES (TKEY), so AIFF/MP3
  only — WAV candidates simply lose the key-score, they don't fail.

## 1. The one command (CLI = MCP = web, one engine)

```bash
megadj setbuild --preset warmup --minutes 45          # human table on stdout
megadj setbuild --preset peak --minutes 60 --json     # the full payload
megadj setbuild --opener <video_id> --preset afterhours
```

- `--preset` `warmup|peak|afterhours` (default peak; anything else exits 2
  with the valid list — never a silent fallback)
- `--minutes` 10–240 (clamped; default 60)
- `--opener` force the first track; a bad/unplayable id is EXCLUDED
  LOUDLY in the payload (`excluded[].reason`), never silently ignored
- `--limit` candidate pool cap 1–1000 (default 300; the clamp is shared
  with the route/MCP contract)

Exit codes: 0 = proposal (even a small one), 1 = empty chain (nothing
analyzed/mixable), 2 = bad flag input.

Same capability, other surfaces:
- MCP: `archive_set_build {preset, minutes, opener?, limit?}`
- Web: FullTags ⌗ Similar → "Set builder — propose a mix"
- Engine SSOT: `cratedeck/src/setbuild.ts`; wire shapes:
  `cratedeck/shared/setbuild.ts` (re-exported from `shared/types.ts`).
  A parity twin test (`cratedeck/test/surface-parity.test.ts`) pins the
  CLI↔MCP pair — don't fork the surfaces.

## 2. Reading the payload (--json)

```jsonc
{
  "available": true,
  "pool": 300,            // candidates actually loaded (≤ limit)
  "preset": "peak",       // id — resolve labels from SET_PRESET_DEFS
  "minutes": 60,          // the clamped budget actually used
  "freshness": {          // ledger ages — staleness is VISIBLE, not silent
    "beatsAt": "2026-09-11T21:37:23.224Z",
    "moodAt": "2026-09-11T23:36:54.641Z"
  },
  "steps": [              // the ordered chain
    { "videoId": "…", "title": "…", "artist": "…", "bpm": 128.1,
      "key": "8A", "arousal": 6.2,
      "atMin": 5.2,       // cumulative minutes at the END of this track
      "transition": null } // null = opener; else 0..1 (tempo+key+arc fit)
  ],
  "excluded": [ … ],      // first 40, with the reason per track
  "excluded_total": 296   // the honest total (the list is a slice)
}
```

Transition score bands (UI pills agree): ≥0.75 "clean", ≥0.5 "ok",
below "tight". Keys follow the Camelot wheel from
`cratedeck/shared/camelot.ts` — "8A", "Am", "Gmaj", "7m" all parse; a
clash (0) can't be chained into, ±6% tempo is a hard window.

## 3. The honest failure modes (read these before claiming success)

- `pool: 0` → ledgers empty: run `megadj beats` + `megadj mood`.
- `freshness` older than your newest imports → the pool predates the new
  tracks: re-run `megadj beats` + `megadj mood`, then re-propose (the
  CLI prints the same ages; the web panel shows a freshness line with a
  tone: ≤2d ok, ≤14d warn, older stale).
- `steps: []` with `excluded_total > 0` → read the reasons: "no
  beats-ledger BPM" (analysis gap) vs "no compatible transition"
  (real musical dead-end — try a different preset/opener).
- A requested opener that isn't in the pool appears in `excluded` with
  "requested opener is not in the candidate pool" — fix the id or drop
  `--opener` to let the arc auto-pick.
- Proposals are DETERMINISTIC: same inputs → same chain (ties break by
  videoId). Re-running to "see if it improves" is a no-op by design;
  change preset/minutes/opener instead.

## 4. Handing the chain on

Human-readable table (no --json) is stable for pasting into notes; the
web panel's Copy button and the CLI rows carry the same shape
(`atMin  bpm  key  transition  artist — title`). Accept tracks into a
real playlist BY HAND — the write-off doesn't exist yet, and nothing in
this workflow stamps tags or touches drives.
