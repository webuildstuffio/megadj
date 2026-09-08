/**
 * megadj metadata — now a FullTags re-export.
 *
 * The enrichment engine moved to `fulltags/` (the FullTags sub-project):
 * same functions, same behavior, one home. This shim keeps every existing
 * importer (`sync`, `ingest`, `organize`, `enrich`, `downloader`) working
 * untouched. New code should import from `fulltags/src/...` directly.
 */
export {
  applyTags,
  buildMetadata,
  inferGenre,
  sanitizeGenreFolder,
  type YtdlpInfo,
} from "../fulltags/src/exports";
