/**
 * gold-report tests — GA-00b. The pure math lives in fulltags/gold.ts
 * (tested there); these cover the COMMAND: ledger-to-scorer wiring,
 * the phrase-bar projection, and the P1 --json contract on the real CLI.
 */
import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ArchiveState } from "../state";
import { goldReport, predictedPhraseBars } from "./gold-report";
import {
  GOLD_SCHEMA_VERSION,
  type GoldAnnotation,
} from "../../fulltags/src/gold";

/**
 * A valid annotation used to exercise the corrupt/valid loader split in
 * the "corrupt annotation files" test (written to disk there).
 */
const GOLD: GoldAnnotation = {
  hash: "a".repeat(64),
  version: GOLD_SCHEMA_VERSION,
  branch: "house",
  firstDownbeatMs: 0,
  bpm: 124,
  phraseBars: [1, 33],
  hotCuesMs: [0],
};

/** Fresh ArchiveState under `dir` (each test owns its tmp dir).
 *  Module-level — captures nothing from the enclosing describe. */
const makeState = (dir: string): ArchiveState =>
  new ArchiveState(join(dir, "archive.db"));

describe("predictedPhraseBars", () => {
  test("one bar per 32 downbeats, 1-based", () => {
    // 64 downbeats → bars 1 and 33; 63 → none fit the second window.
    expect(
      predictedPhraseBars(Array.from({ length: 64 }, (_, i) => i)),
    ).toEqual([1, 33]);
    expect(
      predictedPhraseBars(Array.from({ length: 63 }, (_, i) => i)),
    ).toEqual([1]);
    expect(predictedPhraseBars([])).toEqual([]);
  });
});

describe("goldReport command", () => {
  test("empty gold dir → ok:false with the GA-00 pointer (never a fake pass)", async () => {
    const dir = mkdtempSync("/tmp/megadj-goldrep-");
    const state = makeState(dir);
    try {
      const r = await goldReport({
        state,
        dir: join(dir, "_gold"),
        json: true,
      });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/annotate 30 tracks/u);
    } finally {
      state.close();
    }
  });

  test("corrupt annotation files are surfaced by name; valid ones still load", async () => {
    const dir = mkdtempSync("/tmp/megadj-goldrep2-");
    const gdir = join(dir, "_gold");
    mkdirSync(gdir);
    writeFileSync(join(gdir, "bad.json"), "{nope");
    writeFileSync(join(gdir, "good.json"), JSON.stringify(GOLD));
    const state = makeState(dir);
    try {
      const r = await goldReport({ state, dir: gdir, json: true });
      expect(r.annotations).toBe(1);
      expect(r.issueFiles.join(" ")).toMatch(/bad\.json/u);
    } finally {
      state.close();
    }
  });
});

describe("P1: gold-report --json on the real CLI", () => {
  const dir = mkdtempSync("/tmp/megadj-goldcli-");
  const env = {
    MEGADJ_DB: join(dir, "archive.db"),
    MEGADJ_MUSIC_DIR: join(dir, "music"),
    MEGADJ_COOKIES: "",
  };

  test("one parseable summary object; exit 1 with no annotations", async () => {
    const proc =
      await $`bun run ${join(import.meta.dir, "../cli.ts")} gold-report --json`
        .env({ ...process.env, ...env })
        .quiet()
        .nothrow();
    expect(proc.exitCode).toBe(1); // empty set is a visible failure
    const lines = new TextDecoder().decode(proc.stdout).trim().split("\n");
    const parsed = JSON.parse(lines[lines.length - 1] ?? "") as Record<
      string,
      unknown
    >;
    expect(parsed.command).toBe("gold-report");
    expect(parsed.ok).toBe(false);
  });
});
