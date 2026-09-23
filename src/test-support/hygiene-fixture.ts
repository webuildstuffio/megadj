/**
 * hygiene-fixture.ts — shared detect → confirm → apply harness for the
 * shelf hygiene suites (issue #223 builder 3, executing #197's builder
 * program: quarantine.test.ts and restore.test.ts carried byte-twin
 * fixture + detectAndApply blocks, 48 duplicated lines jscpd measured).
 *
 * The fixture writes a keeper (`track.mp3`) and a loser
 * (`track copy.mp3`) with identical bytes into a scratch shelf
 * Contents dir; `detectAndApply` runs shelfHygiene detect + confirm +
 * apply until the finding reports `applied`, then hands the finding id
 * to the caller. Failures throw LOUDLY at the fixture — a silent
 * half-applied state downstream reads like a restore/census regression.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { expect } from "bun:test";
import { HygieneStore } from "../core/hygiene/store";
import { shelfHygiene } from "../shelf/hygiene";
import { writeFakeAudio } from "./audio-fixtures";

export interface HygieneFixture {
  shelf: string;
  db: string;
  keeper: string;
  loser: string;
}

export function hygieneShelfFixture(
  shelfTemp: { dir: () => string },
  dbTemp: { dir: () => string },
): HygieneFixture {
  const shelf = shelfTemp.dir();
  const dir = join(shelf, "Contents", "Artist");
  mkdirSync(dir, { recursive: true });
  const keeper = join(dir, "track.mp3");
  writeFakeAudio(keeper, "same bytes");
  const loser = join(dir, "track copy.mp3");
  writeFileSync(loser, "same bytes");
  const db = join(dbTemp.dir(), "archive.db");
  return { shelf, db, keeper, loser };
}

/** Detect the duplicate pair, confirm the finding, apply, and verify the
 *  finding flipped to `applied` — the exact ladder every consumer test
 *  needs before asserting its own census/restore behavior. */
export async function detectAndApply(
  f: HygieneFixture,
  md5: (path: string) => string,
): Promise<string> {
  await shelfHygiene({
    shelfVolume: f.shelf,
    dbPath: f.db,
    md5,
    log: () => {},
  });
  const db = new Database(f.db);
  const store = new HygieneStore(db);
  const finding = store.list({ status: "open" })[0];
  if (!finding) {
    db.close();
    throw new Error("fixture did not produce a finding");
  }
  try {
    expect(store.decide(finding.id, true)).toBe(true);
  } finally {
    db.close();
  }
  await shelfHygiene({
    shelfVolume: f.shelf,
    dbPath: f.db,
    md5,
    apply: true,
    yes: true,
    log: () => {},
  });
  const verifyDb = new Database(f.db);
  try {
    const applied = new HygieneStore(verifyDb).get(finding.id);
    if (applied?.status !== "applied")
      throw new Error(
        `fixture apply did not complete: ${applied?.status ?? "missing"}`,
      );
  } finally {
    verifyDb.close();
  }
  return finding.id;
}
