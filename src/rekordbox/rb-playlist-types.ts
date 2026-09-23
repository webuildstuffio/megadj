// rb-playlist-types.ts — the rb-playlist contract, split out of
// rb-playlist.ts (#316: was duplicated). rb-playlist.ts owns the
// dry-run sequencer; rb-playlist-apply.ts owns the write arm. Both need
// the option/result shapes AND the early-gate failure envelope — a
// single types module keeps the two legs import-cycle-free without
// hand-copying the envelope (jscpd caught the 30L twin).
import type { SetSearchOverride } from "../deck/shared/megaset";

export interface RbPlaylistOptions {
  /** Drive mount root (master DB at <mount>/PIONEER/Master/master.db)
   *  or explicit DB path via MEGADJ_RB_MASTER. */
  mount: string;
  /** Same params as `megadj megaset` — one engine, one validation. */
  preset?: string | undefined;
  minutes?: number | undefined;
  opener?: string | undefined;
  limit?: number | undefined;
  /** #283 genre pool filter (raw value; shared family matcher). */
  genre?: string | undefined;
  /** Force the sequencer (A/B compare) — same contract as megaset --search.
   *  #283-followup: this was silently DROPPED before (the option parsed,
   *  the engine never saw it — a flag the engine never reads is the
   *  classic silent no-op bug), so --search beam ran greedy. */
  search?: SetSearchOverride | undefined;
  /** Playlist name (defaults to "megaset <preset> <minutes>min <date>"). */
  playlist?: string | undefined;
  /** Parent playlist group (defaults to the proven "DJ-Imports"). */
  group?: string | undefined;
  apply?: boolean;
  yes?: boolean;
  log?: (s: string) => void;
}

export interface RbPlaylistResult {
  command: "rb-playlist";
  db: string;
  playlist: string;
  group: string;
  preset: string;
  minutes: number;
  /** Tracks in the built chain. */
  chain: number;
  /** Chain tracks matched to existing master content rows. */
  linked: number;
  /** Chain tracks with NO content row in the master (not imported yet). */
  unmatched: { title: string; reason: string }[];
  /** #106 Phase D: per-step handoff windows from the cues ledger, in
   *  chain order ("45s @ bar 25"; null = no cue row for that track).
   *  Dry-run evidence only — the apply leg writes the playlist rows, not
   *  cue pads (cue writes are a separate gated surface). */
  cueWindows: { title: string; mixIn: string | null; mixOut: string | null }[];
  /** In apply mode: playlist row ID. */
  playlistId: string | null;
  /** Post-write verify: song-playlist rows under our playlist. */
  verified: number;
  appliedMode: boolean;
  backedUpTo: string | null;
  errors: string[];
  ok: boolean;
  error?: string;
}

/** Early-gate failure: everything not yet known stays at its zero value.
 *  Shared by the dry-run and apply legs (#316: was a 30L copy in each —
 *  the comment admitted it existed only to dodge an import cycle). */
export function gateFail(
  opts: RbPlaylistOptions,
  dbPath: string,
  group: string,
  error: string,
): RbPlaylistResult {
  return {
    command: "rb-playlist",
    db: dbPath,
    playlist: opts.playlist ?? "",
    group,
    preset: opts.preset ?? "peak",
    minutes: 0,
    chain: 0,
    linked: 0,
    unmatched: [],
    cueWindows: [],
    playlistId: null,
    verified: 0,
    appliedMode: Boolean(opts.apply),
    backedUpTo: null,
    errors: [],
    ok: false,
    error,
  };
}
