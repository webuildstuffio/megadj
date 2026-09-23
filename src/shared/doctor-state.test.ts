import { describe, expect, test } from "bun:test";
import { cueKindResult, playlistXmlResult } from "./doctor-state";

describe("doctor cue-kind health", () => {
  test("protects legitimate memory cues when no incident rows remain", () => {
    const result = cueKindResult({
      ran: true,
      kindZero: 12,
      incidentKindZero: 0,
      kinds: { "0": 12, "1": 24 },
    });

    expect(result.ok).toBe(true);
    expect(result.detail).toContain("12 legitimate memory cue(s) protected");
    expect(result.fix).toBeUndefined();
  });

  test("fails only for provenance-matching broken intake cues", () => {
    const result = cueKindResult({
      ran: true,
      kindZero: 12,
      incidentKindZero: 2,
      kinds: { "0": 12, "1": 24 },
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("2 Sep 12 intake cue(s)");
    expect(result.fix).toContain("--restamp --apply --yes");
  });
});

describe("F7 playlist-XML output contract (#323)", () => {
  // 3437a574 reworded the F7 detail from the whole-DB "playlist(s)
  // missing XML NODEs" to the agent-managed scope — any automation that
  // parsed the old line misfires. These pins ARE the contract: a semantic
  // change to the fix line (the command automation greps for) must fail
  // here loudly, not silently strand a parser.

  test("reports the agent-managed scope and the one repair verb", () => {
    const result = playlistXmlResult({
      ran: true,
      playlistsMissingXml: 3,
      playlistRows: 166,
    });
    expect(result.ok).toBe(false);
    // The scope word: the fix repairs AGENT-MANAGED playlists only.
    expect(result.detail).toContain(
      "agent-managed playlist(s) missing XML NODEs",
    );
    // The one repair command — unchanged verb, changed scope.
    expect(result.fix).toBe(
      "run: megadj rb-playlist reconcile <drive> --apply --yes (rekordbox quit)",
    );
  });

  test("green state names the scope, never a whole-DB claim", () => {
    const result = playlistXmlResult({
      ran: true,
      playlistsMissingXml: 0,
      playlistRows: 180,
    });
    expect(result.ok).toBe(true);
    expect(result.detail).toContain(
      "all agent-managed playlists have XML NODEs",
    );
    expect(result.detail).toContain("180 DB rows");
    expect(result.fix).toBeUndefined();
  });

  test("a negative count is UNKNOWN, never a silent pass", () => {
    const result = playlistXmlResult({
      ran: true,
      playlistsMissingXml: -1,
      playlistRows: 180,
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("UNKNOWN");
    expect(result.fix).toBeUndefined();
  });

  test("unmountable drive skips honestly", () => {
    const result = playlistXmlResult({
      ran: false,
      error: "master DB not found",
      playlistsMissingXml: 0,
      playlistRows: 0,
    });
    expect(result.ok).toBe(true);
    expect(result.detail).toBe("skipped — master DB not found");
    expect(result.fix).toBeUndefined();
  });
});
