import { describe, expect, test } from "bun:test";
import { pickKeeper } from "./rb-dedup.js";

describe("rb-dedup keeper selection", () => {
  test("prefers the file under Contents/", () => {
    const contents = { path: "/Volumes/SHELF1/Contents/Artist/x.aiff" };
    const intake = { path: "/Volumes/SHELF1/Intake/2026-09-11/x.aiff" };
    expect(pickKeeper(contents, intake)).toBe("a");
    expect(pickKeeper(intake, contents)).toBe("b");
  });

  test("falls back to stable lexical order when both are Contents", () => {
    expect(pickKeeper({ path: "/a/x" }, { path: "/b/x" })).toBe("a");
    expect(pickKeeper({ path: "/b/x" }, { path: "/a/x" })).toBe("b");
  });
});
