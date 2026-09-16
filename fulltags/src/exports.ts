/**
 * FullTags public exports — the stable import surface for both FullTags
 * internals and megadj's shims. Kept to symbols with real consumers
 * (knip-verified: every re-export here is imported from src/, cli.ts, or
 * tests); internal-only helpers are exported from their own modules.
 */
export {
  // canonicalizeClaim — the claim canonicalization verb; re-exported from
  // genre-vocab (schema.ts's `canonGenre` alias is package-internal only).
  canonicalizeClaim,
} from "./genre-vocab";
export {
  sanitizeGenreFolder,
  completeness,
  type EnrichedMetadata,
  type TagPatch,
} from "./schema";
export {
  familyOf,
  guessFromFreeText,
  isUmbrellaLabel,
  normalizeGenre,
  repairEscapes,
} from "./genre-vocab";
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
  probeMediaSync,
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
} from "./fingerprint";
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
export {
  artUrlLarge,
  bcFetchPage,
  bcGenre,
  bcHitPlausible,
  bcQueryTerm,
  bcSearch,
  bcSearchRaw,
  isoFromBcDate,
  parseIsoDuration,
  scoreBcHits,
  BC_MIN_OVERLAP,
  type BcPage,
  type BcTrack,
} from "./bandcamp";
export {
  artistGate,
  artistGateFails,
  hasTitleTokenOverlap,
  nameTokens,
  primaryArtist,
  titleOverlap,
  ARTIST_MIN_LEN,
} from "./name-match";
export {
  analyzeBeats,
  openBeatSession,
  foldTempo,
  type BeatResult,
  type BeatSession,
} from "./beats-analysis";
export { gridAuditFull, type GridAuditVerdict } from "./grid-audit";
export { mbGenreForArtist } from "./mb";
export {
  aggregateScores,
  goldDir,
  GOLD_SCHEMA_VERSION,
  loadGoldSet,
  splitGoldSet,
  scoreGoldTrack,
  type GoldAnnotation,
  type GoldMetrics,
  type GoldSet,
  type GoldSplit,
  type GoldTrackScore,
} from "./gold";
export {
  buildAnlz,
  parseAnlzGrid,
  parseAnlzInventory,
  type AnlzGrid,
  type AnlzInventory,
} from "./anlz";
export {
  runFetch,
  type FetchAllOptions,
  // #184: the batch fetch pipeline lives here now (re-homed from
  // tools/fetch-all.ts) — but the archive-ledger DB graph must stay out
  // of every CLI boot, so this export is consumed ONLY through a lazy
  // dynamic import (src/fulltags/fetch.ts), never a static one.
} from "./fetch-pipeline";
