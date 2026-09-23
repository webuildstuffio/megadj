/**
 * Barrel that includes the CLI-facing surface (pipeline) too — used by
 * tests so one import covers everything. (#193: the exports.ts barrel
 * was dissolved; this re-exports the same surface from the real modules.)
 */
export * from "../write/schema";
export * from "../write/schema-guards";
export * from "../write/writer";
export * from "../sources/art-sources";
export * from "../sources/sc-search";
export * from "../analysis/ai";
export * from "../write/readers";
export * from "../utils/media-probe";
export * from "../sources/mb-lookup";
export * from "../write/metadata-build";
export * from "../sources/remix";
export * from "../write/convert-aiff";
export * from "../analysis/fingerprint-dedupe";
export * from "../booth/player-compat";
export * from "../booth/booth-text";
export * from "../write/tag-health";
export * from "../analysis/fingerprint";
export * from "../cli/gates";
export * from "../analysis/models";
export * from "../sources/beatport";
export * from "../sources/bandcamp";
export * from "../sources/name-match";
export * from "../analysis/beats-analysis";
export * from "../analysis/grid-audit";
export * from "../sources/mb";
export * from "../analysis/gold";
export * from "../analysis/gold-score";
export * from "../analysis/anlz";
