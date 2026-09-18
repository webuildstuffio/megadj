/**
 * test-support re-export for cratedeck tests (#248 item 3). The #222
 * boundary direction stays one-directional: cratedeck TEST files may
 * import src test-support (dev-side tooling), production cratedeck code
 * may not. Import from here, never from `../../src/test-support/testutil`
 * directly, so the seam has one address.
 */
export {
  tempDir,
  tempState,
  type TempDirHandle,
} from "../../src/test-support/testutil";
