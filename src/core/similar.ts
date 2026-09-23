// Compatibility facade: storage, search, and genre scoring live in focused
// leaves while existing importers keep the archive/similar public surface.
export { cosineSimilarity } from "../shared/leaf/vector-space";
export type { EvalSummary, LoORowOutcome } from "./similar-evaluation";
export * from "./similar-genre";
export * from "./similar-search";
export {
  EmbeddingsLedger,
  KeysLedger,
  parseEmbeddingVector,
} from "./similar-storage";
