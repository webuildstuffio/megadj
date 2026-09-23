/**
 * parse-json.ts — the analysis-probe re-export of the ONE guarded
 * JSON.parse seam. The implementation lives in the dependency-free leaf
 * (`src/shared/leaf/guards.ts::parseJsonOrNull`) so web AND node sides
 * share it (#46 web-boundary census allows only src/shared/leaf there).
 * Parser callers expose corruption through their explicit null result —
 * a malformed line can never become a false success.
 */
import { parseJsonOrNull } from "../../shared/leaf/guards";

export function parseJsonObject(raw: string): Record<string, unknown> | null {
  return parseJsonOrNull(raw);
}
