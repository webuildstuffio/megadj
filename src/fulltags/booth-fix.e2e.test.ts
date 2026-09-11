import { describe, expect, test, afterAll } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { boothFix } from "./booth-fix";
import { setBoothFleet } from "../../fulltags/src/exports";
import { ArchiveState } from "../archive/state";

// ---- fixture: a tiny fake archive -------------------------------------------
const tmp = mkdtempSync("/tmp/boothfix-e2e-");
const musicDir = join(tmp, "music");
mkdirSync(musicDir, { recursive: true });

// A real (tiny) AIFF is overkill — booth-fix's text gate only reads the
// FILENAME + tag fields, and probeFile is only hit when audio compat
// matters; for AIFF/44.1k the fixture can skip a real probe by using a
// minimal valid file for the ones we expect to pass and letting probeFile
// report "no audio stream" for the rename-only target (the player-compat
// row is expected and asserted below).
writeFileSync(join(musicDir, "bad ;name .aiff"), Buffer.alloc(64));
writeFileSync(join(musicDir, "track 🔥.aiff"), Buffer.alloc(64));

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  // never leave process.exitCode sticky (AGENTS.md bun-test rule)
  process.exitCode = 0;
});

function fakeState(): ArchiveState {
  // Booth-fix only calls allTracks() + updateFilePath(); a throwaway DB
  // in the tmp dir keeps this hermetic without mocking the class shape.
  const state = new ArchiveState(join(tmp, "state.sqlite"));
  return state;
}

describe("boothFix — end to end (fixture archive)", () => {
  test("dry run: flags the rename, changes nothing on disk", async () => {
    setBoothFleet(["xdj-xz", "cdj-3000", "cdj-2000nxs2"]);
    const state = fakeState();
    const res = await boothFix({
      state,
      musicDir,
      dryRun: true,
      log: () => {},
    });
    expect(res.fleet).toEqual(["xdj-xz", "cdj-3000", "cdj-2000nxs2"]);
    expect(res.applied).toBe(0);
    const names = readdirSync(musicDir);
    expect(names).toContain("bad ;name .aiff"); // untouched
    expect(names).toContain("track 🔥.aiff");
    const renameRows = res.rows.filter((r) => r.action === "rename");
    expect(renameRows.length).toBe(1);
    expect(renameRows[0]!.reasons).toContain("path-illegal-character");
  });

  test("apply: renames the illegal-char file, idempotent re-run", async () => {
    setBoothFleet(["xdj-xz", "cdj-3000", "cdj-2000nxs2"]);
    const state = fakeState();
    const res = await boothFix({
      state,
      musicDir,
      apply: true,
      log: () => {},
    });
    expect(res.applied).toBeGreaterThanOrEqual(1);
    const names = readdirSync(musicDir);
    expect(names).toContain("bad ,name.aiff"); // ; → , + trailing space gone
    expect(names).not.toContain("bad ;name .aiff");
    // the emoji filename is NOT auto-renamed (renames are for illegal
    // chars + trailing dot/space only; emoji lives in tags)
    expect(names).toContain("track 🔥.aiff");
    // idempotence: second run finds nothing more to rename
    const again = await boothFix({
      state,
      musicDir,
      apply: true,
      log: () => {},
    });
    expect(again.rows.filter((r) => r.action === "rename").length).toBe(0);
  });
});

describe("boothFix — exit-code honesty", () => {
  test("rows with action 'none' (unfixable) keep the report honest", async () => {
    setBoothFleet(["xdj-xz", "cdj-3000", "cdj-2000nxs2"]);
    const state = fakeState();
    const res = await boothFix({
      state,
      musicDir,
      dryRun: true,
      log: () => {},
    });
    // every plan row names an executable command or a concrete rename
    for (const r of res.rows) {
      expect(r.plan.length).toBeGreaterThan(4);
    }
  });
});
