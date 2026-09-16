/**
 * booth_routes — the /api/booth/fleet payload + config.toml persistence.
 * Extracted from index.ts (file-length guard). The profile/citation SSOT
 * is fulltags FLEET_PROFILES; this module only maps it to the wire shape
 * (shared/types BoothFleetPayload) and writes the user's selection back.
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { BoothFleetPayload, BoothPlayerProfile } from "../shared/types";
import { isUnknownArray } from "../shared/guards";
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
  return valid.length > 0 ? valid : [...(DEFAULT_FLEET as string[])];
}

export function parseBoothFleetRequest(value: unknown): string[] {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("selected" in value) ||
    !isUnknownArray(value.selected) ||
    !value.selected.every((id): id is string => typeof id === "string")
  ) {
    throw new Error("selected must be an array of player ids");
  }
  const known = new Set(FLEET_PROFILES.map((profile) => profile.id as string));
  const unknown = value.selected.filter((id) => !known.has(id));
  if (unknown.length > 0)
    throw new Error(`unknown player id: ${unknown.join(", ")}`);
  return normalizeFleetSelection(value.selected);
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
    // replace the existing [booth] block (up to the next [section]
    // HEADER or EOF) — the lookahead anchors on a real TOML section
    // header (`[^\]]*\]`); a bare `[` inside the fleet array (never
    // happens: ids are plain words) would otherwise truncate it.
    next = /^\[booth\]$/m.test(text)
      ? text.replace(/\n\[booth\]\n(?:(?!\n\[[^\]]*\])[\s\S])*/, `\n${section}`)
      : `${text.replace(/\n*$/, "\n")}${section}`;
  } else {
    next = `${section}\n`;
  }
  const tmp = `${cfgPath}.tmp`;
  writeFileSync(tmp, next);
  renameSync(tmp, cfgPath);
}
