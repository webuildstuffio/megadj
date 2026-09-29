/**
 * traxsource.test.ts — Tests for DJ store genre mapping (B4.3).
 */
import { describe, expect, test } from "bun:test";
import { mapStoreGenre } from "./traxsource";

describe("mapStoreGenre", () => {
  describe("traxsource", () => {
    test("deep house → house", () => {
      expect(mapStoreGenre("traxsource", "Deep House")).toBe("house");
    });
    test("tech house → tech house", () => {
      expect(mapStoreGenre("traxsource", "Tech House")).toBe("tech house");
    });
    test("melodic house & techno → techno", () => {
      expect(mapStoreGenre("traxsource", "Melodic House & Techno")).toBe(
        "techno",
      );
    });
    test("drum & bass → drum and bass", () => {
      expect(mapStoreGenre("traxsource", "Drum & Bass")).toBe("drum and bass");
    });
  });

  describe("juno", () => {
    test("jungle → drum and bass", () => {
      expect(mapStoreGenre("juno", "Jungle")).toBe("drum and bass");
    });
    test("garage → garage", () => {
      expect(mapStoreGenre("juno", "Garage")).toBe("garage");
    });
    test("hip hop → hip hop", () => {
      expect(mapStoreGenre("juno", "Hip Hop")).toBe("hip hop");
    });
  });

  describe("beatsource", () => {
    test("hip-hop → hip hop", () => {
      expect(mapStoreGenre("beatsource", "Hip-Hop")).toBe("hip hop");
    });
    test("afrobeats → afrobeats", () => {
      expect(mapStoreGenre("beatsource", "Afrobeats")).toBe("afrobeats");
    });
    test("reggaeton → latin", () => {
      expect(mapStoreGenre("beatsource", "Reggaeton")).toBe("latin");
    });
  });

  describe("fallback", () => {
    test("unknown genre falls back to taxonomy", () => {
      expect(mapStoreGenre("traxsource", "psytrance")).toBe("trance");
    });
    test("truly unknown → null", () => {
      expect(mapStoreGenre("juno", "Spoken Word")).toBeNull();
    });
  });
});
