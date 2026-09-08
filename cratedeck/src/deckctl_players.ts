// deckctl_players.ts — `deckctl players` collection logic (extracted for
// testability at the file guard). The CLI assembles per-drive player
// compatibility payloads; the fleet loop must SKIP an unreachable drive
// VISIBLY (skipped[] rides both output modes) — the old silent `catch {}`
// once printed the literal "undefined" in --json mode, invalid JSON for
// any agent parsing it (the Sep 7-8 silent-fallback purge class).
import type { PlayersPayload } from "../shared/types";

export interface PlayerFleetPayload {
  players: PlayersPayload[];
  /** Drives whose lookup failed mid-loop: visible in both output modes. */
  skipped: { drive: string; reason: string }[];
}

/** Fetch /drives/:id/players for every drive, tolerating per-drive
 *  failures without dropping them silently. */
export async function collectPlayers(
  drives: { id: string; name: string; nickname: string | null }[],
  getJson: <T>(path: string) => Promise<T>,
): Promise<PlayerFleetPayload> {
  const players: PlayersPayload[] = [];
  const skipped: { drive: string; reason: string }[] = [];
  for (const d of drives) {
    try {
      players.push(
        await getJson<PlayersPayload>(`/api/drives/${d.id}/players`),
      );
    } catch (e) {
      skipped.push({
        drive: d.nickname ?? d.name,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { players, skipped };
}
