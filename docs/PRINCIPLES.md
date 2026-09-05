# megadj — Product Principles

The rules we build by. When a decision is unclear, these win.

---

## 1. One user, one machine — 1:1, always

Everything is **CLI-first** (`megadj`, `deckctl`) and **agent-first** (MCP-friendly,
`--json` on every command). There is no account, no server, no team plan. If a
feature can't be expressed as a command an operator or an AI agent can run, it
doesn't exist. Anything not yet 1:1 must become a **TODO or a GitHub issue** —
never silent drift between "the tool" and "the interface".

## 2. Mac only. Pioneer only. Sorry — nothing else, ever, at all.

megadj targets **macOS** and **Pioneer DJ (rekordbox / CDJ / XDJ)** hardware.
No Windows builds, no Denon Engine, no Serato, no web app. This is not
close-mindedness, it's focus: we can **hack Pioneer and hack macOS to our
desires** — reverse the ANLZ format, inject into device DBs, script the USB
topology — _because_ we only ever stand on those two bases. Every portability
abstraction is a tax on the one thing that matters.

## 3. Super easy

One command should do one obvious, complete thing. `bun run deck` starts the
dashboard. `megadj ingest <folder>` takes a messy folder of downloads and
returns tagged, deduped, artworked files. If a flow needs a wiki to explain,
the flow is wrong.

## 4. We never give up. There is always a way.

"We get it done, and try harder" is an engineering stance, not a slogan. When
rekordbox won't read WAV artwork, we convert to AIFF _and_ write the DB
pointers ourselves. When players ignore `analysisDataFilePath`, we compute the
hash and place ANLZ files where hardware actually looks. Dead end is not a
status; it's a prompt to dig one layer deeper.

## 5. Latest technologies only

Bun, TypeScript, the newest yt-dlp, current ONNX/ML runtimes, current Pioneer
firmware reality. No legacy shims, no "support back to X", no polyfills for
platforms we don't support anyway. New tooling is adopted when it's genuinely
better, not for fashion — but when it is better, we move immediately.

## 6. Not pros — but pro results. Time efficiency always.

We're hobbyists with professional standards and finite evenings. Every build
decision is judged by **minutes saved per gig** and **hands-off automation**.
Constant-BPM grids are fine until they're not; AI cover art is fine when every
real source is exhausted. The bar is: does it _sound_ and _look_ pro on the
booth, and did it cost us zero manual labour?

## 7. Electronic music is the design target

**EDM / house / techno / trance / dubstep / bass** — beatgrids, keys, camelot
mixing, phrase structure, drop-aware cues, energy levels. All models are picked
and tuned for electronic music. The toolkit absolutely _can_ prep a wedding or
any other gig (and does) — but it's a happy side effect, never the design
centre.

## 8. AI turns unstructured into structured — let it do the labour

We believe AI is _very_ good at exactly the grunt work DJs hate:

- **Duplicate review** → match on audio fingerprints and sound analysis, not
  just ID3 tags or filenames.
- **Web research** → find the real release year of the _remix_ (not the 20-year-old
  original), pull artwork from the source it came from, resolve credits.
- **Gap filling** → cheap LLM calls (confidence-gated) fill any field left
  empty after deterministic sources are exhausted.

No human should ever eyeball a duplicate list. If a task is tedious and
pattern-shaped, the answer is more automation, not better documentation of the
manual process.

## 9. Zero commercial intent — so we can push the limits

This is a hobby project: no monetization, no users to babysit, no SLA, no
support burden. That's a superpower. We can reverse-engineer formats, call
unofficial APIs, ship rough edges, and delete features overnight — because the
only goal is: **get the job done. Make people dance.**

## 10. Every product needs a name, a vibe, and a goal

megadj's sub-projects are named, opinionated units — **GetDat**, **FullTags**,
**CrateDeck** — each with its own one-line goal and personality (see
[FEATURES.md](FEATURES.md)). A name forces scope: if a feature doesn't fit an
existing project's goal, it either starts a new named project or it doesn't
belong.

## 11. Ship high-quality code. Move fast and break things.

Type-safe, tested, documented _and_ shipped today — in that order of
magnitude. We'd rather delete a wrong abstraction next week than carry a
perfect guessed one for a year. Breaking changes are fine; silent breakage is
not. Every sync/verify tool is idempotent and resumable so "breaking things"
never means "losing the library".
