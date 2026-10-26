// decode-snapshot.ts — the one persisted-snapshot blob decoder (registry +
// drive-store twins consolidated, #484). Corrupt input logs and returns null,
// never throws — same throw-free contract as parseSnapshotJson, which backs it.
import type { SnapshotData } from "./types";
import { parseSnapshotJson } from "./badges";

export function decodeSnapshot(raw: string | null, driveId: string): SnapshotData | null {
  const parsed = parseSnapshotJson(raw);
  if (parsed.corrupt) {
    console.error(`snapshot for drive ${driveId} is corrupt — skipping`);
    return null;
  }
  return parsed.snap;
}
