/**
 * master-path.test.ts — pins the ONE master.db path seam (issue #66).
 * The env override (MEGADJ_RB_MASTER) was honored by 1 of 11 callers
 * for months; rb-import was the last holdout (fixed Sep 15). These
 * tests pin the seam itself so no future command regresses to a
 * hand-rolled join.
 */
import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { masterDbPath, normalizeMount } from "./master-path.js";

const ENV = "MEGADJ_RB_MASTER";
let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env[ENV];
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = savedEnv;
});

describe("masterDbPath: env override (the #66 contract)", () => {
  test("explicit env beats every mount form — including drive roots", () => {
    process.env[ENV] = "/tmp/some-other-master.db";
    expect(masterDbPath("/Volumes/SHELF1")).toBe("/tmp/some-other-master.db");
    expect(masterDbPath("SHELF1")).toBe("/tmp/some-other-master.db");
    expect(masterDbPath("/Volumes/SHELF1/PIONEER/Master/master.db")).toBe(
      "/tmp/some-other-master.db",
    );
  });

  test("no env: bare volume name resolves to the standard layout", () => {
    delete process.env[ENV];
    expect(masterDbPath("SHELF1")).toBe(
      "/Volumes/SHELF1/PIONEER/Master/master.db",
    );
  });

  test("no env: drive root, PIONEER dir, Master dir all resolve", () => {
    delete process.env[ENV];
    expect(masterDbPath("/Volumes/SHELF1")).toBe(
      "/Volumes/SHELF1/PIONEER/Master/master.db",
    );
    expect(masterDbPath("/Volumes/SHELF1/PIONEER")).toBe(
      "/Volumes/SHELF1/PIONEER/Master/master.db",
    );
    expect(masterDbPath("/Volumes/SHELF1/PIONEER/Master")).toBe(
      "/Volumes/SHELF1/PIONEER/Master/master.db",
    );
  });

  test("an explicit .db path passes through untouched", () => {
    delete process.env[ENV];
    expect(masterDbPath("/tmp/scratch-master.db")).toBe(
      "/tmp/scratch-master.db",
    );
  });
});

describe("normalizeMount", () => {
  test("strips trailing slashes", () => {
    expect(normalizeMount("/Volumes/SHELF1/")).toBe("/Volumes/SHELF1");
    expect(normalizeMount("/Volumes/SHELF1///")).toBe("/Volumes/SHELF1");
  });
});
