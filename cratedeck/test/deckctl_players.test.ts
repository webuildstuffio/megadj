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

/** Generic getJson seam: `async <T>(path) => …` in production; the fake
 *  below satisfies it honestly (caller instantiates T at the call). */

/** Honest generic transport for tests: the production seam is
 *  `<T>(path) => Promise<T>` (the caller picks T when invoking). A test
 *  fake satisfies that by deriving per-path payloads and letting the
 *  caller instantiate T — no `as unknown as` cast needed. The id is the
 *  third segment of `/api/drives/:id/players`. */
function fakeGetJson(
  byId: (id: string) => PlayersPayload,
  failIds: ReadonlySet<string> = new Set(),
): <T>(path: string) => Promise<T> {
  return async <T>(path: string) => {
    const id = path.split("/")[3]!; // "", api, drives, :id, players
    if (failIds.has(id)) throw new Error("drive disappeared");
    return byId(id) as T;
  };
}

describe("collectPlayers (deckctl players)", () => {
  it("collects payloads for every healthy drive", async () => {
    const r = await collectPlayers(
      [
        { id: "a", name: "A", nickname: null },
        { id: "b", name: "B", nickname: "Bee" },
      ],
      fakeGetJson((id) => payload(id)),
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
      fakeGetJson((id) => payload(id), new Set(["gone"])),
    );
    expect(r.players.map((p) => p.drive.id)).toEqual(["a"]);
    expect(r.skipped).toEqual([{ drive: "Gone", reason: "drive disappeared" }]);
  });

  it("nickname wins in skipped.drive (matches the human output label)", async () => {
    const r = await collectPlayers(
      [{ id: "x", name: "XRAW", nickname: "Gig Stick" }],
      fakeGetJson(() => {
        throw new Error("boom");
      }),
    );
    expect(r.skipped[0]!.drive).toBe("Gig Stick");
  });
});
