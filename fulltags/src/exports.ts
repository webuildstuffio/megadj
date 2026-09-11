/**
 * FullTags public exports — the stable import surface for both FullTags
 * internals and megadj's shims. Kept to symbols with real consumers
 * (knip-verified: every re-export here is imported from src/, cli.ts, or
 * tests); internal-only helpers are exported from their own modules.
 */
export {
  canonGenre,
  inferGenre,
  sanitizeGenreFolder,
  type EnrichedMetadata,
  type TagPatch,
} from "./schema";
export { validatePatch, validatePatchUntrusted } from "./schema-guards";
export {
  applyTags,
  embedArt,
  walkAudioFiles,
  writePatch,
  writePatchSync,
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
} from "./art-sources";
export { aiGenres, albumHeuristic, AI_MODEL_PIN as AI_MODEL } from "./ai";
export { groundTruth } from "./readers";
export {
  energyFromLufs,
  firstTag,
  measureRms,
  parseFilename,
  probeFile,
  qualityScore,
  trueContainerExt,
  type ParsedName,
  type Probe,
} from "./media-probe";
export { mbRecording } from "./mb_lookup";
export { buildMetadata, type YtdlpInfo } from "./metadata-build";
export { detectRemix } from "./remix";
export { wavToAiff } from "./convert";
export { compareFingerprint, nameSimilarityTokens } from "./fingerprint-dedupe";
export { playerCompat, isHiresOnly } from "./player-compat";
export {
  boothTextCompat,
  cp1252Bytes,
  hasControlChars,
  isMojibake,
  type TextCompatResult,
} from "./booth-text";
export { setBoothFleet, getBoothFleet } from "./player-compat";
export { parseMoodStamp } from "./pipeline";
export { tagHealth, type TagHealth } from "./tag-health";
export {
  fingerprintFile,
  fingerprintFileLength,
  parseFpcalcOutput,
} from "./analysis";
export {
  applyGateWritesSync,
  GateSaturationError,
  runRegate,
  type GateDimension,
  type GateObservation,
  type GateResult,
} from "./gates";
export { analyzeMoods, type MoodResult } from "./models";
export {
  beatportArt,
  beatportLookup,
  beatportToken,
  beatportReset,
  bpGenre,
  bpStamp,
  scoreBpHit,
  BP_MIN_SCORE,
  setBeatportSearchImpl,
  type BpTrack,
  type BpQuery,
} from "./beatport";
