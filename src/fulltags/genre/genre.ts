// `megadj genre`: infer genres from audio embeddings rather than ID3 tags.
//
// Default is a dry run; --apply writes through ArchiveState. --eval runs the
// standing leave-one-out regression gate. This compatibility barrel keeps
// existing imports stable while the dependency-only contracts live in
// genre-run-types.ts and orchestration lives in the genre-run-* modules.

export { genre } from "./genre-run";
export type * from "./genre-run-types";
