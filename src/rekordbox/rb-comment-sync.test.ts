import { describe, expect, test, afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { __test } from "./rb-comment-sync.js";
import { renderKitMarkers } from "./rb-command-kit";
import { tempDir } from "../test-support/testutil";

const t = tempDir("megadj-csync-").rippable();
afterAll(() => t.rippleAll());

/** The RENDERED sync program — kit markers resolved exactly as
 *  pyUvFileArgv does at spawn time (#194 corpus extraction). */
const commentSyncScript = () =>
  renderKitMarkers(
    readFileSync(
      join(import.meta.dir, "rb-scripts", "comment-sync.kit.py"),
      "utf8",
    ),
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
    expect(__test.ledgerFreshnessOf(p)).toEqual({
      beatsAt: null,
      moodAt: null,
    });
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

  test("script formats comments as Key · E · Mood (BPM never enters)", () => {
    const s = commentSyncScript();
    expect(s).toContain('" · ".join(parts)');
    expect(s).not.toContain("BPM"); // BPM has its own RB column (AGENTS.md)
  });

  test("rejects malformed and partial apply summaries", () => {
    expect(() => __test.parseSyncOutput("not json", true)).toThrow(
      /malformed JSON/u,
    );
    expect(() =>
      __test.parseSyncOutput(
        JSON.stringify({
          scanned: 2,
          eligible: 2,
          written: 1,
          alreadyHad: 0,
          skipped: [],
          samples: [],
          writes: [["42", "11A · E8.8 · Dance"]],
          errors: [],
        }),
        true,
      ),
    ).toThrow(/wrote 1\/2 eligible rows/u);
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
      {
        exists: () => true,
        fileExists: () => true,
        assertClosed: () => {
          checks++;
          if (checks === 2) throw new Error("rekordbox reopened");
        },
        backup: () => "/tmp/master.db.bak",
        restore: () => {
          restored = true;
        },
        sleep: () => {},
        spawn: () => {
          spawned = true;
          throw new Error("must not spawn");
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("rekordbox reopened");
    expect(spawned).toBe(false);
    expect(restored).toBe(true);
  });

  test("accepts only an exact delayed re-read of every written comment", async () => {
    let call = 0;
    let slept = false;
    const result = await __test.run(
      { mount: "/Volumes/TEST", apply: true, yes: true },
      {
        exists: () => true,
        fileExists: () => true,
        assertClosed: () => {},
        backup: () => "/tmp/master.db.bak",
        restore: () => {},
        sleep: () => {
          slept = true;
        },
        spawn: () => {
          call++;
          return call === 1
            ? {
                status: 0,
                stdout: JSON.stringify({
                  scanned: 1,
                  eligible: 1,
                  written: 1,
                  alreadyHad: 0,
                  skipped: [],
                  samples: [["track.aiff", "11A · E8.8 · Dance"]],
                  writes: [["42", "11A · E8.8 · Dance"]],
                  errors: [],
                }),
                stderr: "",
              }
            : {
                status: 0,
                stdout: JSON.stringify({
                  total: 1,
                  matched: 1,
                  missing: [],
                  mismatched: [],
                }),
                stderr: "",
              };
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(result.verify.detail).toContain("1/1 intended comments exactly");
    expect(slept).toBe(true);
    expect(call).toBe(2);
  });

  test("restores the DB family when delayed verification rejects a committed mutation", async () => {
    const restores: [string, string][] = [];
    let call = 0;
    const result = await __test.run(
      { mount: "/Volumes/TEST", apply: true, yes: true },
      {
        exists: () => true,
        fileExists: () => true,
        assertClosed: () => {},
        backup: () => "/tmp/master.db.bak",
        restore: (dbPath, backupPath) => {
          restores.push([dbPath, backupPath]);
        },
        sleep: () => {},
        spawn: () => {
          call++;
          return call === 1
            ? {
                status: 0,
                stdout: JSON.stringify({
                  scanned: 1,
                  eligible: 1,
                  written: 1,
                  alreadyHad: 0,
                  skipped: [],
                  samples: [],
                  writes: [["42", "11A · E8.8 · Dance"]],
                  errors: [],
                }),
                stderr: "",
              }
            : {
                status: 0,
                stdout: JSON.stringify({
                  total: 1,
                  matched: 0,
                  missing: [],
                  mismatched: [["42", "11A · E8.8 · Dance", "old"]],
                }),
                stderr: "",
              };
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("mismatched ids: 42");
    expect(result.error).toContain("restored backup");
    expect(restores).toEqual([
      ["/Volumes/TEST/PIONEER/Master/master.db", "/tmp/master.db.bak"],
    ]);
  });

  test("surfaces both the original failure and a failed restore", async () => {
    const result = await __test.run(
      { mount: "/Volumes/TEST", apply: true, yes: true },
      {
        exists: () => true,
        fileExists: () => true,
        assertClosed: () => {},
        backup: () => "/tmp/master.db.bak",
        restore: () => {
          throw new Error("restore exploded");
        },
        sleep: () => {},
        spawn: () => ({ status: 0, stdout: "not json", stderr: "" }),
      },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("malformed JSON");
    expect(result.error).toContain("restore exploded");
  });

  test("restores after an incomplete write acknowledgement", async () => {
    let restored = false;
    const result = await __test.run(
      { mount: "/Volumes/TEST", apply: true, yes: true },
      {
        exists: () => true,
        fileExists: () => true,
        assertClosed: () => {},
        backup: () => "/tmp/master.db.bak",
        restore: () => {
          restored = true;
        },
        sleep: () => {},
        spawn: () => ({
          status: 0,
          stdout: JSON.stringify({
            scanned: 1,
            eligible: 1,
            written: 1,
            alreadyHad: 0,
            skipped: [],
            samples: [],
            writes: [],
            errors: [],
          }),
          stderr: "",
        }),
      },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("acknowledgements are incomplete");
    expect(result.error).toContain("restored backup");
    expect(restored).toBe(true);
  });
});
