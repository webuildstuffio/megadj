// Browser-safe archive API contract. Producers in cratedeck/src annotate
// their results with these shapes; browser consumers receive the same types
// through shared/types.ts without importing the server/CLI dependency tree.

export interface ArchiveTrack {
  video_id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  status: string;
  bitrate_kbps: number | null;
  codec: string | null;
  file_path: string | null;
  duration_s: number | null;
  genre: string | null;
  energy: number | null;
  source: string;
  liked_position: number | null;
  first_seen_at: string;
  updated_at: string;
}

export interface ArchiveIngestStatus {
  available: boolean;
  counts: Record<string, number>;
  total: number;
  recent_runs: {
    started_at: string;
    finished_at: string | null;
    attempted: number | null;
    downloaded: number;
    failed: number;
    gone: number;
    bytes_downloaded: number | null;
  }[];
  recent_tracks: ArchiveTrack[];
  /** #256 link-first: the surfaced-link cohort with its acquisition URLs
   *  (source_links JSON parsed — first URL wins as `url`, the full list
   *  rides in `links`). Distinct list — surfaced is an HONEST terminal
   *  state, never folded into downloaded. `done` = the user's checklist
   *  (clicked + saved into the downloads folder). */
  surfaced: {
    video_id: string;
    title: string | null;
    artist: string | null;
    /** The first acquisition URL — rendered as a clickable link. */
    url: string | null;
    /** Every parsed acquisition link [{kind, url}]. */
    links: { kind: string; url: string }[];
    /** User checklist: file saved into the downloads folder. */
    done: boolean;
    /** ISO time the user checked it off (null while open). */
    done_at: string | null;
  }[];
}

export interface ArchiveLowqQueue {
  available: boolean;
  tracks: (ArchiveTrack & { reason: string })[];
}

export interface ArchiveSkipCensus {
  available: boolean;
  skipped: number;
  gone: number;
  buckets: { reason: string; count: number; kind: string }[];
}

export interface ArchiveSourceCensus {
  available: boolean;
  sources: { source: string; tracks: number; playable: number }[];
}

export interface ArchiveAnalysisCoverage {
  available: boolean;
  tracks: number;
  beats: number | null;
  mood: number | null;
  cues: number | null;
}

export interface ArchiveGridOffender {
  video_id: string;
  title: string | null;
  rbBpm: number;
  ledgerBpm: number;
  driftMs: number;
}

export interface ArchiveGridCrossCheck {
  available: boolean;
  ledgered: number;
  checked: number;
  ok: number;
  off: ArchiveGridOffender[];
  octave: ArchiveGridOffender[];
  drift: (ArchiveGridOffender & { reason: string })[];
}

export interface ArchiveMoodExtreme {
  video_id: string;
  title: string | null;
  artist: string | null;
  v: number;
}

export interface ArchiveMoodProfile {
  available: boolean;
  analyzed: number;
  avg: {
    dance: number;
    valence: number;
    arousal: number;
    party: number;
    electronic: number;
    aggressive: number;
  };
  extremes: {
    valence: ArchiveMoodExtreme[];
    arousal: ArchiveMoodExtreme[];
    dance: ArchiveMoodExtreme[];
  };
}

export interface ArchiveCueStats {
  available: boolean;
  analyzed: number;
  avg_cues: number;
  total_cues: number;
  tracks: {
    video_id: string;
    title: string | null;
    artist: string | null;
    cue_count: number;
    first_cue_at: number;
    model: string;
  }[];
}

export interface ArchiveLibraryOverview {
  available: boolean;
  tracks: number;
  artwork: { embedded: number; missing: number; queued: number };
  genres: { name: string; count: number }[];
  years: {
    known: number;
    unknown: number;
    min: string | null;
    max: string | null;
  };
  energy: { stamped: number };
  codecs: { codec: string; count: number }[];
  sizes: { files: number; total_bytes: number };
  recent: (ArchiveTrack & {
    year: string | null;
    artwork_status: string | null;
    file_size_bytes: number | null;
  })[];
}

export interface ArchiveSimilar {
  available: boolean;
  video_id: string;
  title: string | null;
  corpus: number;
  hits: {
    video_id: string;
    title: string | null;
    artist: string | null;
    score: number;
  }[];
}

/** #215 — one track's #173 vote-ladder breakdown (genre-why). The read
 *  twin of `serializeVotes`: every rung's claim, re-elected through the
 *  write path's exact seam. */
export interface ArchiveGenreWhy {
  available: boolean;
  video_id: string;
  title: string | null;
  artist: string | null;
  /** The genre column (may carry a first-win-era/sync-era label). */
  db_genre: string | null;
  /** false = never voted: an honest empty-state, never fake data. */
  voted: boolean;
  /** only when voted: the replayed election result. */
  elected?: string | null;
  elected_weight?: number;
  winner_rungs?: string[];
  /** only when voted: does the replay re-elect the stored genre? */
  matches_db?: boolean;
  /** only when the video_id matched no row at all. */
  missing?: boolean;
  votes: {
    rung: string;
    genre: string;
    weight: number;
    elected: boolean;
    detail: string | null;
  }[];
}

export type ArchiveSearchHit = ArchiveTrack;

export interface ArchiveFreshness {
  beatsAt: string | null;
  moodAt: string | null;
}

export interface ArchiveSetCandidate {
  videoId: string;
  title: string | null;
  artist: string | null;
  durationS: number | null;
  bpm: number | null;
  key: string | null;
  valence: number | null;
  arousal: number | null;
  dance: number | null;
  /** Server-internal field removed before route/MCP/CLI serialization. */
  filePath: string | null;
  /** #106 Phase D: phrase cues from the `cues` ledger (8-bar boundaries).
   *  Empty when the track has no derivation — the handoff windows degrade
   *  to null, never invented bars. */
  cues: { bar: number; position: number }[];
  /** #171 similarity prior: the stored embedding vector (null = none —
   *  no bonus, never a penalty). Server-internal like filePath: stripped
   *  before serialization (fat payload, not client-relevant). */
  embedding: number[] | null;
  /** B1 (#104): true when the file is absent (shelf asleep) but the
   *  row carries measured tempo (beats ledger or rekordbox mirror) —
   *  admitted so an offline shelf cannot zero the pool. Never carries a
   *  live file path, so M3U8 export skips it (no dead paths). */
  metadataOnly: boolean;
}

export interface ArchiveSetCandidates {
  available: boolean;
  sourceTotal: number;
  total: number;
  missingFiles: number;
  duplicateFiles: number;
  relocatedFiles: number;
  /** B1 (#104): rows admitted WITHOUT a mounted file because measured
   *  tempo (beats ledger / rekordbox mirror) covers them. Part of the
   *  missing-files population; the payload surfaces the count so a
   *  proposal built from mirror metadata is visible, never silent. */
  metadataOnly: number;
  rekordboxKeyHits: number;
  rekordboxBpmHits: number;
  keyReads: number;
  keyReadFailures: number;
  candidates: ArchiveSetCandidate[];
  freshness: ArchiveFreshness;
}

// ---- tag census (fulltags vs rekordbox side-by-side) -----------------------
// One archive-DB read joins the FullTags mirror columns with the
// rb-adopt mirror (`rekordbox_content` metadata_json). FILE TAGS are NOT
// read on the census path — the file is ground truth but a census
// touching 3.5k files would pay a ffprobe+mutagen read per row; the
// per-track endpoint reads the file live for the ONE track you inspect.

/** Full per-track comparison: the archive DB's mirror columns, the
 *  rb-adopt mirror row, and a LIVE ground-truth read of the physical
 *  file's tags (the file is truth — one ffprobe+mutagen read per
 *  request is the price of honesty here). */
export interface ArchiveTrackFileTags {
  readable: boolean;
  title: string | null;
  artist: string | null;
  genre: string | null;
  year: string | null;
  bpm: number | null;
  key: string | null;
  label: string | null;
  mixName: string | null;
  remixer: string | null;
  energy: number | null;
  mood: string | null;
  comment: string | null;
  art: boolean;
}

export interface ArchiveTrackTagCompare {
  available: boolean;
  videoId: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  /** The physical file's tags, read at request time (null = file
   *  missing/unreadable — the DB mirror is shown uncorrected). */
  file: ArchiveTrackFileTags | null;
  /** FullTags pipeline ledger data (genre_flag carries the demote-and-
   *  flag pass verdict; valence/arousal from the mood ledger). */
  pipeline: {
    genre: string | null;
    genreFlag: string | null;
    energy: number | null;
    bpmFolded: number | null;
    /** Cached TKEY from track_keys (the key ledger). */
    key: string | null;
    valence: number | null;
    arousal: number | null;
    analyzedAt: string | null;
  };
  /** The rb-adopt mirror row (null = no rekordbox Content row linked
   *  to this track — it was never imported into a rekordbox library). */
  rekordbox: {
    contentId: string;
    title: string | null;
    artist: string | null;
    album: string | null;
    genre: string | null;
    key: string | null;
    bpm: number | null;
    year: string | null;
    label: string | null;
    comment: string | null;
    /** Every scalar djmdContent column + resolved names (lossless). */
    metadata: Record<string, unknown>;
  } | null;
  /** The headline disagreements, precomputed for sort/copy: identity
   *  fields first (title/artist/genre/key/bpm/year), then enrichment. */
  differences: {
    field: string;
    file: string | number | null;
    archive: string | number | null;
    rekordbox: string | number | null;
  }[];
}

/** One row of the tag census: playable tracks joined with their RB
 *  mirror, disagreement-counted. The census NEVER reads files — the
 *  differ flags here compare the two DB mirrors only; the per-track
 *  endpoint adds the live file read. */
export interface ArchiveTagCensusRow {
  videoId: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  /** FullTags mirror genre (tracks.genre). */
  archiveGenre: string | null;
  /** rb-adopt mirror genre (metadata_json GenreName). */
  rekordboxGenre: string | null;
  archiveKey: string | null;
  rekordboxKey: string | null;
  archiveBpm: number | null;
  rekordboxBpm: number | null;
  /** tracks.genre_flag ('disputed' = contradicts unanimous kNN). */
  genreFlag: string | null;
  /** Set on the row when the two mirrors disagree on ANY compared
   *  field (genre/key/bpm/title/artist). */
  differs: string[];
  hasRekordboxRow: boolean;
}

export interface ArchiveTagCensus {
  available: boolean;
  /** Rows returned (post-filter, post-limit). */
  returned: number;
  /** Total playable tracks with an RB mirror row joined. */
  matched: number;
  /** Of those: how many disagree on ≥1 compared field. */
  differing: number;
  /** Playable tracks with NO rekordbox row (never imported). */
  unmatched: number;
  /** Disagreement counts per field, across the matched population. */
  fieldCounts: { field: string; count: number }[];
  rows: ArchiveTagCensusRow[];
  /** Which mirrors exist in this DB (absent rekordbox_content table =
   *  `megadj rb-adopt` never ran). */
  rekordboxMirror: boolean;
  /** Ledger freshness (#174): the age stamps the compared analysis
   *  rides on — a census against week-old beats/mood rows must not read
   *  as current. Ages come from MAX(analyzed_at), never file mtimes. */
  freshness: ArchiveFreshness;
}
