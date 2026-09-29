/**
 * lastfm.test.ts — Tests for Last.fm tag mapping (B4.5).
 * Network tests skipped (no live API calls).
 */
import { describe, expect, test } from "bun:test";
import { mapToFamily } from "../genre/taxonomy-v3";

describe("lastfm tag → family mapping", () => {
  test("'deep house' → house", () => {
    expect(mapToFamily("deep house")).toBe("house");
  });

  test("'techno' → techno", () => {
    expect(mapToFamily("techno")).toBe("techno");
  });

  test("'drum and bass' → drum and bass", () => {
    expect(mapToFamily("drum and bass")).toBe("drum and bass");
  });

  test("'electronic' umbrella → null", () => {
    expect(mapToFamily("electronic")).toBeNull();
  });

  test("'trap' → hip hop", () => {
    expect(mapToFamily("trap")).toBe("hip hop");
  });

  test("unknown tag → null", () => {
    expect(mapToFamily("seen live")).toBeNull();
  });
});
