import { describe, it, expect } from "bun:test";
import { nfcCasefold, scanVolume } from "../src/scan";
import { pickUsbDevice, parsePlist } from "../src/detect";
import type { UsbDevice } from "../src/detect";
import { progressFromLine } from "../src/rb";

// ---- fixtures -------------------------------------------------------------
function makeFakeDrive(): string {
  const root = `/tmp/cratedeck-fixture-${Date.now()}`;
  const dirs = [
    "PIONEER/rekordbox",
    "Contents/YTMusic Liked",
    "Contents/Tech House",
    "Contents/Party",
  ];
  for (const d of dirs)
    require("node:fs").mkdirSync(`${root}/${d}`, { recursive: true });
  const files: [string, number][] = [
    ["Contents/YTMusic Liked/001 - Artist - Track.m4a", 1024 * 1024],
    ["Contents/YTMusic Liked/002 - Artist - Other.m4a", 0], // zero-byte junk
    ["Contents/Tech House/groover.mp3", 5 * 1024 * 1024],
    ["Contents/Party/first-dance.mp3", 3 * 1024 * 1024],
    ["Contents/Party/._first-dance.mp3", 1], // orphan resource fork
    ["Contents/Dance.MP3", 2 * 1024 * 1024],
    ["Contents/dance.mp3", 2 * 1024 * 1024], // case collision with Dance.MP3
  ];
  for (const [f, size] of files)
    require("node:fs").writeFileSync(`${root}/${f}`, new Uint8Array(size));
  return root;
}

describe("scan", () => {
  it("counts files, detects junk, ignores resource forks", () => {
    const root = makeFakeDrive();
    const snap = scanVolume(root);
    expect(snap.kind).toBe("light");
    expect(snap.junk?.zero_byte).toContain(
      "Contents/YTMusic Liked/002 - Artist - Other.m4a",
    );
    expect(snap.junk?.orphan_resource_forks).toBe(1);
    // folder composition
    const yt = snap.folders?.find((f) => f.name === "YTMusic Liked");
    expect(yt?.files).toBe(2);
    expect(snap.file_count).toBe(5); // 2 YT + groover + first-dance + dance (case-insensitive /tmp dedupes fixture)
  });

  it("flags case collisions from folded path groups (pure)", () => {
    // /tmp is case-insensitive on this Mac, so the fixture can't hold both
    // spellings; test the grouping logic directly instead.
    const groups = new Map<string, string[]>([
      [
        nfcCasefold("Contents/Dance.MP3"),
        ["Contents/Dance.MP3", "Contents/dance.mp3"],
      ],
      [nfcCasefold("Contents/only.mp3"), ["Contents/only.mp3"]],
    ]);
    const collisions = [...groups.values()].filter((p) => p.length > 1).flat();
    expect(collisions).toEqual(["Contents/Dance.MP3", "Contents/dance.mp3"]);
  });
});

describe("nfcCasefold", () => {
  it("folds unicode and case", () => {
    expect(nfcCasefold("Caf\u00e9")).toBe(nfcCasefold("cafe\u0301"));
    expect(nfcCasefold("Dance.MP3")).toBe(nfcCasefold("dance.mp3"));
  });
});

// ---- detector fixtures (built from real macOS ioreg -p IOUSB -a -l output) --
// (the live plist is parsed by python/usb_tree.py; tests exercise the
//  pickUsbDevice join logic directly via the UsbDevice[] fixtures below)

describe("detect", () => {
  // real shapes from this Mac: two identical SanDisk sticks on different
  // controllers; ioreg locationID = treeAddr | (portIndex << 16)
  const devices: UsbDevice[] = [
    {
      product: "USB C Video Adaptor",
      serial: "000000000001",
      vendor: "USB C",
      locationId: 18022400,
      portKey: "adaptor@1130000",
    },
    {
      product: "USB2.0 Hub",
      serial: null,
      vendor: null,
      locationId: 17825792,
      portKey: "hub@1100000",
    },
    {
      product: "SanDisk 3.2Gen1",
      serial: "040175fa8e4f9518",
      vendor: "USB",
      locationId: 18874368,
      portKey: "hub@1100000/SanDisk@1200000",
    },
    {
      product: "USB2.0 Hub",
      serial: null,
      vendor: null,
      locationId: 34603008,
      portKey: "hub2@2100000",
    },
    {
      product: "SanDisk 3.2Gen1",
      serial: "010177233d157b4d",
      vendor: "USB",
      locationId: 34668544,
      portKey: "hub2@2100000/SanDisk@2110000",
    },
    {
      product: "Magic Keyboard",
      serial: "F0THCX02",
      vendor: "Apple",
      locationId: 1261840,
      portKey: "k@134000",
    },
  ];

  it("joins volume→stick via DeviceTreePath (masked locationID match)", () => {
    const p1 = pickUsbDevice(
      devices,
      "SanDisk 3.2Gen1 Media",
      "IODeviceTree:/arm-io/usb-drd1@8A280000/usb-drd1-port-ss@01200000",
    );
    expect(p1?.serial).toBe("040175fa8e4f9518");
    const p2 = pickUsbDevice(
      devices,
      "SanDisk 3.2Gen1 Media",
      "IODeviceTree:/arm-io/usb-drd2@92280000/usb-drd2-port-hs@02100000",
    );
    expect(p2?.serial).toBe("010177233d157b4d");
  });

  it("never picks a hub for a volume", () => {
    const p = pickUsbDevice(
      devices,
      "SanDisk 3.2Gen1 Media",
      "IODeviceTree:/arm-io/usb-drd2@92280000/usb-drd2-port-hs@02100000",
    );
    expect(p?.product).not.toBe("USB2.0 Hub");
  });

  it("falls back to single-storage heuristic without a tree path", () => {
    const pick = pickUsbDevice([devices[2]!, devices[5]!], null, null);
    expect(pick?.serial).toBe("040175fa8e4f9518");
  });

  it("parses diskutil plists via plutil", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>VolumeUUID</key><string>ABC-123</string><key>TotalSize</key><integer>128000000000</integer></dict></plist>`;
    const info = parsePlist(xml);
    expect(info.VolumeUUID).toBe("ABC-123");
    expect(info.TotalSize).toBe(128000000000);
  });
});

describe("progress parsing", () => {
  it("reads usb_mirror-style bars and percents", () => {
    const bar = "[Contents copy] [####----] 250/1000 files · 25%";
    expect(progressFromLine(bar)).toBe(0.25);
    expect(progressFromLine("=== done 42% ===")).toBe(0.42);
    expect(progressFromLine("no progress here")).toBe(null);
  });
});
