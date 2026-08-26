import { describe, expect, test } from "bun:test";
import { fmtBytes, fmtDur, ProgressBar } from "./progress";

describe("progress formatting", () => {
  test("fmtBytes units", () => {
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(2048)).toBe("2.0 KB");
    expect(fmtBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(fmtBytes(3 * 1024 ** 3)).toBe("3.0 GB");
  });

  test("fmtDur formats", () => {
    expect(fmtDur(-5)).toBe("00:00");
    expect(fmtDur(59)).toBe("00:59");
    expect(fmtDur(65)).toBe("01:05");
    expect(fmtDur(3671)).toBe("1:01:11");
  });
});

describe("ProgressBar non-TTY milestones", () => {
  test("close() prints summary even with zero updates", () => {
    const bar = new ProgressBar(10, "test");
    bar.close();
    // smoke: no throw; log output goes to console
  });

  test("update() past total clamps display only", () => {
    const bar = new ProgressBar(2, "t");
    bar.update(1, 1000);
    bar.update(1, 2000);
    bar.update(5, 0);
    bar.close();
  });
});
