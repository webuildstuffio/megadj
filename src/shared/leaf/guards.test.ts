import { describe, expect, test } from "bun:test";
import { nonEmptyEnv } from "./guards";

describe("nonEmptyEnv (#281 empty-env trap)", () => {
  test("returns the value when present and non-empty", () => {
    process.env.MEGADJ_TEST_NONEMPTY = "/Volumes/SHELF1";
    try {
      expect(nonEmptyEnv("MEGADJ_TEST_NONEMPTY")).toBe("/Volumes/SHELF1");
    } finally {
      delete process.env.MEGADJ_TEST_NONEMPTY;
    }
  });
  test("returns undefined when absent", () => {
    delete process.env.MEGADJ_TEST_NONEMPTY;
    expect(nonEmptyEnv("MEGADJ_TEST_NONEMPTY")).toBeUndefined();
  });
  test("empty string → undefined (the $VAR-unset expansion trap)", () => {
    process.env.MEGADJ_TEST_NONEMPTY = "";
    try {
      expect(nonEmptyEnv("MEGADJ_TEST_NONEMPTY")).toBeUndefined();
    } finally {
      delete process.env.MEGADJ_TEST_NONEMPTY;
    }
  });
  test("whitespace-only → undefined (same typo class)", () => {
    process.env.MEGADJ_TEST_NONEMPTY = "   ";
    try {
      expect(nonEmptyEnv("MEGADJ_TEST_NONEMPTY")).toBeUndefined();
    } finally {
      delete process.env.MEGADJ_TEST_NONEMPTY;
    }
  });
  test("value with surrounding spaces is preserved as-is", () => {
    process.env.MEGADJ_TEST_NONEMPTY = " /x/y ";
    try {
      expect(nonEmptyEnv("MEGADJ_TEST_NONEMPTY")).toBe(" /x/y ");
    } finally {
      delete process.env.MEGADJ_TEST_NONEMPTY;
    }
  });
});
