// help.ts — the in-app help content SSOT (term glossary, job explainers,
// surface tour). Imported by the web UI (tooltips, tab explainers, the
// Welcome-screen glossary) and by the server (`GET /api/help`), so deckctl
// and MCP can serve the same wording without re-typing it.
//
// One file, zero behavior: pure data + tiny lookup helpers. Every string is
// a DJ-facing sentence, not doc-speak — the rule of thumb a person repeats
// in the booth.

/** One glossary term: what it IS, and why a DJ should care. */
export interface HelpTerm {
  /** Display name ("Beatgrid"). */
  term: string;
  /** One-sentence plain-English definition. */
  def: string;
  /** Why it matters on gig night (the "so what"). */
  why: string;
}

/** One job (scan/verify/…) explainer: identity + what actually happens. */
export interface HelpJob {
  kind: string;
  label: string;
  icon: string;
  /** What the job does, mechanically, one sentence. */
  what: string;
  /** When/why you'd click it. */
  when: string;
  /** Safety sentence (read-only? writes? interlock?). */
  safety: string;
  /** Rough wall-clock on a ~3.5k-track drive. */
  duration: string;
}

/** One UI surface (tab/page), for the Welcome tour + per-surface hints. */
export interface HelpSurface {
  /** Deep link (hash route) — the tour row links straight there. */
  route: string;
  label: string;
  where: string;
  /** What the surface answers, phrased as the question a DJ asks. */
  question: string;
}

export const HELP_TERMS: HelpTerm[] = [
  {
    term: "Master",
    def: "The gig stick you treat as the working source of truth — new music lands here first.",
    why: "Every other copy (the mirror) is measured against it; parity checks compare a mirror to its master.",
  },
  {
    term: "Shelf",
    def: "The archive-grade master master: a big always-at-home HDD every gig stick syncs FROM.",
    why: "It never leaves the shelf and never takes booth wear — sticks are disposable players, the shelf is the library itself.",
  },
  {
    term: "Mirror",
    def: "A byte-for-byte second copy of the master, kept identical on purpose.",
    why: "If one stick dies or gets lost the night before a gig, the other is indistinguishable in the booth.",
  },
  {
    term: "Ghost",
    def: "A drive CrateDeck has seen before but isn't plugged in right now.",
    why: "Its last snapshot stays browsable (playlists, health, timeline) — everything just reads 'last seen'.",
  },
  {
    term: "Snapshot",
    def: "A point-in-time reading of a drive: files, sizes, rekordbox DB rows, playlists.",
    why: "Health verdicts and fleet queries run against the latest snapshot; scans make new ones.",
  },
  {
    term: "Interlock",
    def: "The safety rule that refuses all drive jobs while rekordbox is running.",
    why: "rekordbox holds the same database files a job would read or copy — racing it corrupts libraries.",
  },
  {
    term: "Dual-DB (Device Library vs OneLibrary)",
    def: "Drives carry TWO rekordbox libraries: legacy export.pdb (what CDJs/XDJs read) and OneLibrary exportLibrary.db (what rekordbox itself reads).",
    why: "If they drift, your laptop sees tracks the booth doesn't. The hardware gate is exactly this comparison.",
  },
  {
    term: "Beatgrid (ANLZ)",
    def: "The per-track timing map rekordbox writes to .ANLZ files — it IS the waveform, beat grid and BPM on hardware.",
    why: "No ANLZ at the hashed path = no waveform, no Beat Sync, no Beat Jump on the CDJ.",
  },
  {
    term: "Bitrot",
    def: "Silent file corruption: bytes decay on disk with no error, no crash, no warning.",
    why: "Checksum jobs hash every audio file so a changed file is caught before it fails mid-set, not after.",
  },
  {
    term: "Preflight",
    def: "The gig-night gate: worst-status-wins pass/fail across every mounted drive.",
    why: "One glance answers 'can I walk out the door' — unknowns never fake a ready.",
  },
  {
    term: "Redundancy",
    def: "How many drives carry each track — the fleet answer to 'what dies with a drive?'",
    why: "Tracks on a single stick are one failure from gone; the at-risk list is your copy backlog.",
  },
  {
    term: "Dossier",
    def: "The one-file JSON export of a drive's full status: report, checks, playlists, benchmarks.",
    why: "It's the artifact for notes, tickets, or handing an agent the full picture in one payload.",
  },
  {
    term: "LOWQ",
    def: "The archive's low-quality queue — downloads flagged for re-fetch or replacement.",
    why: "Working the queue is how tracks graduate from 'downloaded' to 'gig-safe'.",
  },
  {
    term: "megadj",
    def: "The whole toolkit this dashboard belongs to: CrateDeck (drives + fleet), GetDat (download + ingest) and FullTags (enrichment) — one suite, three products.",
    why: "The suite name sits in the header; the products live in the nav strip under it, each with its own tabs.",
  },
  {
    term: "GetDat",
    def: "The download + ingest half of megadj: YouTube Music → the local archive (sync, ingest, retry, sources).",
    why: "The archive is where every track graduates from download to tag/analysis to the DJ drives — GetDat owns the first step.",
  },
  {
    term: "FullTags",
    def: "The enrichment engine: tags, art, keys, BPM/beatgrids, mood, structure cues — one schema, one writer.",
    why: "Analysis lands in DB ledgers (beats/mood/cues) until write-gates pass; file stamps carry the passed fields.",
  },
  {
    term: "Beats ledger",
    def: "The archive DB's per-track analysis rows: raw + folded BPM, the full beat array, downbeats (from `megadj beats`).",
    why: "It's the independent second opinion on tempo — the grid cross-check compares it to rekordbox's BPM × duration.",
  },
  {
    term: "Phrase cue",
    def: "A structure marker every 8 bars, derived from a track's downbeats — the natural mix in/out points.",
    why: "Phrase cues are how you mix on phrase, not just on beat; they're DB-side until rekordbox cue writes ship.",
  },
  {
    term: "Write gate",
    def: "A measured pass/fail a batch tag write must clear before the engine touches files (key passed; BPM and genre are blocked).",
    why: "Bad mass-writes corrupt a whole library at once — the gate is the reason analysis lives in ledgers first.",
  },
  {
    term: "Skip census",
    def: "The why behind non-downloaded archive rows: gone tracks record the YouTube failure, skipped rows record the ingest decision ('category: …').",
    why: "It separates real backlog (gone — re-source it) from deliberate decisions (skipped a podcast) so the backlog never lies.",
  },
  {
    term: "Analysis coverage",
    def: "One progress picture: playable tracks vs rows in the beats/mood/cues ledgers.",
    why: "Three separate meters can silently disagree — the strip on every FullTags tab reads one endpoint so they can't.",
  },
];

export const HELP_JOBS: HelpJob[] = [
  {
    kind: "scan",
    label: "Scan",
    icon: "scan",
    what: "Reads the rekordbox library on the drive — tracks, playlists, health stats, free space — and stores a snapshot.",
    when: "After adding music via rekordbox, or any time you want fresh numbers. Safe to run any time.",
    safety:
      "Read-only. Allowed while the drive is mounted; no interlock needed.",
    duration: "seconds to ~1 minute",
  },
  {
    kind: "verify",
    label: "Verify",
    icon: "shield",
    what: "Deep integrity audit: dual-DB agreement, every audio file present, ANLZ at hashed paths, grid sanity, playlist integrity, master↔mirror parity.",
    when: "Before a gig, after any rekordbox export, or when a health check turns red.",
    safety:
      "Read-only, but requires rekordbox to be closed (it locks the same databases).",
    duration: "1–3 minutes",
  },
  {
    kind: "mirror",
    label: "Mirror",
    icon: "copy",
    what: "Copies the master's new music onto this mirror drive — one-way, never writes the master.",
    when: "After adding music to the master, or when redundancy reports tracks on one drive only.",
    safety: "Writes the mirror only. Interlocked like every drive job.",
    duration: "depends on new music; minutes",
  },
  {
    kind: "benchmark",
    label: "Benchmark",
    icon: "pulse",
    what: "Measures real sequential + random-4k read speed by writing a temp file, reading it back, deleting it.",
    when: "Before buying-in a new stick, or if playback stuttered — the chart watches for drops over time.",
    safety:
      "Writes a scratch file into free space, then removes it. Interlocked.",
    duration: "~30 seconds",
  },
  {
    kind: "speedtest",
    label: "Speed probe",
    icon: "zap",
    what: "Reads ~10MB from the drive's biggest file and reports MB/s — a minimal check that flags a USB 2.0 vs 3.0 link without any writes.",
    when: "Whenever the USB link flag shows USB 2.0, to confirm real throughput; cheap enough to run on demand.",
    safety: "Read-only (a few MB). No interlock needed.",
    duration: "under a second",
  },
  {
    kind: "checksum",
    label: "Checksum",
    icon: "hash",
    what: "Hashes every audio file (blake2b) into the corruption ledger so future runs detect silent bitrot.",
    when: "Once to seed the ledger, then periodically — the first run is slow, later runs are incremental.",
    safety: "Read-only. Interlocked.",
    duration: "slow once (~10+ min for 3.5k files), fast after",
  },
];

/** The fleet pages, for the Welcome tour. Order = reading order. */
export const HELP_SURFACES: HelpSurface[] = [
  {
    route: "#/fleet/coverage",
    label: "Fleet · Coverage",
    where: "CrateDeck → Fleet → Coverage",
    question: "Which stick has this track — and what exists on only one?",
  },
  {
    route: "#/fleet/redundancy",
    label: "Fleet · Redundancy",
    where: "Fleet → Redundancy",
    question: "Is every playlist safe against one drive dying?",
  },
  {
    route: "#/fleet/diff",
    label: "Fleet · Diff",
    where: "Fleet → Diff",
    question: "What's different between two drives, track by track?",
  },
  {
    route: "#/fleet/preflight",
    label: "Fleet · Preflight",
    where: "Fleet → Preflight",
    question: "Is every drive ready to play right now — gig-night gate?",
  },
  {
    route: "#/fleet/booth",
    label: "Fleet · Booth",
    where: "Fleet → Booth",
    question:
      "Which players do the compat checks enforce — pick the fleet, see the citations?",
  },
  {
    route: "#/fleet/archive",
    label: "Fleet · Archive",
    where: "Fleet → Archive",
    question: "What did the archive ingest, and what's flagged low-quality?",
  },
  {
    route: "#/fleet/prep",
    label: "Fleet · Prep",
    where: "Fleet → Prep",
    question: "One-page weekly brief of everything worth knowing?",
  },
  {
    route: "#/getdat/pipeline",
    label: "GetDat · Pipeline",
    where: "GetDat (top nav) → Pipeline",
    question:
      "Is the download machine healthy — what's playable vs stuck, and why?",
  },
  {
    route: "#/getdat/backlog",
    label: "GetDat · Backlog",
    where: "GetDat → Backlog",
    question: "What downloads need a retry, and what's below the quality bar?",
  },
  {
    route: "#/getdat/sources",
    label: "GetDat · Sources",
    where: "GetDat → Sources",
    question:
      "Which source tags exist, and did two of them drift apart? (click a chip to diff)",
  },
  {
    route: "#/getdat/library",
    label: "GetDat · Library",
    where: "GetDat → Library",
    question: "What's in the archive — genres, years, artwork, search?",
  },
  {
    route: "#/getdat/intake",
    label: "GetDat · Intake",
    where: "GetDat → Intake",
    question:
      "Turn a dump folder into archive-ready tracks — tags, art, dedupe, audit, live?",
  },
  {
    route: "#/fulltags/beatgrids",
    label: "FullTags · Beatgrids",
    where: "FullTags (top nav) → Beatgrids",
    question: "Do the independent beatgrids agree with rekordbox's BPM?",
  },
  {
    route: "#/fulltags/mood",
    label: "FullTags · Mood",
    where: "FullTags → Mood",
    question:
      "What does the archive sound like — the vibe map and its extremes?",
  },
  {
    route: "#/fulltags/cues",
    label: "FullTags · Cues",
    where: "FullTags → Cues",
    question: "Where are the 8-bar phrase boundaries for mixing in and out?",
  },
];

// ---- lookup helpers (the only code in here) -------------------------------

/** Case-insensitive glossary lookup; "dual-db", "Dual-DB" all hit. Used by
 *  any consumer that resolves a term name to its help entry. */
export function helpTerm(name: string): HelpTerm | undefined {
  const lower = name.toLowerCase();
  return (
    HELP_TERMS.find((x) => x.term.toLowerCase() === lower) ??
    HELP_TERMS.find((x) => x.term.toLowerCase().startsWith(lower))
  );
}

// ---- hover copy for aggregate verdicts + roles (DrivePage / DriveRail) ----

/** What each overall verdict promises (drive page pill + rail ring). */
export const VERDICT_HELP: Record<string, string> = {
  healthy:
    "Every measured check passed — this drive is as ready as the data can prove.",
  attention:
    "Usable, but something needs a look (stale verify, low space, thin grids). Nothing here says 'don't play it' — yet.",
  critical:
    "At least one check FAILED. Read the red rows in Overview before trusting this drive with a set.",
  unknown:
    "Not enough data to say anything. Run a Scan (and then Verify) to get a real verdict — unknown never fakes healthy.",
};

/** What each drive role means (drive page chip + rail cards). */
export const ROLE_HELP: Record<string, string> = {
  master:
    "Master: the gig stick that new music lands on; mirrors are measured against it.",
  mirror:
    "Mirror: a deliberate second copy of the master. Parity checks keep it interchangeable.",
  shelf:
    "Shelf: the archive-grade master master (big HDD). Gig sticks sync FROM it — it never leaves the shelf.",
  library:
    "Library: a real drive with its own music — not part of a master/mirror pair.",
  unknown:
    "Role unknown: the volume name didn't match your configured master/mirror/shelf names (config.toml).",
};
