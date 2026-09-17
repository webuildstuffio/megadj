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
} from "./art-sources";
export {
  scSearch,
  scoreScHits,
  SC_ARTIST_MIN_LEN,
  type ScHit,
  type SearchRow,
} from "./sc-search";
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
  goldDir,
  GOLD_SCHEMA_VERSION,
  loadGoldSet,
  splitGoldSet,
  type GoldAnnotation,
  type GoldSet,
  type GoldSplit,
} from "./gold";
export {
  scoreGoldTrack,
  aggregateScores,
  PHRASE_WINDOW_BARS,
  CUE_ACCEPT_MS,
  type GoldMetrics,
  type GoldTrackScore,
} from "./gold-score";
export {
  buildAnlz,
  parseAnlzGrid,
  parseAnlzInventory,
  type AnlzGrid,
  type AnlzInventory,
} from "./anlz";
// #89 madge-cycle fix: runFetch + FetchAllOptions no longer re-export
// through this barrel. The static re-export closed a 3-cycle
// (exports → fetch-pipeline → archive-ledger → exports) that the
// documented `bunx madge --circular` gate flags. The pipeline's ONE
// consumer (src/fulltags/fetch.ts) already went through a LAZY dynamic
// import — it now aims at ../src/fetch-pipeline directly; no static
// importer of runFetch exists anywhere. The archive-ledger DB graph
// still never rides a CLI boot.
