// verify_help.ts — SSOT for "what does verify actually do". Imported by the
// server (served at /drives/:id/verify/help) and mirrored into deckctl's
// explain output so humans and agents see the same wording.

export interface VerifyCheckDoc {
  id: string;
  label: string;
  /** What the check does, mechanically. */
  what: string;
  /** Why a DJ should care. */
  why: string;
  /** What a failure means for gig night. */
  if_fail: string;
  /** Typical fix. */
  fix: string;
}

export const VERIFY_HELP: {
  intro: string;
  duration: string;
  safety: string;
  checks: VerifyCheckDoc[];
} = {
  intro:
    "Verify opens the drive's two rekordbox databases and its file tree, then checks that everything rekordbox claims is actually there, consistent, and identical to the mirror drive. It reads only — nothing on the drive is modified.",
  duration:
    "Typically 1–3 minutes for a ~3,500-track library (most of it is hashing ANLZ files on both drives).",
  safety:
    "Read-only. Safe to run any time, even while a set is loaded. Requires rekordbox to be closed (it locks the same databases).",
  checks: [
    {
      id: "dual-db",
      label: "Hardware library matches rekordbox",
      what: "Compares track counts between export.pdb (what CDJs/XDJs read) and exportLibrary.db (what rekordbox reads).",
      why: "Drives carry two libraries. Hardware players only ever read the legacy one.",
      if_fail:
        "The booth sees a different (usually older) library than your laptop does — tracks you added recently won't exist on the CDJs.",
      fix: "In rekordbox, re-run the USB export with the drive connected — it rebuilds export.pdb.",
    },
    {
      id: "audio-files",
      label: "Audio files on disk",
      what: "Confirms every track row in the DB points at a file that exists on the drive.",
      why: "Databases can outlive their files (a failed copy, an interrupted move).",
      if_fail:
        "Those tracks show in the browser but won't load — dead entries mid-set.",
      fix: "Delete/replace the missing tracks in rekordbox, then re-export.",
    },
    {
      id: "anlz",
      label: "Waveforms + beatgrids (ANLZ)",
      what: "Checks each track has its .ANLZ analysis files at both the DB path and the hashed sub-directory hardware actually uses.",
      why: "ANLZ files ARE the waveform and the beatgrid on hardware.",
      if_fail:
        "Affected tracks load with no waveform, no Beat Sync, no Beat Jump.",
      fix: "In rekordbox: select tracks → Track → Analyze, then re-export.",
    },
    {
      id: "fields",
      label: "BPM + duration sanity",
      what: "Flags tracks with empty BPM or implausible durations.",
      why: "These fields drive BPM sync and search-by-BPM.",
      if_fail: "Sync misbehaves on those tracks; BPM search misses them.",
      fix: "Analyze those tracks in rekordbox, re-export.",
    },
    {
      id: "grids",
      label: "Beatgrid plausibility",
      what: "Sanity-checks generated grids against track length and BPM.",
      why: "A grid that drifts looks fine but slowly slides off-beat.",
      if_fail: "Beat Sync drifts mid-track even though it looked locked.",
      fix: "Re-analyze the flagged tracks.",
    },
    {
      id: "relations",
      label: "Playlists + relations",
      what: "Checks playlist entries and artist links all resolve to real rows.",
      why: "Dangling rows corrupt playlist views on hardware.",
      if_fail: "Playlists come up short or crash older firmware.",
      fix: "Usually heals on the next full export; persist → rebuild the playlist.",
    },
    {
      id: "db-parity",
      label: "Master ↔ mirror database parity",
      what: "Hashes exportLibrary.db on both drives and compares (only when both are connected).",
      why: "The two drives should be interchangeable.",
      if_fail: "Booth behavior depends on which stick you grabbed.",
      fix: "Re-run Mirror, then Verify again.",
    },
    {
      id: "anlz-parity",
      label: "ANLZ hash parity",
      what: "Full hash comparison of analysis files across drives.",
      why: "Same track should look identical on both drives.",
      if_fail: "Waveforms/grids differ between the drives.",
      fix: "Mirror copies ANLZ too — re-run Mirror.",
    },
    {
      id: "audio-parity",
      label: "Audio spot-check (40 sampled)",
      what: "Hashes 40 random audio files on both drives.",
      why: "Catches 'same title, different rip' drift.",
      if_fail: "The same song may sound slightly different from each drive.",
      fix: "Copy the master's file over the mirror's for the listed tracks.",
    },
  ],
};
