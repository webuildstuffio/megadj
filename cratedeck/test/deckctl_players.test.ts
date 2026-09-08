// deckctl_players.test.ts — regression: the fleet players loop must skip
// an unreachable drive VISIBLY. The old silent `catch {}` dropped the
// drive, and --json mode then printed the literal `undefined` (invalid
// JSON for any agent parsing deckctl players --json).
import { describe, expect, it } from "bun:test";
import { collectPlayers } from "../src/deckctl_players";
import type { PlayersPayload } from "../shared/types";

function payload(id: string): PlayersPayload {
  return {
    drive: { id, name: id, nickname: null },
    measured: { pdb_live_rows: 100, onelibrary_rows: 100 },
    ok: [{ name: "XDJ-XZ", reads: "device" }],
    blocked: [],
    unknown: false,
  };
}

/** Generic getJson seam: `async <T>(path) => …` in production; tests pass
 *  a concretely-typed transport and cast at the seam. */
type GetJson = <T>(path: string) => Promise<T>;

describe("collectPlayers (deckctl players)", () => {
  it("collects payloads for every healthy drive", async () => {
    const r = await collectPlayers(
      [
        { id: "a", name: "A", nickname: null },
        { id: "b", name: "B", nickname: "Bee" },
      ],
      (async (path: string) =>
        payload(path.split("/")[2]!)) as unknown as GetJson,
    );
    expect(r.players.length).toBe(2);
    expect(r.skipped).toEqual([]);
  });

  it("a failing drive lands in skipped with its reason — never silently dropped", async () => {
    const r = await collectPlayers(
      [
        { id: "a", name: "A", nickname: null },
        { id: "gone", name: "Gone", nickname: null },
      ],
      (async (path: string) => {
        if (path.includes("gone")) throw new Error("drive disappeared");
        return payload("a");
      }) as unknown as GetJson,
    );
    expect(r.players.map((p) => p.drive.id)).toEqual(["a"]);
    expect(r.skipped).toEqual([{ drive: "Gone", reason: "drive disappeared" }]);
  });

  it("nickname wins in skipped.drive (matches the human output label)", async () => {
    const r = await collectPlayers(
      [{ id: "x", name: "XRAW", nickname: "Gig Stick" }],
      (async () => {
        throw new Error("boom");
      }) as unknown as GetJson,
    );
    expect(r.skipped[0]!.drive).toBe("Gig Stick");
  });
});
