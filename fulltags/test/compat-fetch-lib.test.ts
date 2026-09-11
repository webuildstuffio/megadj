import { describe } from "bun:test";
import {
  runCanonGenreCases,
  runValidatePatchCases,
} from "./helpers/patchCases";

// The tools/fetch-lib.ts shim's `validateTagValues` delegates to
// validatePatch — these are the original fetch-lib.test.ts cases, now
// asserting the FullTags implementation directly. The patch-value scenarios
// are the shared ones (helpers/patchCases.ts); this file keeps the
// compat-specific canonGenre mapping cases.
describe("canonGenre (compat: tools/fetch-lib)", () => {
  runCanonGenreCases();
});

describe("validatePatch (compat: validateTagValues)", () => {
  runValidatePatchCases();
});
