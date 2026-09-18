/**
 * Barrel that includes the CLI-facing surface (pipeline) too — used by
 * tests so one import covers everything. (#193: the exports.ts barrel
 * was dissolved; this re-exports the same surface from the real modules.)
 */
export * from "./write/schema";
export * from "./write/schema-guards";
export * from "./write/writer";
export * from "./sources/art-sources";
export * from "./sources/sc-search";
export * from "./analysis/ai";
export * from "./write/readers";
export * from "./media-probe";
export * from "./sources/mb_lookup";
export * from "./write/metadata-build";
export * from "./sources/remix";
export * from "./write/convert-aiff";
export * from "./analysis/fingerprint-dedupe";
export * from "./player-compat";
export * from "./booth-text";
export * from "./write/tag-health";
export * from "./analysis/fingerprint";
export * from "./gates";
export * from "./analysis/models";
export * from "./sources/beatport";
export * from "./sources/bandcamp";
export * from "./sources/name-match";
export * from "./analysis/beats-analysis";
export * from "./grid-audit";
export * from "./sources/mb";
export * from "./gold";
export * from "./gold-score";
export * from "./anlz";
