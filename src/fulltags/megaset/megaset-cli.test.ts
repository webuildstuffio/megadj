// megaset-cli.test.ts — the `megadj megaset` CLI leg as a real subprocess
// (runCli env isolation, the repo-standard harness): the human-readable
// step lines must carry the #106 Phase D handoff windows (same evidence
// the web hover cards and M3U8 #EXTREM comments show), and the cueless
// path must print the honest "no cue windows" marker.
import { describe, expect, test, afterAll } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { cliEnv, runCli } from "../../test-support/cli-run";
import { tempDir, stateIn } from "../../test-support/testutil";

const t = tempDir("megadj-megaset-cli-").rippable();
afterAll(() => t.rippleAll());

describe("megadj megaset CLI step rendering", () => {
  test("step lines carry mix-in/mix-out windows; cueless tracks say so", async () => {
    const dir = t.dir();
    const dbPath = join(dir, "archive.db");
    // bootstrap the REAL schema (ArchiveState's migration) so the CLI's
    // startup never trips on a missing column, then layer the fixtures
    stateIn(dir).close();
    const db = new Database(dbPath);
    mkdirSync(join(dir, "music"), { recursive: true });
    // two mixable tracks with DISTINCT files (a shared file = one alias
    // pair, and the duplicate collapses out of the pool): one cued, one not
    const rows = [
      ["cued", "Cued Track", "DJ", 300, 124, "cued"],
      ["cueless", "Cueless Track", "DJ", 300, 125, null],
    ] as const;
    for (const [id, title, artist, dur, bpm, cueId] of rows) {
      const audio = join(dir, "music", `${id}.m4a`);
      writeFileSync(audio, "not real audio — never decoded");
      db.query(
        `INSERT INTO tracks
         (video_id, title, artist, duration_s, file_path, status, first_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'downloaded', '2026-09-16', '2026-09-16')`,
      ).run(id, title, artist, dur, audio);
      // beats row: bpm_raw/bpm_folded + the NOT NULL json/model columns
      // (bpm_folded is the pool's measured-tempo source)
      db.query(
        `INSERT OR REPLACE INTO beats
         (video_id, bpm_raw, bpm_folded, beats_json, downbeats_json, model, source_path, analyzed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, bpm, bpm, "[]", "[]", "test", audio, "2026-09-16");
      // mood row: the 6 ONNX label probabilities + the valence/arousal
      // axes the arc scoring reads
      db.query(
        `INSERT OR REPLACE INTO mood
         (video_id, dance, aggressive, happy, electronic, party, valence, arousal, source_path, analyzed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, 0.7, 0.2, 0.5, 0.6, 0.3, 5, 5, audio, "2026-09-16");
      if (cueId !== null) {
        db.query(`INSERT OR REPLACE INTO cues VALUES (?, ?, ?, ?)`).run(
          id,
          JSON.stringify([
            { index: 0, bar: 1, position: 0 },
            { index: 1, bar: 25, position: 45.1 },
          ]),
          "test",
          "2026-09-16",
        );
      }
    }
    db.close();

    const run = await runCli(
      ["megaset", "--preset", "warmup", "--minutes", "5"],
      { ...cliEnv(dir), MEGADJ_DB: dbPath },
    );
    const out = `${run.stdout}\n${run.stderr}`;
    // the cued track's line carries the derived windows (45 s target →
    // bar 25 @ 45.1); the cueless track is honestly marked
    expect(out).toContain("Cued Track");
    expect(out).toContain("in 45s/bar 25");
    expect(out).toContain("no cue windows");
    // the proposal header (the pinned human log schema) still shows
    expect(out).toContain("-track warmup proposal");
    // #284: the step line carries the per-component evidence breakdown —
    // the blend becomes auditable on the terminal without a JSON dive.
    // This fixture's two tracks share the head credit "DJ", so the B6
    // penalty path is exercised too (the −3+1 suffix explains the 0.01
    // blend a bare sum would not).
    expect(out).toMatch(
      /\[t 0\.\d{2} · k 0\.\d{2} · arc 0\.\d{2} · anch 0\.\d{2} · B6 −3\+1\]/,
    );
    // #291: the exclusion status line — budget-fill named as a status,
    // quality exclusions separate. This fixture's pool is fully consumed
    // (stopCause exhausted → nothing excluded), so assert the wire field
    // instead of a log line.
    expect(out).toContain('"budget_filled":0');
  });
});
