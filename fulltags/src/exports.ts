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
  writePatchSync,
  writePatchWav,
  writePatchMp4,
  AUDIO_EXTS as ARTWORK_EXTS,
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
  type AiTagResult,
} from "./ai";
export { groundTruth, readFullTag, type Truth } from "./readers";
export {
  energyFromLufs,
  firstTag,
  LOSSLESS,
  mbRecording,
  measureRms,
  parseFilename,
  probeFile,
  qualityScore,
  type ParsedName,
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
export { readAiStamps } from "./pipeline";
export {
  fingerprintFile,
  fingerprintWithDuration,
  analyzeBeats,
  analyzeKey,
  analyzeKeys,
  foldTempo,
  type BeatResult,
  type KeyResult,
} from "./analysis";
export {
  enrichAll,
  enrichTrack,
  listAudio,
  type BatchSummary,
  type PipelineOptions,
  type TrackInput,
  type TrackResult,
} from "./pipeline";
