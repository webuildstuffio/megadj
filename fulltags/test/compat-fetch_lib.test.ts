import { describe } from "bun:test";
import {
  runCanonGenreCases,
  runValidatePatchCases,
} from "./helpers/patchCases";

// The tools/fetch_lib.ts shim's `validateTagValues` delegates to
// validatePatch — these are the original fetch_lib.test.ts cases, now
// asserting the FullTags implementation directly. The patch-value scenarios
// are the shared ones (helpers/patchCases.ts); this file keeps the
// compat-specific canonGenre mapping cases.
describe("canonGenre (compat: tools/fetch_lib)", () => {
  runCanonGenreCases();
});

describe("validatePatch (compat: validateTagValues)", () => {
  runValidatePatchCases();
});
