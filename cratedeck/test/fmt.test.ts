import { describe, expect, test } from "bun:test";
import { fmtDur, fmtEta } from "../../src/shared/leaf/fmt";
import { statsLine } from "../src/hygiene-audio";

describe("duration formatting", () => {
  test("carries rounded seconds into the next minute", () => {
    expect(fmtDur(59.6)).toBe("1:00");
    expect(fmtEta(59.6)).toBe("1m 0s");
    expect(fmtEta(119.6)).toBe("2m 0s");
    expect(
      statsLine({
        path: "p",
        exists: true,
        bytes: 1,
        durationS: 59.6,
        bitrateKbps: null,
        codec: null,
        sampleRate: null,
      }),
    ).toBe("1:00");
  });
});
