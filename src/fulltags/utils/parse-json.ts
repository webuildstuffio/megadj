/**
 * parse-json.ts — THE guarded JSON.parse seam for the analysis probes.
 * Extracted from analysis.ts (#42 stage split) so key-analysis.ts and
 * the beat stage share one explicit-null parser. Parser callers expose
 * corruption through their explicit null result — a malformed line can
 * never become a false success.
 */
import { isRecord } from "../../shared/leaf/guards";

export function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : null;
  } catch (error) {
    // Parser callers expose corruption through their explicit null result.
    void error;
    return null;
  }
}
