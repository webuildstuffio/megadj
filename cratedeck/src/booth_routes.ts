/**
 * booth_routes — the /api/booth/fleet payload + config.toml persistence.
 * Extracted from index.ts (file-length guard). The profile/citation SSOT
 * is fulltags FLEET_PROFILES; this module only maps it to the wire shape
 * (shared/types BoothFleetPayload) and writes the user's selection back.
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { BoothFleetPayload, BoothPlayerProfile } from "../shared/types";
import {
  FLEET_PROFILES,
  DEFAULT_FLEET,
  fleetFloor,
  resolveFleet,
} from "../../fulltags/src/fleet";

/** The GET/POST /api/booth/fleet payload — profiles + citations + the
 *  floor the current selection produces. */
export function boothFleetPayload(
  selected: readonly string[],
): BoothFleetPayload {
  const fleet = resolveFleet(selected);
  const floor = fleetFloor(fleet);
  const profiles: BoothPlayerProfile[] = FLEET_PROFILES.map((p) => ({
    id: p.id,
    name: p.name,
    defaultOn: p.defaultOn,
    unicodeText: p.text.unicode,
    emoji: p.text.emoji,
    maxSampleRate: p.maxSampleRate,
    maxBitDepth: p.maxBitDepth,
    flac: p.formats.flac,
    citations: p.citations,
  }));
  return {
    selected: [...selected],
    profiles,
    floor: {
      flac: floor.flac,
      maxSampleRate: floor.maxSampleRate,
      maxBitDepth: floor.maxBitDepth,
      unicodeText: floor.unicodeText,
    },
  };
}

/** Validate a client selection: unknown ids dropped, empty reverts to the
 *  default trio — an empty selection must never silently widen the floor. */
export function normalizeFleetSelection(ids: readonly string[]): string[] {
  const known = new Set(FLEET_PROFILES.map((p) => p.id as string));
  const valid = ids.filter((id) => known.has(id));
  return valid.length > 0 ? valid : (DEFAULT_FLEET as string[]).slice();
}

/** Persist [booth].fleet to config.toml — replace or append the section,
 * atomically (tmp + rename), preserving every other line. */
export function writeConfigBoothFleet(
  root: string,
  ids: readonly string[],
): void {
  const cfgPath = join(root, "config.toml");
  const section = [
    "",
    "[booth]",
    "# players the compat gates enforce (fulltags FLEET_PROFILES ids)",
    `fleet = [${ids.map((id) => `"${id}"`).join(", ")}]`,
    "",
  ].join("\n");
  let next: string;
  if (existsSync(cfgPath)) {
    const text = readFileSync(cfgPath, "utf8");
    if (/^\[booth\]$/m.test(text)) {
      // replace the existing [booth] block (up to the next [section]
      // HEADER or EOF). The lookahead anchors on a real TOML section
      // header (`[^\]]*\]`) — a bare `[` inside the fleet array (never
      // happens: ids are plain words) would otherwise truncate it.
      next = text.replace(
        /\n\[booth\]\n(?:(?!\n\[[^\]]*\])[\s\S])*/,
        `\n${section}`,
      );
    } else {
      next = `${text.replace(/\n*$/, "\n")}${section}`;
    }
  } else {
    next = `${section}\n`;
  }
  const tmp = `${cfgPath}.tmp`;
  writeFileSync(tmp, next);
  renameSync(tmp, cfgPath);
}
