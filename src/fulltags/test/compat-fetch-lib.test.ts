import { describe } from "bun:test";
import { runCanonGenreCases, runValidatePatchCases } from "./patchCases";

// The archive-ledger (ex tools/fetch-lib, re-homed per #184)
// `validateTagValues` delegates to validatePatch — these are the original
// fetch-lib.test.ts cases, now asserting the FullTags implementation
// directly. The patch-value scenarios are the shared ones
// (helpers/patchCases.ts); this file keeps the compat-specific canonGenre
// mapping cases.
describe("canonGenre (canonicalizeClaim mapping)", () => {
  runCanonGenreCases();
});

describe("validatePatch (compat: validateTagValues)", () => {
  runValidatePatchCases();
});
