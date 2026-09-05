/**
 * Barrel that includes the CLI-facing surface (pipeline) too — used by
 * tests so one import covers everything.
 */
export * from "./exports";
export { enrichAll, enrichTrack, listAudio } from "./pipeline";
