# SoundCloud downloads — audit + plan (link-first, rip-fallback)

**Status:** ✅ SHIPPED (2026-09-19) — P1–P5 landed same-day: SC source
plumbing, link-first, sets/user sources, SC-aware LOWQ floor, docs +
censuses ([#255](https://github.com/webuildstuffio/megadj/issues/255),
[#256](https://github.com/webuildstuffio/megadj/issues/256),
[#257](https://github.com/webuildstuffio/megadj/issues/257),
[#258](https://github.com/webuildstuffio/megadj/issues/258),
[#259](https://github.com/webuildstuffio/megadj/issues/259)).

**10x hardening pass (later Sep 19):** drop's SC link-surface writes the
ledger row (`link_surfaced` keyed by the numeric SC id — `sync` never
re-attempts); `status`/`list` render the cohort (`LINK` flag,
`links_surfaced` count, source-aware HIGHQ bar); `smarturl.it` joined
`SMART_LINK_HOSTS` (live Shelter probe: the canonical track's store
links silently ripped before); private likes/user 404s now name the
cookie remedy; SC payloads' `uploader`/`timestamp` map onto
artist/date (`scInfoToYtdlpInfo` — SC has no artist/release_date
fields, measured). Plan text below retained as the design record.

_As of 2026-09-19 (live-verified): yt-dlp 2026.08.19, Chrome cookies
extracting fine (3,424 cookies), `scsearch` + track `-J` probe + set
expansion all working against the real SC API._

## TL;DR

1. **SC ripping today is incidental, not supported.** `megadj sync` is
   YouTube-Music-only; `megadj drop <sc-url>` happens to work for ONE
   track (yt-dlp generic path) but expands no sets, records no source
   ledger row, and has no SC format policy.
2. **"Full quality" on SoundCloud = 160 kbps AAC (HLS) for normal
   tracks.** There is no 320 mp3 for non-Go+ sessions. True full quality
   exists only as the artist's own free-download file (original
   WAV/AIFF behind a session-gated link) or a purchase. That is WHY the
   design is **link-first**: when the track offers a real
   download/purchase link, surface it to the user and skip the rip;
   rip 160k AAC only when no link exists.
3. Planned surface (no new verbs — census-safe): `megadj sync` grows
   SC sources (`--source sc-likes`, `--source sc-user:NAME`,
   `--sc-url <track-or-set-url>`); `megadj drop` grows link-first +
   set expansion for SC URLs. Everything lands in the existing
   `tracks` ledger and the existing drop pipeline.

---

## 1. Audit — what exists today (verified Sep 19, 2026)

| Surface | State | Evidence |
| --- | --- | --- |
| `megadj sync` (YT Music) | ✅ shipped; LM/LL/PL sources only | `src/getdat/commands/sync.ts` — `PlaylistSource` list has no SC entries; `Downloader.probe/download` hardcode `https://music.youtube.com/watch?v=` (`src/getdat/downloader.ts`) |
| SC as metadata source | ✅ shipped (votes, never downloads) | `src/fulltags/sources/sc-search.ts` — `scsearch4:` `COL|` line (title/url/uploader/thumbs/genre-id/timestamp), hard artist gate |
| `megadj drop <url>` | 🟡 works for a single SC track by accident | `src/shared/drop.ts` `downloadUrl()` — `-f bestaudio/best --no-playlist`: no set expansion, no bitrate/format policy, no link check, output flat into the music dir; ledger row arrives later via ingest (file-level, not source-level) |
| State ledger | ✅ ready for a second source | `tracks` PK is TEXT (`video_id`); SC numeric track ids can't collide with 11-char YT ids; `source` column exists (`state_core.ts`) |
| Quality floor | ⚠️ SC rips are LOWQ by current policy | `isLowq` (`src/getdat/commands/upgrade.ts`): <250 kbps aac / <320 mp3 flags LOWQ — a 160k SC rip flags. Needs a source-aware floor (SC's ceiling IS 160) |
| Permalink 404 classification | ⚠️ misclassified | live probe: a dead SC slug returns `HTTP Error 404` → `classifyError` calls it `other` → retried forever instead of permanent-gone |
| Impersonation dependency | ⚠️ missing | live probe: `soundcloud:user` pages warn "no impersonate target is available" (curl_cffi absent from the yt-dlp env); single tracks, sets-by-URL, and `scsearch` work without it |
| GitHub | #109 (K57) closed deliberately-unbuilt Sep 16 | FEATURES.md "Sources coming": "re-file from a PRD if it earns a slot" |

## 2. Platform facts (live-measured, the honest constraints)

- **Format ladder (non-Go+):** HLS only — `hls_mp3_0_1` (128k mp3),
  `hls_aac_96k` (96k m4a), `hls_aac_160k` (160k m4a). Best rip =
  `hls_aac_160k`. The old progressive 320k mp3 / download_url tiers
  are gone or auth+DRM gated.
- **Go+ / DRM tracks:** stream URLs are protected; yt-dlp fails
  permanently. Must classify permanent-gone (like the existing GONE
  table), never retried.
- **`purchase_url`:** parsed by yt-dlp but `None` on current
  big-label tracks (checked Shelter, Sep 19). **Track descriptions
  are the reliable link surface** — smart-links (Spotify / Apple /
  store) are in `description`; that is what link-first parses.
- **Free downloads:** when an artist enables a free download, the file
  (original quality) is session-gated in the web UI — surfaced as a
  link for the user, never machine-ripped (that gate is also the
  polite boundary).
- **Sets:** a `/sets/<slug>` URL expands as a playlist; artist pages
  (`/tracks`, `/likes`, `/sets`) go through the `soundcloud:user`
  extractor and **need impersonation (curl_cffi) + cookies for
  likes**.
- **Privacy/ToS stance (from #109):** personal-use pacing only, the
  existing RateLimiter, no aggressive scraping, no new dependency —
  yt-dlp is already the engine.

## 3. Design

### 3.1 Link-first resolution (the "go through it instead" behavior)

For every SC track (single URL or expanded from a set/likes page),
before any download:

1. `-J` probe → extract candidate links:
   `purchase_url` (when present), free-download availability,
   and description URLs (smart-link services + direct store links).
2. **If a real acquisition link exists** (purchase URL or free
   download): record it on the row, set status `link_surfaced`, print
   the link for the user, and SKIP the rip. `--force-rip` overrides.
3. **Else rip** at `hls_aac_160k` (best available), landing through
   the normal download → tag → ledger path.
4. Surfaced links persist in the ledger (`tracks.source_links` JSON
   column, added by `addColumnIfMissing` like every migration) so
   `megadj list` / status can show "go get it" rows later.

Honesty rule (repo policy): a surfaced link is not a downloaded file —
it never counts as library size, and the run summary reports the two
cohorts separately.

### 3.2 Sources through the sync ledger

`PlaylistSource` becomes a tagged union; `fetchPlaylist` builds the
yt-dlp URL per kind:

- `ytm-playlist` — today's LM/LL/PL behavior, unchanged.
- `sc-track` / `sc-set` — direct permalinks (mine or anyone's public).
- `sc-likes` — `https://soundcloud.com/<me>/likes` (cookies +
  impersonation).
- `sc-user:NAME` — a public user's `/tracks` (public, no auth).

Ledger: SC rows keep the numeric SC track id as `video_id` (no
collision with YT ids) with `source = 'soundcloud'`. Cross-source
dedupe already works off the PK. `Downloader` learns to build the URL
from the source (one seam replaces the hardcoded music.youtube.com
strings) and picks `-f hls_aac_160k/bestaudio/bestaudio*` for SC.
`classifyMusic` (YT categories) applies to YT legs only — a
user-directed SC URL is trusted intake.

### 3.3 Playlist/set semantics

- `megadj drop <sc-set-url>` expands the set (drop's stage-0 download
  drops `--no-playlist` for SC set URLs) and feeds every entry through
  ingest as one batch (dated intake folder — existing rule).
- `megadj sync --sc-url <url>` accepts a single track OR a set and
  runs it through the ledgered, rate-limited, resumable path.
- Caps: `--limit` semantics unchanged (0 = nothing); per-entry
  failures quarantine-and-continue (per-file rule).

### 3.4 Quality reconciliation (the LOWQ ratchet stays honest)

- `formatBitrateKbps` learns SC format ids (`hls_aac_160k` → 160,
  `hls_aac_96k` → 96, `hls_mp3_0_1` → 128).
- `isLowq` grows a source-aware floor: `source='soundcloud'` → floor
  160 aac / 128 mp3 (the platform ceiling — can't do better, so
  flagging every SC rip LOWQ would make the flag noise). Rows whose
  SC rip undercuts the ceiling still flag.
- `megadj upgrade` skips `source='soundcloud'` rows (a YT re-fetch
  would swap in a different recording; the fingerprint-swap guard
  would refuse anyway — skip up front, honestly reported).

### 3.5 Failure classification

- SC permalink 404 (`[soundcloud] … HTTP Error 404` on a direct URL) →
  **gone** (permanent), matching the GONE table.
- Go+/DRM ("PROTECTED-CCS"-class failures) → permanent, never retried,
  covered by a test (the #109 acceptance item).
- 429/5xx/network → existing throttle backoff, unchanged.

### 3.6 Doctor

`megadj doctor` gains a check: impersonation support available for
yt-dlp (curl_cffi) — warn (not fail) with the fix, since only user/likes
pages degrade without it. Document the one-liner fix in the message.

## 4. Phases (each lands green: `bun run check && bun test`)

| Phase | Scope | Files | Acceptance |
| --- | --- | --- | --- |
| P1 — SC source plumbing | tagged `PlaylistSource`, URL-builder seam in Downloader, SC format selection, 404/gone classification, `sync --sc-url` single track | `sync.ts`, `downloader.ts`, `downloader.test.ts`, `sync.test.ts`, `command-registry.ts` help block | `sync --sc-url <track>` lands a 160k aac, ledgered `source='soundcloud'`, re-run is a no-op; gone-class test for DRM/404 |
| P2 — link-first | description/purchase link extraction, `link_surfaced` status + `source_links` column, skip-rip + `--force-rip`, `drop` stage-0 link-first for SC | `downloader.ts` (parse fn, pure + tested), `state_core.ts`, `sync.ts`, `drop.ts`, `list` rendering | link-bearing track → link surfaced, zero download, row recorded; `--force-rip` rips; parse tests over real description shapes |
| P3 — sets + user sources | set expansion (drop + sync), `sc-likes`, `sc-user:NAME`, doctor impersonation check | `sync.ts`, `drop.ts`, `doctor-checks.ts` | a public 5-track set intakes as one dated batch with per-file failures isolated; likes page works with cookies (live smoke) |
| P4 — quality + floors | SC bitrate map, source-aware LOWQ floor, upgrade skip | `upgrade.ts`, `downloader.ts` | SC 160k rip not LOWQ; 96k rip flags; upgrade skips SC with honest reporting |
| P5 — docs + census | help blocks, FEATURES "Sources coming" → shipped, surface-parity rev, this doc's status header → SHIPPED | docs + `command-registry.ts` same-commit rule | surface-names census green (no new verbs; only real flags taught) |

P1+P2 are the core value (single URL + link-first); P3 is scope the
user asked for explicitly (my sets / others' public sets); P4/P5 are
the honesty rails.

## 5. Proposed issue split (GitHub owns WHAT/priority/status)

1. **GetDat: SC download source plumbing** (`type:feature`,
   `priority:p1`, `effort:m`) — P1.
2. **GetDat: SC link-first acquisition** (`type:feature`,
   `priority:p1`, `effort:s`) — P2.
3. **GetDat: SC sets + likes/user sources + doctor impersonation**
   (`type:feature`, `priority:p2`, `effort:s`) — P3.
4. **GetDat: SC-aware LOWQ floor + upgrade skip** (`type:bug`-adjacent
   honesty fix, `priority:p2`, `effort:s`) — P4.
5. **GetDat: SC permanent-failure classes (DRM/404) test-pinned**
   (`type:chore`, `priority:p2`, `effort:s`) — folds into P1's tests or
   stands alone if split.

## 6. Non-goals / risks

- No 320 kbps promise: 160k AAC is the platform ceiling; the plan's
  quality answer is link-first (original files via purchase/free
  download), not a better ripper.
- No Go+ credential handling beyond existing cookie plumbing; DRM
  tracks fail permanently with an honest reason.
- No aggressive crawling: only user-directed URLs, likes, and named
  users; the RateLimiter stays. Personal use only.
- Impersonation is an external dependency (yt-dlp's curl_cffi extra);
  degradation is a warning + doctor hint, never a hard gate on the
  paths that work without it.
- yt-dlp extractor drift is the standing risk (SC API moves); the
  format map + COL/parser seams are pure and test-pinned so drift
  breaks loud, not silent.
