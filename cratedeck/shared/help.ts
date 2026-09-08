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
    def: "The drive you treat as the source of truth — new music lands here first.",
    why: "Every other copy (the mirror) is measured against it; parity checks compare a mirror to its master.",
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
    where: "topbar Fleet button → Coverage tab",
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
    "Master: the source of truth. New music lands here; mirrors are measured against it.",
  mirror:
    "Mirror: a deliberate second copy of the master. Parity checks keep it interchangeable.",
  library:
    "Library: a real drive with its own music — not part of a master/mirror pair.",
  unknown:
    "Role unknown: the volume name didn't match your configured master/mirror names (config.toml).",
};
