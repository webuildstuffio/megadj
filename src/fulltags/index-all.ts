/**
 * Barrel that includes the CLI-facing surface (pipeline) too — used by
 * tests so one import covers everything. (#193: the exports.ts barrel
 * was dissolved; this re-exports the same surface from the real modules.)
 */
export * from "./schema";
export * from "./schema-guards";
export * from "./writer";
export * from "./art-sources";
export * from "./sc-search";
export * from "./ai";
export * from "./readers";
export * from "./media-probe";
export * from "./mb_lookup";
export * from "./metadata-build";
export * from "./remix";
export * from "./convert-aiff";
export * from "./fingerprint-dedupe";
export * from "./player-compat";
export * from "./booth-text";
export * from "./tag-health";
export * from "./fingerprint";
export * from "./gates";
export * from "./models";
export * from "./beatport";
export * from "./bandcamp";
export * from "./name-match";
export * from "./beats-analysis";
export * from "./grid-audit";
export * from "./mb";
export * from "./gold";
export * from "./gold-score";
export * from "./anlz";
export * from "./genre/genre-vocab";
