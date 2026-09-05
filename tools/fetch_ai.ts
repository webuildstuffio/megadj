/**
 * fetch_ai.ts — thin shim over FullTags' OpenRouter classifier
 * (fulltags/src/ai.ts). Kept so `tools/fetch_all.ts` imports stay stable.
 */
export { aiGenres, albumHeuristic } from "../fulltags/src/exports";
