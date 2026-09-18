import { describe, expect, test } from "bun:test";
import { commandLog, fmtBytes, fmtDur, ProgressBar } from "./progress";

describe("progress formatting", () => {
  test("fmtBytes units", () => {
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(2048)).toBe("2.0 KB");
    expect(fmtBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(fmtBytes(3 * 1024 ** 3)).toBe("3.0 GB");
    expect(fmtBytes(-2048)).toBe("-2.0 KB");
    expect(fmtBytes(Number.NaN)).toBe("—");
  });

  test("fmtDur formats", () => {
    expect(fmtDur(-5)).toBe("00:00");
    expect(fmtDur(59)).toBe("00:59");
    expect(fmtDur(65)).toBe("01:05");
    expect(fmtDur(3671)).toBe("1:01:11");
    expect(fmtDur(Number.NaN)).toBe("00:00");
    expect(fmtDur(Number.POSITIVE_INFINITY)).toBe("00:00");
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

describe("commandLog --json routing", () => {
  test("json mode logs to stderr — never silent (intake job phase feed)", () => {
    const calls: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      calls.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const log = commandLog({ json: true });
      log("  [dupe] a.wav — twin of b.wav");
      log("done: 3 retagged");
    } finally {
      process.stderr.write = orig;
    }
    expect(calls.length).toBe(2);
    expect(calls[0]).toContain("[dupe]");
    expect(calls[1]).toContain("done:");
    expect(calls.every((c) => c.endsWith("\n"))).toBe(true);
  });

  test("non-json mode still logs to stdout via console.log", () => {
    const calls: string[] = [];
    const orig = console.log;
    console.log = ((...args: unknown[]) => {
      calls.push(args.join(" "));
    }) as typeof console.log;
    try {
      commandLog({})("plain line");
    } finally {
      console.log = orig;
    }
    expect(calls).toEqual(["plain line"]);
  });

  test("injected onProgress owns routing in both modes", () => {
    const seen: string[] = [];
    commandLog({ json: true, onProgress: (m) => seen.push(m) })("x");
    expect(seen).toEqual(["x"]);
  });
});
