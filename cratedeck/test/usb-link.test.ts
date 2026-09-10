// usb-link.test.ts — the USB 2.0 vs 3.0 link flag (Sep 10 sweep). SHELF1's
// 6-hour rekordbox relocate prompted this: bandwidth wasn't the bottleneck
// (62 MB/s measured = USB3-class), but nothing in the product TOLD you that.
// These tests pin the classification + the minimal probe's contract.
import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { usbLinkClass } from "../src/detect";
import { speedProbe } from "../src/bench";

describe("usbLinkClass", () => {
  it("classifies the negotiated rates from ioreg", () => {
    expect(usbLinkClass(480_000_000)).toBe("usb2-or-less");
    expect(usbLinkClass(12_000_000)).toBe("usb2-or-less");
    expect(usbLinkClass(5_000_000_000)).toBe("usb3");
    expect(usbLinkClass(10_000_000_000)).toBe("usb3-fast");
    expect(usbLinkClass(20_000_000_000)).toBe("usb3-fast");
  });

  it("unknown stays unknown (never faked healthy)", () => {
    expect(usbLinkClass(null)).toBe("unknown");
    expect(usbLinkClass(Number.NaN)).toBe("unknown");
  });
});

describe("speedProbe", () => {
  const dir = mkdtempSync(join(tmpdir(), "speedprobe-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads a known path when given one (no volume walk)", async () => {
    // 2MB of real bytes: the probe must read up to capMb but stop at EOF
    const big = join(dir, "big.aiff");
    writeFileSync(big, Buffer.alloc(2 * 1024 * 1024, 7));
    const r = await speedProbe(dir, 10, undefined, [big]);
    expect(r.bytes_read).toBe(2 * 1024 * 1024);
    expect(r.mbps).toBeGreaterThan(0);
  });

  it("falls back to a walk when known paths are gone", async () => {
    const iso = mkdtempSync(join(tmpdir(), "speedprobe-walk-"));
    try {
      writeFileSync(join(iso, "only.aiff"), Buffer.alloc(1_500_000, 3));
      const r = await speedProbe(iso, 10, undefined, [
        join(iso, "missing.aiff"),
      ]);
      expect(r.bytes_read).toBe(1_500_000);
    } finally {
      rmSync(iso, { recursive: true, force: true });
    }
  });

  it("caps at capMb (a 10MB probe never reads a whole 284MB file)", async () => {
    writeFileSync(join(dir, "huge.aiff"), Buffer.alloc(3 * 1024 * 1024, 5));
    const r = await speedProbe(dir, 1, undefined);
    expect(r.bytes_read).toBe(1024 * 1024); // exactly 1MB
  });

  it("errors honestly with nothing to read", async () => {
    const empty = mkdtempSync(join(tmpdir(), "speedprobe-empty-"));
    try {
      expect(speedProbe(empty, 10)).rejects.toThrow(
        "no audio files found to probe",
      );
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
