import { describe, expect, test, afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { __test } from "./rb-comment-sync.js";
import { renderKitMarkers } from "./rb-command-kit";
import { commentSyncOutput, fakeRbRuntime, sequentialSpawn } from "./test-support/rb-cue-fixtures";
import { tempDir } from "../test-support/testutil";

const t = tempDir("megadj-csync-").rippable();
afterAll(() => t.rippleAll());

/** The RENDERED sync program — kit markers resolved exactly as
 *  pyUvFileArgv does at spawn time (#194 corpus extraction). */
const commentSyncScript = () =>
  renderKitMarkers(
    readFileSync(join(import.meta.dir, "rb-scripts", "comment-sync.kit.py"), "utf8"),
  );

describe("rb-comment-sync", () => {
  test("ledgerFreshnessOf reads MAX(analyzed_at) stamps (#174)", () => {
    const dir = t.dir();
    const p = join(dir, "archive.db");
    const db = new Database(p);
    db.exec(`CREATE TABLE beats (analyzed_at TEXT NOT NULL);
      CREATE TABLE mood (analyzed_at TEXT NOT NULL);
      INSERT INTO beats VALUES ('2026-09-10T00:00:00Z');
      INSERT INTO beats VALUES ('2026-09-16T00:00:00Z');
      INSERT INTO mood VALUES ('2026-09-01T00:00:00Z');`);
    try {
      expect(__test.ledgerFreshnessOf(p)).toEqual({
        beatsAt: "2026-09-16T00:00:00Z",
        moodAt: "2026-09-01T00:00:00Z",
      });
    } finally {
      db.close();
    }
  });

  test("ledgerFreshnessOf degrades to null stamps, never throws", () => {
    // missing file
    expect(__test.ledgerFreshnessOf("/tmp/does-not-exist-fresh.db")).toEqual({
      beatsAt: null,
      moodAt: null,
    });
    // wrong schema (no beats/mood tables) → honest nulls, not a crash
    const dir = t.dir();
    const p = join(dir, "archive.db");
    const db = new Database(p);
    db.exec("CREATE TABLE other (x TEXT);");
    db.close();
    expect(__test.ledgerFreshnessOf(p)).toEqual({ beatsAt: null, moodAt: null });
  });
  test("script never clobbers non-empty comments and reads TXXX only", () => {
    const s = commentSyncScript();
    // hard skip when a comment already exists — the never-clobber rule
    expect(s).toContain('(c.Commnt or "").strip()');
    expect(s).toContain("alreadyHad");
    // reads the FullTags TXXX frames
    expect(s).toContain("CAMELOT");
    expect(s).toContain("ENERGY");
    expect(s).toContain("MOOD");
    // one transaction commit; partial per-row writes roll back together
    expect(s).toContain("db.session.commit()");
    expect(s).toContain("db.session.rollback()");
    expect(s).toContain('["pgrep", "-x", "rekordbox"]');
  });

  test("script formats comments as v4 space-separated tokens (BPM never enters)", () => {
    const s = commentSyncScript();
    expect(s).toContain("build_comment_v4");
    expect(s).toContain("energy_band");
    expect(s).toContain("var_tempo");
    expect(s).toContain("VAR_THRESHOLD");
    expect(s).toContain("ENERGY_TO_COLOR");
    expect(s).toContain("DjmdMyTag");
    expect(s).toContain("DjmdSongMyTag");
    expect(s).not.toContain("BPM"); // BPM has its own RB column (AGENTS.md)
  });

  test("rejects malformed and partial apply summaries", () => {
    expect(() => __test.parseSyncOutput("not json", true)).toThrow(/malformed JSON/u);
    expect(() =>
      __test.parseSyncOutput(
        JSON.stringify(commentSyncOutput({ scanned: 2, eligible: 2, written: 1 })),
        true,
      ),
    ).toThrow(/wrote 1\/2 eligible rows/u);
  });

  test("parses genre_written/genre_skipped from sync output", () => {
    const out = __test.parseSyncOutput(
      JSON.stringify({
        ...commentSyncOutput({ scanned: 3, eligible: 0, written: 0, alreadyHad: 3, writes: [] }),
        genre_written: 42,
        genre_skipped: 7,
      }),
      false,
    );
    expect(out.genreWritten).toBe(42);
    expect(out.genreSkipped).toBe(7);
  });

  test("defaults genre fields to 0 when absent (backward compat)", () => {
    const out = __test.parseSyncOutput(
      JSON.stringify(commentSyncOutput({ eligible: 0, written: 0, alreadyHad: 1, writes: [] })),
      false,
    );
    expect(out.genreWritten).toBe(0);
    expect(out.genreSkipped).toBe(0);
    expect(out.colorWritten).toBe(0);
    expect(out.colorSkipped).toBe(0);
    expect(out.mytagWritten).toBe(0);
    expect(out.anlzLoaded).toBe(0);
  });

  test("exact verification rejects missing or mismatched intended comments", () => {
    const expected = [["42", "11A · E8.8 · Dance"]] as const;
    expect(() =>
      __test.validateVerification(
        expected,
        __test.parseVerifyOutput(
          JSON.stringify({
            total: 1,
            matched: 0,
            missing: [],
            mismatched: [["42", "11A · E8.8 · Dance", "old"]],
          }),
        ),
      ),
    ).toThrow(/mismatched/u);
  });

  test("aborts when rekordbox reopens before the write spawn", async () => {
    let checks = 0;
    let spawned = false;
    let restored = false;
    const result = await __test.run(
      { mount: "/Volumes/TEST", apply: true, yes: true },
      fakeRbRuntime({
        assertClosed: () => {
          checks++;
          if (checks === 2) throw new Error("rekordbox reopened");
        },
        restore: () => {
          restored = true;
        },
        spawn: () => {
          spawned = true;
          throw new Error("must not spawn");
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("rekordbox reopened");
    expect(spawned).toBe(false);
    expect(restored).toBe(true);
  });

  test("accepts only an exact delayed re-read of every written comment", async () => {
    let slept = false;
    const spawn = sequentialSpawn([
      JSON.stringify(commentSyncOutput({ samples: [["track.aiff", "11A · E8.8 · Dance"]] })),
      JSON.stringify({ total: 1, matched: 1, missing: [], mismatched: [] }),
    ]);
    const result = await __test.run(
      { mount: "/Volumes/TEST", apply: true, yes: true },
      fakeRbRuntime({
        sleep: () => {
          slept = true;
        },
        spawn,
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.verify.detail).toContain("1/1 intended comments exactly");
    expect(slept).toBe(true);
    expect(spawn.callCount()).toBe(2);
  });

  test("restores the DB family when delayed verification rejects a committed mutation", async () => {
    const restores: [string, string][] = [];
    const result = await __test.run(
      { mount: "/Volumes/TEST", apply: true, yes: true },
      fakeRbRuntime({
        restore: (dbPath, backupPath) => {
          restores.push([dbPath, backupPath]);
        },
        spawn: sequentialSpawn([
          JSON.stringify(commentSyncOutput()),
          JSON.stringify({
            total: 1,
            matched: 0,
            missing: [],
            mismatched: [["42", "11A · E8.8 · Dance", "old"]],
          }),
        ]),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("mismatched ids: 42");
    expect(result.error).toContain("restored backup");
    expect(restores).toEqual([["/Volumes/TEST/PIONEER/Master/master.db", "/tmp/master.db.bak"]]);
  });

  test("surfaces both the original failure and a failed restore", async () => {
    const result = await __test.run(
      { mount: "/Volumes/TEST", apply: true, yes: true },
      fakeRbRuntime({
        restore: () => {
          throw new Error("restore exploded");
        },
        spawn: () => ({ status: 0, stdout: "not json", stderr: "" }),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("malformed JSON");
    expect(result.error).toContain("restore exploded");
  });

  test("surfaces the guard's stdout refusal when the sync spawn exits 1", async () => {
    const result = await __test.run(
      { mount: "/Volumes/TEST", apply: true, yes: true },
      fakeRbRuntime({
        spawn: () => ({
          status: 1,
          stdout: JSON.stringify({ error: "rekordbox is running — refusing write" }),
          stderr: "",
        }),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("rekordbox is running — refusing write");
  });

  test("restores after an incomplete write acknowledgement", async () => {
    let restored = false;
    const result = await __test.run(
      { mount: "/Volumes/TEST", apply: true, yes: true },
      fakeRbRuntime({
        restore: () => {
          restored = true;
        },
        spawn: () => ({
          status: 0,
          stdout: JSON.stringify(commentSyncOutput({ writes: [] })),
          stderr: "",
        }),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("acknowledgements are incomplete");
    expect(result.error).toContain("restored backup");
    expect(restored).toBe(true);
  });
});
