# Cratekeeper — Product Brief (superseded draft)

> **⚠ ARCHIVED / SUPERSEDED.** This is the earlier standalone "Cratekeeper"
> draft. The live, canonical brief is
> [`docs/cratedeck/01-product-brief.md`](../cratedeck/01-product-brief.md)
> and the shipped implementation is `cratedeck/` (see
> [acceptance.md](../cratedeck/acceptance.md)). Kept for history only — the
> `apps/cratekeeper/` location below never existed; the app landed in-repo.

**Status:** Draft v1.0 · **Status:** Draft v1.0 · 2026-09-03
**Type:** Local-first desktop utility (Bun + TypeScript, single-page HTML app)
**Location:** `apps/cratekeeper/` — self-contained sub-app within the existing monorepo
**Doc 1 of 4:** Product Brief → PRD → Architecture Plan → Build Plan

---

## 1. One-liner

**Cratekeeper is a local, offline-first control tower for a fleet of rekordbox DJ USB drives — it identifies every stick on sight, remembers everything on it even when it's unplugged, and tells you which one is actually safe to take to the gig.**

---

## 2. The problem

You own roughly eight USB drives. Some are rekordbox export drives, some are half-forgotten backups, some might be neither. Today, answering even trivial questions requires physically plugging drives in one at a time and squinting at Finder or rekordbox:

- **Identity is unsolved.** They're physically near-identical, unlabeled, and the volume names are inconsistent or default (`NO NAME`, `UNTITLED`, `SANDISK`). You cannot tell drive #3 from drive #7 without mounting it.
- **State is invisible when unplugged.** Rekordbox shows you a device only while it's connected, and shows you _one_ device at a time. There is no cross-device view, no history, and nothing at all when the drive is in a bag.
- **"Is it in sync?" has no answer.** Rekordbox has no honest diff between your master library and an exported device. You get a nagging feeling that a drive is three months stale and no way to confirm it in under twenty minutes.
- **Quality is assumed, not verified.** Beat grids, memory cues, hot cues, phrase analysis, colour waveforms and artwork are all silently optional. A track can export "successfully" with no grid and you find out on stage.
- **Corruption is silent.** Flash drives fail progressively and quietly. A truncated `export.pdb` or a handful of bad audio sectors surfaces as a CDJ that won't load the drive, mid-set, in front of people.
- **Health and speed are unknown.** Cheap or aging sticks load tracks slowly on the player. Some are counterfeit-capacity. You have no benchmark, no trend, no retirement signal.
- **History is thrown away.** Players write playback history back to the device. That's a record of every set you've played, and it currently rots on the stick until it's overwritten.
- **Physical logistics are untracked.** Which port is it in right now? Which drive did you lend out? Which one was the backup for the last gig?

The compounding cost is not "mild annoyance." It's **pre-gig anxiety and on-stage risk** — the two things a DJ pays money and attention to eliminate.

---

## 3. Why now

1. **The format is readable.** The rekordbox device export format (`export.pdb`, `exportExt.pdb`, `ANLZ*.DAT/.EXT/.2EX`) has been thoroughly reverse-engineered by the community (Deep Symmetry's crate-digger / Kaitai Struct specs, pyrekordbox). Everything needed for a rich read-only inventory is documented and stable.
2. **Bun makes this a weekend-scale runtime problem, not a platform problem.** Native TypeScript, built-in SQLite, built-in HTTP server, fast file I/O, single-binary compile. No Electron, no build chain, no framework tax.
3. **The fleet is already at painful scale.** Eight drives is past the threshold where human memory works and well before the threshold where anyone builds a tool for you.
4. **Nothing on the market does this.** Rekordbox is a library manager for one device at a time. Backup tools are file-level and format-blind. There is no "fleet inventory + health + readiness" layer for DJ media. (See §8.)

---

## 4. Target user

**Primary — "Fleet operator" (you).** Technical, owns 6–12 drives, exports from rekordbox regularly, plays out, treats reliability as non-negotiable, comfortable running a local server on their machine. Wants ground truth, not vibes.

**Secondary — "Working DJ with a drawer problem."** Less technical, but has the same drawer of unlabeled sticks. Needs the identify-and-name flow and the readiness score; will never read a `.pdb` spec.

**Tertiary — "The archivist."** Wants long-term provenance: what was on this drive in November, which tracks exist on only one drive in the world, what did I actually play last year.

**Non-users (explicitly):** Serato/Traktor/Engine DJ users at v1. Multi-user teams. Anyone wanting cloud sync.

---

## 5. Product principles

1. **Read-only until proven otherwise.** The default mode never writes to a drive, with a single deliberate exception (§6.1). Writes are opt-in, dry-run first, and _never_ inside `/PIONEER/`. Rekordbox owns that directory; we only read it.
2. **Offline truth is the product.** The interesting state is the state of the seven drives _not_ currently plugged in. Everything is snapshotted locally so the app is fully useful with zero drives connected.
3. **One page, no navigation.** A single HTML page that loads instantly and shows the whole fleet. Detail expands in place. No routing, no dashboard sprawl.
4. **Zero config, zero cloud, zero telemetry.** Runs on `localhost`, stores everything in a local SQLite file, phones home to nothing. The only outbound call is an explicit, user-triggered image search.
5. **Never guess silently.** Every derived number (health, readiness, sync %) is explainable — click it and see the inputs. Uncertain data is labeled uncertain, not rounded into confidence.
6. **Physical-world aware.** A drive is an object in a drawer, in a port, in a bag, lent to someone. The model reflects that, not just the filesystem.
7. **Fast enough to be habitual.** Plug in → recognized and scanned in seconds, not minutes. If it isn't faster than opening rekordbox, it won't get used.

---

## 6. The experience

### 6.1 First run — solving identity

You start the app and plug in an unknown drive. Cratekeeper:

1. Detects the mount and reads the **hardware identity triple**: USB vendor/product/serial, volume UUID, and filesystem label.
2. Looks for its own **hidden manifest** — a dotfile (`/.cratekeeper/id.json`, marked hidden) written once per drive containing a stable UUID, first-seen date, and the user's chosen name. This is the _one_ write the app performs on a drive, it lives outside `/PIONEER/`, and it is invisible to Finder, to rekordbox, and to CDJs.
3. If no manifest exists, it's a **new drive**. The app scans it, then opens the **Identify flow**:
   - Shows what it inferred: capacity, filesystem, controller, "SanDisk Extreme 64GB", whether it's a rekordbox export drive.
   - Fires an **image search** (Exa / Brave Image / configurable provider) for the detected make + model and presents a grid of candidate product photos.
   - You click the one that looks like the stick in your hand, type a name (`Gig A — Black SanDisk`), pick a colour tag, and confirm.
   - The image is **downloaded and cached locally** — never hotlinked — so the fleet view works offline forever.
4. From then on, plugging that drive in is instant recognition: photo, name, colour, and full history.

You repeat this eight times, once, and the drawer problem is permanently solved.

### 6.2 Steady state — the fleet view

The single page is a grid of all eight drives, plugged in or not. Each card shows:

- **The photo you picked** and the name you gave it, so it maps to a physical object in one glance.
- **Presence:** `● Connected — USB-C port 2 (left, rear) · 10 Gb/s` or `○ Offline — last seen 12 days ago`.
- **Fill:** 41.2 GB of 64 GB, with a breakdown bar (audio / analysis / artwork / non-rekordbox junk / free).
- **Contents at a glance:** 2,184 tracks · 37 playlists · 9 histories.
- **Three scores:** **Sync**, **Quality**, **Health** — each 0–100 with a colour and a one-line reason.
- **Readiness:** a single verdict — `GIG READY` / `NEEDS EXPORT` / `DO NOT USE`.

Offline cards are visually distinct but fully browsable — every number is the last-known value with an explicit "as of" timestamp.

### 6.3 Drill-down — the drive page

Expanding a card reveals everything rekordbox shows you, plus everything it doesn't:

- **Tracks** — full searchable, sortable table: title, artist, BPM, key, genre, rating, colour, bitrate, format, sample rate, length, date added, file size, path.
- **Playlists & folders** — the full tree exactly as the players will render it, with track counts and per-playlist quality stats.
- **Histories** — every session the players wrote back to this drive, as a timeline: date, track order, timestamps. Harvestable into a set list.
- **Analysis coverage** — per-track and rolled up: beat grid present? memory cues? hot cues? loops? phrase/song-structure analysis? colour waveform? 3-band waveform for newer players? artwork? A track with no grid is flagged loudly.
- **Integrity** — does `export.pdb` parse cleanly? Does every database row point at a file that exists? Does every file on disk appear in the database (orphans)? Do checksums match the last scan (silent bit-rot detection)?
- **Compatibility** — filesystem vs. target player, codec support, filename/path length, non-ASCII characters, folder depth — a linter for "will this actually load on the gear at the venue."
- **Health & performance** — measured sequential read/write, random 4K, benchmark trend over time, capacity-fraud verification, age, scan count, error history.
- **Physical & lifecycle** — purchase date, cost, current location (drawer / bag / lent to whom), port history, notes.

### 6.4 The fleet superpowers

These only exist because the app sees all eight drives at once:

- **Coverage matrix.** A track-by-drive grid. Instantly answers: _which drive has this track?_ and _which tracks exist on exactly one drive?_ (i.e., one drive failure from gone forever).
- **Redundancy audit.** "Every track in playlist `Gig 2026` is on ≥2 drives" — pass or fail, with the gaps listed.
- **Fleet diff.** Compare any two drives, or a drive against your rekordbox master library, and get a clean added/removed/changed list.
- **Global search.** One box, all drives, plugged in or not: "do I own this track anywhere, and on which sticks?"
- **Snapshots & timeline.** Every scan is a versioned snapshot. "What changed on this drive between the Nov 14 gig and now?" is a two-click answer.
- **Set intelligence.** Harvested histories across the fleet → most-played tracks, never-played tracks, BPM/key arcs of past sets, exportable as CSV/markdown.
- **Preflight check.** Before a gig: pick the drives you're taking, get a single pass/fail checklist covering sync, grids, integrity, health, and free space.

---

## 7. Feature pillars

| #   | Pillar                                                                                        | Why it matters                                               | v1?  |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---- |
| 1   | **Identity & naming** — hardware triple + hidden manifest + product photo + human name        | Solves the core "which stick is this" problem                | ✅   |
| 2   | **Offline memory** — persisted last-known state for every drive                               | The whole point; rekordbox can't do this at all              | ✅   |
| 3   | **Deep content inventory** — tracks, playlists, folders, histories, artwork from `export.pdb` | Parity with rekordbox, without rekordbox                     | ✅   |
| 4   | **Analysis coverage** — beat grids, cues, loops, phrases, waveforms from `ANLZ` files         | Catches the failure that actually bites on stage             | ✅   |
| 5   | **Integrity & corruption** — pdb parse, dangling refs, orphans, checksum drift                | Silent failure → loud, early warning                         | ✅   |
| 6   | **Health & speed** — benchmarks, trend, capacity verification, retirement signal              | Flash dies; know before it does                              | ✅   |
| 7   | **Sync & diff** — vs. master library and vs. other drives                                     | Ends "is this one stale?" forever                            | ✅   |
| 8   | **Port & topology** — which physical port, which bus, negotiated speed                        | Diagnoses "why is this drive slow" (it's in a 480 Mb/s port) | ✅   |
| 9   | **Fleet analytics** — coverage matrix, redundancy, global search, snapshots                   | Emerges only at fleet scale; the moat                        | ✅   |
| 10  | **Lifecycle & physical** — location, loans, purchase, notes, QR labels                        | The drive is an object, not just a volume                    | v1.1 |
| 11  | **Set intelligence** — history harvesting, played/never-played, set reconstruction            | Turns exhaust data into a personal archive                   | v1.1 |
| 12  | **Safe mirroring** — dry-run, verified copy from drive A to drive B                           | Backup without trusting Finder drag-and-drop                 | v1.2 |

---

## 8. Competitive landscape

| Alternative                                               | What it does                                | Where it fails you                                                                                        |
| --------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **rekordbox itself**                                      | Exports to and browses one connected device | One device at a time; nothing when unplugged; no diff; no health; no fleet view; no history mining        |
| **Finder / Explorer**                                     | Shows files and capacity                    | Format-blind — can't read `export.pdb`, can't see a beat grid, can't tell a rekordbox drive from a backup |
| **Generic backup tools (rsync, Carbon Copy, ChronoSync)** | Copy bytes reliably                         | No domain awareness; will happily mirror a corrupt database                                               |
| **`smartctl` / disk utilities**                           | Low-level device health                     | Most USB flash exposes no SMART data at all; needs heuristic substitutes                                  |
| **Community libraries (crate-digger, pyrekordbox)**       | Parse the formats                           | Libraries, not products — no UI, no fleet model, no persistence, no health                                |
| **DJ library-manager utilities**                          | Tag cleanup, duplicate finding              | Library-side, not device-side; ignore the physical fleet entirely                                         |

**The gap:** everything is either _one device, live_ or _bytes, dumb_. Nobody occupies _many devices, remembered, with domain-aware verdicts_. That's the whole product.

---

## 9. Success metrics

**Primary — does it end the problem?**

- Time to answer "which drive has track X" drops from ~10 minutes of plugging to **<5 seconds**.
- **100% of the fleet named and photographed** after week one.
- **Zero unknown drives** in the drawer thereafter.

**Product health**

- Recognition-to-scanned time for a plugged-in 64 GB drive: **<15s warm, <90s cold**.
- Fleet page interactive: **<300ms** with 8 drives / ~20k tracks cached.
- Scans run **weekly or better** without prompting (auto-scan on mount).

**Outcome**

- Number of gigs where a drive problem is discovered _at the venue_: **0**.
- At least one **real catch** in the first month — a stale drive, a missing grid, a dying stick — that would otherwise have surfaced live. This is the moment the tool proves itself.

---

## 10. Risks & mitigations

| Risk                                                    | Severity | Mitigation                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Writing to a drive corrupts a rekordbox export**      | Critical | Read-only by default. Never write inside `/PIONEER/` or `/CONTENTS/`, ever. The single hidden manifest write is atomic, tiny, and outside both. All future write features are dry-run-first with explicit confirmation.                      |
| **`export.pdb` format drifts with a rekordbox update**  | High     | Parser is defensive and versioned; unknown page types are skipped, not fatal. A parse failure degrades to filesystem-level inventory rather than crashing. Format assumptions are isolated in one module.                                    |
| **exFAT / player compatibility claims are wrong**       | Medium   | Ship a **compatibility matrix as data, not code** — FAT32 and HFS+ are the known-safe baseline; exFAT support varies by player and firmware. The app states its source and lets you correct it rather than asserting confidently.            |
| **No SMART data on USB flash**                          | Medium   | Health is explicitly a _heuristic composite_ (measured throughput trend, error counts, filesystem check results, checksum drift, age, write-verify). Labeled as an estimate, with inputs visible. Never presented as manufacturer telemetry. |
| **Benchmarks add wear / take too long**                 | Low      | Benchmarks are bounded, sampled, opt-in on a schedule (not every mount), and default to read-biased. Full write-verify (capacity fraud check) is a manual, clearly-warned action.                                                            |
| **Image search API cost / ToS / link rot**              | Low      | Use a proper search API (Exa / Brave), never scrape retail sites directly. Images are cached locally for personal identification only. Provider is a swappable adapter; the app is fully functional with image search disabled.              |
| **Scope explosion — this becomes a DJ library manager** | Medium   | Hard non-goal (§11). Cratekeeper describes and verifies; rekordbox creates and edits.                                                                                                                                                        |
| **Reading a rekordbox master library**                  | Medium   | v1 uses the **user-generated `rekordbox.xml` export** as the master-library source of truth — documented, stable, and explicitly user-initiated. No dependence on the encrypted internal database.                                           |

---

## 11. Goals and non-goals

**Goals**

- Know every drive on sight, forever, including unplugged.
- Answer any "what's on which drive, and is it good" question in seconds.
- Surface silent failures — stale exports, missing grids, corruption, dying flash — before a gig, not during one.
- Be a genuinely nice single page you actually want to open.

**Non-goals (v1)**

- ❌ Editing tags, cues, grids, or playlists. Rekordbox owns creation.
- ❌ Writing a rekordbox export. Rekordbox owns export.
- ❌ Audio playback or waveform scrubbing.
- ❌ Cloud sync, accounts, multi-user, sharing.
- ❌ Serato / Traktor / Engine DJ formats.
- ❌ Mobile app. Desktop browser on localhost only.
- ❌ Music discovery, purchasing, or streaming integration.

---

## 12. Scope by release

**v0.1 — Skateboard (proves the hard part)**
Detect mounted volumes → identify rekordbox drives → parse `export.pdb` → list tracks and playlists → persist to local SQLite → render one static HTML page. No images, no health, no diff.

**v1.0 — The product**
Pillars 1–9. Hidden manifest identity, image picker and naming, offline fleet view, full inventory, analysis coverage, integrity checks, health and benchmarks, sync diff vs. `rekordbox.xml`, port/topology detection, coverage matrix, global search, snapshots, preflight check.

**v1.1 — Lifecycle & memory**
Physical location and loan tracking, QR labels, purchase/cost records, history harvesting and set intelligence, exportable reports.

**v1.2 — Careful writes**
Verified drive-to-drive mirroring with dry-run and post-copy checksum verification. Retirement workflow.

**vNext — candidates, unranked**
Menu-bar companion with plug-in notifications · CLI (`bun run scan`) for scripting · watch-folder auto-scan · anomaly alerts ("this drive's read speed dropped 40%") · gig calendar linking drives to events · multi-machine catalog merge · Engine DJ read support.

---

## 13. Open questions

1. **Auto-scan aggressiveness** — full scan on every mount, or quick fingerprint on mount with full scan on a schedule? (Leaning: quick on mount, full weekly or on demand.)
2. **Master library source** — is a manually refreshed `rekordbox.xml` acceptable friction, or does the sync feature need a prompt/reminder to re-export?
3. **How many drives are actually rekordbox drives?** Unknown until first scan. The app must handle "this is just a photo backup stick" gracefully as a first-class case, not an error.
4. **Health score weighting** — needs real measurements from your actual eight drives before the composite formula is anything but a guess. Ship it visible and tunable.
5. **Single binary?** `bun build --compile` to a double-clickable app, or `bun run` from the repo? (Leaning: repo script for v1, compile later.)
6. **Where does the local database live** — inside `apps/cratekeeper/data/` (repo-adjacent, gitignored) or in `~/Library/Application Support/`? Affects backup and portability.

---

## 14. The one-sentence bet

_If you can see all eight drives at once — named, photographed, verified, and remembered even in a drawer — then the entire category of "USB problem discovered at the venue" stops existing._
