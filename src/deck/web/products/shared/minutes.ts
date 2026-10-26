// minutes.ts — the ONE custom-minutes form converter for the megaset
// surfaces (#457 target 9): megaset-builder and cohorts-view carried
// byte-identical clampMinutes/minutesFrom copies. The bounds ride the
// shared MEGASET_MINUTES_MIN/MAX constants — the same window the plan
// engine clamps to server-side.
import { MEGASET_MINUTES_MAX, MEGASET_MINUTES_MIN } from "../../../shared/types";

function clampMinutes(raw: number): number {
  return Number.isFinite(raw)
    ? Math.min(MEGASET_MINUTES_MAX, Math.max(MEGASET_MINUTES_MIN, Math.round(raw)))
    : 60;
}

/** Raw form value → plan minutes: an empty input is the 60-minute
 *  default, anything else converts once and clampMinutes finite-checks
 *  the result (non-numeric input also lands on the default). */
export function minutesFrom(input: string): number {
  return input.trim() === "" ? 60 : clampMinutes(Number(input));
}
