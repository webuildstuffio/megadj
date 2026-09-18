/** Enrichment stages accepted by both the CLI parser and fetch orchestrator. */
export const FETCH_TARGETS = ["art", "genres", "tags", "years", "all"] as const;

export type FetchTarget = (typeof FETCH_TARGETS)[number];
