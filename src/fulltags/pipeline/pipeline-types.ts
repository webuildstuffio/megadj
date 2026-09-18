// pipeline-types.ts — shared FullTags pipeline TYPES. Import leaf: both
// pipeline.ts (the orchestrator) and pipeline-stages.ts (the stage arms)
// depend on these; nothing here imports back, so no cycle (#88, madge).
import type { BpTrack } from "./sources/beatport";

/** Injectable Beatport lookup (tests swap this; null = skip the source). */
export type BpLookupFn = (q: {
  artist: string | null;
  title: string;
  durationS?: number | undefined;
}) => Promise<BpTrack | null>;

export interface TrackInput {
  /** Absolute path to the audio file. */
  path: string;
  /** Hint metadata (DB row / yt-dlp info / user-supplied). File wins. */
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  genre?: string | null;
  year?: number | null;
  comment?: string | null;
}

/** The enrichment/analysis stages, in pipeline order. Single source of
 *  truth: PipelineOptions.only, the CLI --stage parser, and the
 *  megadj-side re-exports all derive from this array (adding a stage
 *  updates every consumer by construction, not by memory). */
export const STAGES = [
  "tags",
  "genre",
  "art",
  "year",
  "energy",
  "fingerprint",
  "bpm",
  "key",
  "mood",
] as const;

export type Stage = (typeof STAGES)[number];

export interface PipelineOptions {
  /** Where the AI cover queue appends when every online source misses. */
  archiveDir?: string;
  artworkQueue?: string | null;
  /** Stages to run (default: all). */
  only?: Stage[];
  jobs?: number;
  dryRun?: boolean;
  /** Re-embed existing SC art at original resolution. */
  upgradeScArt?: boolean;
  /** Test seam: override the Beatport lookup. Default is the real
   * catalog client (beatport.ts); pass a stub for offline tests. */
  beatportLookupFn?: BpLookupFn | undefined;
  /** CLI-provided hints (fulltags single <file> --title/--artist/--album):
   * fill in what the filename can't say. Only consulted when the file
   * itself lacks the field. */
  hints?: {
    title?: string | undefined;
    artist?: string | undefined;
    album?: string | undefined;
  };
  onProgress?: (msg: string) => void;
}

export interface TrackResult {
  path: string;
  notes: string[];
  complete: boolean;
  missing: string[];
}
