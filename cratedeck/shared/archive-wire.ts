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
}

export interface ArchiveSetCandidates {
  available: boolean;
  sourceTotal: number;
  total: number;
  missingFiles: number;
  duplicateFiles: number;
  relocatedFiles: number;
  rekordboxKeyHits: number;
  rekordboxBpmHits: number;
  keyReads: number;
  keyReadFailures: number;
  candidates: ArchiveSetCandidate[];
  freshness: ArchiveFreshness;
}
