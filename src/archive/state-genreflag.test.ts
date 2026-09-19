// setGenreFlag conditional-clear contract — the #64 audit note must
// survive the --flag self-heal loop (which clears EVERY embedded row's
// flag each run), while a fresh 'disputed' write DOES overwrite a stale
// resolution. SQLite-specific, so it runs against a throwaway DB file.
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import type { ArchiveState } from "./state";
import { tempDir, stateIn } from "../test-support/testutil";

const t = tempDir("megadj-flagnote-").rippable();
afterAll(() => t.rippleAll());

function makeState(): { state: ArchiveState; db: Database } {
  const dir = t.dir();
  const name = `${crypto.randomUUID()}.db`;
  const dbPath = join(dir, name);
  // both handles open the SAME file: stateIn writes the schema, the
  // readonly Database is the assertion twin
  const state = stateIn(dir, name);
  return { state, db: new Database(dbPath, { readonly: true }) };
}

/** Typed read of the flag column (bun:sqlite's .get() returns `{}`). */
function flagOf(db: Database, id: string): string | null | undefined {
  return (
    db.query("SELECT genre_flag FROM tracks WHERE video_id=?").get(id) as
      { genre_flag: string | null } | undefined
  )?.genre_flag;
}

describe("setGenreFlag conditional clear (#64 note preservation)", () => {
  test("null clear wipes 'disputed' but never 'resolved:<note>'", () => {
    const { state, db } = makeState();
    const id = "vid-a";
    state.upsertTrackFromPlaylist(id, 2, "A");
    state.setGenreFlag(id, "disputed");
    expect(flagOf(db, id)).toBe("disputed");
    state.setGenreFlag(id, null);
    expect(flagOf(db, id) ?? null).toBeNull();

    // a human resolution + note:
    state.setGenreFlag(id, "disputed"); // re-flag first (fresh evidence)
    state.setGenreFlag(id, null); // keep-verb clears...
    state.setGenreFlagNote(id, "source is right");
    expect(flagOf(db, id)).toBe("resolved:source is right");
    // ...and the NEXT --flag self-heal must NOT erase the note:
    state.setGenreFlag(id, null);
    expect(flagOf(db, id)).toBe("resolved:source is right");
  });

  test("a fresh 'disputed' write overwrites a stale resolution", () => {
    const { state, db } = makeState();
    const id = "vid-b";
    state.upsertTrackFromPlaylist(id, 3, "B");
    state.setGenreFlag(id, "disputed");
    state.setGenreFlagNote(id, "old verdict");
    expect(flagOf(db, id)).toBe("resolved:old verdict");
    state.setGenreFlag(id, "disputed");
    expect(flagOf(db, id)).toBe("disputed");
  });
});
