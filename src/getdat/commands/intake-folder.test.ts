import { describe, expect, test } from "bun:test";
import { intakeFolderName, dumpDateFromName } from "./intake-folder";

// Deterministic "now" for tests.
const NOW = new Date("2026-09-10T12:00:00");

describe("intakeFolderName", () => {
  test("date-prefixed dump name keeps its own date from the name", () => {
    expect(intakeFolderName("/x/new dump sept 9", NOW)).toBe(
      "2026-09-09 new dump",
    );
  });
  test("full month names work too", () => {
    expect(intakeFolderName("/x/dump september 9", NOW)).toBe(
      "2026-09-09 dump",
    );
  });
  test("generic folders fall back to today's date + 'intake'", () => {
    expect(intakeFolderName("/x/Downloads", NOW)).toBe("2026-09-10 intake");
    expect(intakeFolderName("/x/Desktop", NOW)).toBe("2026-09-10 intake");
    expect(intakeFolderName("/x/intake", NOW)).toBe("2026-09-10 intake");
  });
  test("no month in the name → today's date + the name", () => {
    expect(intakeFolderName("/x/record pool haul", NOW)).toBe(
      "2026-09-10 record pool haul",
    );
  });
  test("future month wraps to next year", () => {
    expect(intakeFolderName("/x/dump dec 20", NOW)).toBe("2026-12-20 dump");
  });
});

describe("dumpDateFromName", () => {
  test("abbreviated + full months", () => {
    expect(dumpDateFromName("new dump sept 9")).toBe("2026-09-09");
    expect(dumpDateFromName("haul jan 3")).toBe("2026-01-03");
    expect(dumpDateFromName("aug 31 dump")).toBe("2026-08-31");
  });
  test("no month → null", () => {
    expect(dumpDateFromName(" assorted ")).toBeNull();
    expect(dumpDateFromName("2026 rips")).toBeNull();
  });
  test("month without day → null (fall back to today)", () => {
    expect(dumpDateFromName("sept dump")).toBeNull();
  });
});
