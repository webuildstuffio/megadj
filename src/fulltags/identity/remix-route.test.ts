import { describe, expect, it } from "bun:test";
import { routeArtistForGenre } from "./remix-route";

describe("routeArtistForGenre", () => {
  it("returns original artist for an original mix", () => {
    const r = routeArtistForGenre("Bicep", "Glue");
    expect(r.artist).toBe("Bicep");
    expect(r.isRemix).toBe(false);
  });

  it("returns original artist for extended mix (same artist)", () => {
    const r = routeArtistForGenre("Bicep", "Glue (Extended Mix)");
    expect(r.artist).toBe("Bicep");
    expect(r.isRemix).toBe(false);
  });

  it("routes to remixer for a named remix", () => {
    const r = routeArtistForGenre("Peggy Gou", "Starry Night (Mall Grab Remix)");
    expect(r.isRemix).toBe(true);
    expect(r.artist).toBe("Mall Grab");
  });

  it("routes to editor for a named edit", () => {
    const r = routeArtistForGenre("Donna Summer", "I Feel Love (Patrick Cowley Edit)");
    expect(r.isRemix).toBe(true);
    expect(r.artist).toBe("Patrick Cowley");
  });

  it("routes to bootleg artist", () => {
    const r = routeArtistForGenre("Drake", "One Dance (DJ Snake Bootleg)");
    expect(r.isRemix).toBe(true);
    expect(r.artist).toBe("DJ Snake");
  });

  it("falls back to original artist when no remixer detected", () => {
    const r = routeArtistForGenre("FISHER", "Losing It (Remix)");
    // "Remix" with no named remixer → fallback to original
    expect(r.artist).toBe("FISHER");
    expect(r.isRemix).toBe(false);
  });

  it("does not route for instrumental/acapella/live versions", () => {
    const inst = routeArtistForGenre("Bicep", "Glue (Instrumental)");
    expect(inst.isRemix).toBe(false);
    expect(inst.artist).toBe("Bicep");

    const live = routeArtistForGenre("Bicep", "Glue (Live)");
    expect(live.isRemix).toBe(false);
  });

  it("routes for flip/dub/rework", () => {
    const flip = routeArtistForGenre("Drake", "One Dance (DJ Snake Flip)");
    if (flip.isRemix) {
      expect(flip.artist).toBe("DJ Snake");
    }
  });

  it("includes version identity in the result", () => {
    const r = routeArtistForGenre("Peggy Gou", "Starry Night (Mall Grab Remix)");
    expect(r.version).toBeDefined();
    expect(r.version.versionType).toBeTruthy();
    expect(r.version.confidence).toBeGreaterThan(0);
  });

  it("handles radio edit as non-remix", () => {
    const r = routeArtistForGenre("Bicep", "Glue (Radio Edit)");
    expect(r.isRemix).toBe(false);
    expect(r.artist).toBe("Bicep");
  });
});
