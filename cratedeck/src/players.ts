// players.ts — N75: the hardware compatibility matrix as DATA, not code.
//
// AlphaTheta's official split (alphatheta.com/en/information/important-
// notice-for-customers-using-usb-devices-with-our-dj-equipment/):
//   Device Library (export.pdb)  — XDJ-XZ, CDJ-3000 gen, RX3, RR, XDJ-1000MK2,
//                                  XDJ-700, NXS2 generation
//   OneLibrary only              — XDJ-AZ, OPUS-QUAD, OMNIS-DUO, CDJ-3000X
// rekordbox 7.2.11+ writes BOTH on export, which is why a drive's measured
// dual-DB state answers "which players can read this stick".
//
// The table is user-editable (config.toml [players] / players.toml extra
// entries); these defaults ship in code because they come from the vendor's
// own notice and only change when AlphaTheta says so.
import type { SnapshotData } from "../shared/types";

export type LibraryFormat = "device" | "onelibrary";

export interface PlayerSpec {
  /** Display name, e.g. "XDJ-XZ". */
  name: string;
  /** Which library DB the player reads. */
  reads: LibraryFormat;
  /** Pioneer's firmware-pull era note, rendered as a preflight hint. */
  note?: string;
}

/** The official matrix (research note 2026-09-04, ideas.md N75). */
export const PLAYERS: PlayerSpec[] = [
  { name: "XDJ-XZ", reads: "device" },
  {
    name: "CDJ-3000",
    reads: "device",
    note: "v3.30 was pulled — playlists vanished on some units; stay on 3.22+ (rolled back)",
  },
  { name: "CDJ-3000X", reads: "onelibrary" },
  { name: "XDJ-AZ", reads: "onelibrary" },
  { name: "OPUS-QUAD", reads: "onelibrary" },
  { name: "OMNIS-DUO", reads: "onelibrary" },
  { name: "XDJ-RX3", reads: "device" },
  { name: "XDJ-RR", reads: "device" },
  { name: "XDJ-1000MK2", reads: "device" },
  { name: "XDJ-700", reads: "device" },
  { name: "CDJ-2000NXS2", reads: "device" },
  { name: "CDJ-2000NXS", reads: "device" },
];

/** Extra user-defined players (config.toml [players.players] name = "device"). */
export interface PlayerOverrides {
  /** name → reads */
  players?: Record<string, string>;
}

export interface DriveCompat {
  /** Players that can read this drive as-is. */
  ok: PlayerSpec[];
  /** Players this drive is INVISIBLE to, with the measured reason. */
  blocked: { player: PlayerSpec; reason: string }[];
  /** true when the drive has no DB data at all (never full-scanned). */
  unknown: boolean;
}

/** The fleet answer to "which players will this stick actually work on?"
 *  (N78). Derived from MEASURED state, not intent:
 *  - a device-library player needs export.pdb present AND current
 *    (pdb_live_rows > 0 and matching OneLibrary within tolerance — a stale
 *    pdb means the booth sees an old library, the N76 nightmare class);
 *  - a OneLibrary player needs onelibrary_rows > 0. */
export function driveCompatibility(
  snap: SnapshotData | null,
  extraPlayers: PlayerSpec[] = [],
): DriveCompat {
  const players = [...PLAYERS, ...extraPlayers];
  const pdb = snap?.pdb_live_rows ?? null;
  const ol = snap?.onelibrary_rows ?? null;

  if (pdb === null && ol === null) {
    return { ok: [], blocked: [], unknown: true };
  }

  const deviceOk = pdb !== null && pdb > 0;
  // staleness = dual-DB drift, so it only applies when OneLibrary actually
  // has content: a drive with 0 OneLibrary rows is a valid device-only
  // export (pre-7.2.11 style), not a "stale" one.
  const deviceCurrent =
    deviceOk && ol !== null && ol > 0
      ? Math.abs(pdb! - ol) <= Math.max(5, ol * 0.02)
      : deviceOk;
  const onelibraryOk = ol !== null && ol > 0;

  const ok: PlayerSpec[] = [];
  const blocked: DriveCompat["blocked"] = [];
  for (const p of players) {
    if (p.reads === "device") {
      if (deviceOk && deviceCurrent) ok.push(p);
      else if (!deviceOk)
        blocked.push({
          player: p,
          reason:
            "no export.pdb rows — drive was never exported for device-library players",
        });
      else
        blocked.push({
          player: p,
          reason: `export.pdb is stale (${pdb} vs ${ol} OneLibrary rows) — players see an old library until a re-export`,
        });
    } else {
      if (onelibraryOk) ok.push(p);
      else
        blocked.push({
          player: p,
          reason: "no OneLibrary rows — rekordbox 7.2.11+ export needed",
        });
    }
  }
  return { ok, blocked, unknown: false };
}

/** Build extra PlayerSpec entries from config's [players.players] mapping
 *  (name → "device" | "onelibrary"). Invalid entries are skipped, not
 *  thrown — a typo in one custom player must not take down the server. */
export function playersFromConfig(
  mapping: Record<string, string> | undefined,
): PlayerSpec[] {
  if (!mapping) return [];
  const out: PlayerSpec[] = [];
  for (const [name, reads] of Object.entries(mapping)) {
    if (reads === "device" || reads === "onelibrary") {
      out.push({ name, reads });
    }
  }
  return out;
}
