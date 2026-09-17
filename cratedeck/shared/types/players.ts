// shared/types/players.ts — the player-compat + preflight + booth +
// notes wire domain (#196): N75/N78 compat verdicts, the B12 preflight
// report, the booth fleet settings envelope, and the O88 agent-note row.
// Split out of the 846-line types.ts monolith.
import type { Drive, HealthCheck, NoteSeverity, PreflightVerdict } from "./drive";

// ---- preflight (B12): the wire shapes are DEFINED here; src/preflight.ts
// (the pure engine that produces them) imports them back. One source of
// truth for web/deckctl/MCP without re-exporting the producer's module.
export interface PreflightDriveResult {
  drive: Drive;
  overall: PreflightVerdict;
  checks: HealthCheck[];
  /** show-stoppers — the reason a drive is not-ready, for the top line */
  blockers: string[];
}

export interface PreflightReport {
  generated_at: number;
  drives: PreflightDriveResult[];
  mountedCount: number;
  overall: PreflightVerdict;
  /** one line a human reads before leaving for the gig */
  summary: string;
  /** N76: known firmware advisories from the player matrix (informational). */
  firmware_advisories: string[];
}

// ---- player compatibility (N75/N78): wire shape of GET /drives/:id/players.
// DriveCompat + PlayerSpec (the measured dual-DB verdicts) are DEFINED here;
// src/players.ts imports them back. The server spreads DriveCompat under
// {drive, measured}; PlayersPayload mirrors that envelope once so deckctl +
// the web PreflightTab don't each hand-declare it.

/** One row in the Pioneer player matrix. Notes carry known firmware
 *  advisories (N76) and render as preflight hints. */
export interface PlayerSpec {
  /** Display name, e.g. "XDJ-XZ". */
  name: string;
  /** Which library DB the player reads. */
  reads: "device" | "onelibrary";
  /** Pioneer's firmware-pull era note, rendered as a preflight hint. */
  note?: string;
}

export interface DriveCompat {
  /** Players that can read this drive as-is. */
  ok: PlayerSpec[];
  /** Players this drive is INVISIBLE to, with the measured reason. */
  blocked: { player: PlayerSpec; reason: string }[];
  /** true when the drive has no DB data at all (never full-scanned). */
  unknown: boolean;
}

export type PlayersPayload = {
  drive: { id: string; name: string; nickname: string | null };
  measured: { pdb_live_rows: number | null; onelibrary_rows: number | null };
} & DriveCompat;

// ---- booth fleet settings: which players the compat gates enforce.
// FLEET_PROFILES (fulltags/src/fleet.ts) is the SSOT for the profile
// rows + citations; this is the wire envelope for GET/POST /api/booth/fleet.
export interface BoothCitation {
  claim: string;
  publisher: string;
  url: string;
  section: string;
}

export interface BoothPlayerProfile {
  id: string;
  name: string;
  defaultOn: boolean;
  unicodeText: boolean;
  emoji: boolean;
  maxSampleRate: number;
  maxBitDepth: number;
  flac: boolean;
  citations: BoothCitation[];
}

export interface BoothFleetPayload {
  /** Currently selected ids (order-insensitive). */
  selected: string[];
  /** Full catalog with citations (settings UI renders this). */
  profiles: BoothPlayerProfile[];
  /** The audio floor the CURRENT selection produces (per player-compat). */
  floor: {
    flac: boolean;
    maxSampleRate: number;
    maxBitDepth: number;
    unicodeText: boolean;
  };
}

// ---- notes (O88): the feed's row type lives here; src/notes.ts (the
// producer) imports it back so deckctl and any other consumer read the
// same shape without a module cycle.
export interface StoredNote {
  id: string;
  drive_id: string;
  note: string;
  origin: string;
  severity: NoteSeverity;
  at: number;
  /** Set when dismissed; dismissed notes leave the active feed. */
  dismissed_at: number | null;
}
