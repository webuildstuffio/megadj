/** Backward-compatible operator shim. The implementation lives in FullTags. */
import { runFixYears } from "../src/fulltags/years";

export { runFixYears } from "../src/fulltags/years";

if (import.meta.main) {
  await runFixYears({ dryRun: process.argv.includes("--dry-run") });
}
