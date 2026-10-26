import { describe, expect, test } from "bun:test";
import { downloadBatchDir, intakeFolderName, dumpDateFromName } from "./intake-folder";

// Deterministic "now" for tests.
const NOW = new Date("2026-09-10T12:00:00");

describe("intakeFolderName", () => {
  test.each([
    [
      "date-prefixed dump name keeps its own date from the name",
      "/x/new dump sept 9",
      "2026-09-09 new dump",
    ],
    ["full month names work too", "/x/dump september 9", "2026-09-09 dump"],
    ["generic folders fall back to today's date + 'intake'", "/x/Downloads", "2026-09-10 intake"],
    ["generic fallback (Desktop)", "/x/Desktop", "2026-09-10 intake"],
    ["generic fallback (intake)", "/x/intake", "2026-09-10 intake"],
    [
      "no month in the name → today's date + the name",
      "/x/record pool haul",
      "2026-09-10 record pool haul",
    ],
  ] as [string, string, string][])("%s", (_label, input, expected) => {
    expect(intakeFolderName(input, NOW)).toBe(expected);
  });
  test("future month wraps to next year", () => {
    expect(intakeFolderName("/x/dump dec 20", NOW)).toBe("2026-12-20 dump");
  });
  test("named-date year inference uses the supplied reference clock", () => {
    const historicalNow = new Date("2024-09-10T12:00:00");
    expect(intakeFolderName("/x/dump dec 20", historicalNow)).toBe("2024-12-20 dump");
  });
});

describe("dumpDateFromName", () => {
  test("abbreviated + full months", () => {
    expect(dumpDateFromName("new dump sept 9")).toBe("2026-09-09");
    expect(dumpDateFromName("haul jan 3")).toBe("2026-01-03");
    expect(dumpDateFromName("aug 31 dump")).toBe("2026-08-31");
  });
  test("uses a supplied reference clock for year inference", () => {
    expect(dumpDateFromName("dump dec 20", new Date("2024-09-10T12:00:00"))).toBe("2024-12-20");
  });
  test("no month → null", () => {
    expect(dumpDateFromName(" assorted ")).toBeNull();
    expect(dumpDateFromName("2026 rips")).toBeNull();
  });
  test("month without day → null (fall back to today)", () => {
    expect(dumpDateFromName("sept dump")).toBeNull();
  });
});

describe("downloadBatchDir (#281 relative-archive guard)", () => {
  test("absolute archive dir still builds the dated batch folder", () => {
    expect(downloadBatchDir("/Volumes/SHELF1/Contents", "liked", NOW)).toBe(
      "/Volumes/SHELF1/Contents/2026-09-10 liked downloads",
    );
  });
  test("EMPTY archive dir (the $SHELF-unset trap) throws instead of resolving CWD-relative", () => {
    expect(() => downloadBatchDir("", "liked", NOW)).toThrow(
      /absolute path.*refusing to write into CWD/,
    );
  });
  test("relative archive dir throws the same way", () => {
    expect(() => downloadBatchDir("some/relative/dir", "liked", NOW)).toThrow(/absolute path/);
  });
});
