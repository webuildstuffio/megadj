/**
 * FullTags public exports — the stable import surface for both FullTags
 * internals and megadj's shims.
 */
export {
  // schema
  COMPLETENESS_FIELDS,
  SC_GENRE_CANON,
  DJ_GENRES,
  canonGenre,
  completeness,
  inferGenre,
  sanitizeGenreFolder,
  type EnrichedMetadata,
  type FullTag,
  type TagPatch,
} from "./schema";
export { validatePatch, validateTagValues } from "./schema-guards";
export {
  applyTags,
  embedArt,
  isAudioFile,
  writePatch,
  writePatchWav,
} from "./writer";
export {
  fetchImage,
  pageOgImage,
  fetchBestScArt,
  soundcloudArtwork,
  soundcloudUrlInTags,
  itunesArtwork,
  deezerArt,
  gatewayArt,
  twinArt,
  scSearch,
  type ScHit,
  type ArtRow,
} from "./art-sources";
export {
  aiGenres,
  albumHeuristic,
  AI_MODEL,
  type AiRow,
} from "./ai";
export {
  groundTruth,
  readFullTag,
  type Truth,
} from "./readers";
export {
  energyFromLufs,
  firstTag,
  mbRecording,
  measureRms,
  parseFilename,
  probeFile,
  qualityScore,
  type Probe,
} from "./probes";
export {
  buildMetadata,
  cleanTitle,
  extractComposer,
  type YtdlpInfo,
} from "./metadata-build";
export { detectRemix, type RemixInfo } from "./remix";
export { wavToAiff } from "./convert";
export {
  enrichAll,
  enrichTrack,
  listAudio,
  type BatchSummary,
  type PipelineOptions,
  type TrackInput,
  type TrackResult,
} from "./pipeline";
