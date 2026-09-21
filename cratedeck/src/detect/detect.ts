// detect.ts — "what's plugged where": FSEvents on the volumes root +
// diskutil detail per mount event + USB tree via the Python seam.
// The USB-tree family (device discovery, port-key join, tree cache)
// lives in detect-usb.ts (#42 item 2 split); this module keeps the
// diskutil/plutil probe half and re-exports the USB seam for callers.
import { readdirSync, watch } from "node:fs";
import { spawnSync } from "node:child_process";
import { isRecord } from "../../../src/shared/leaf/guards";

import { invalidateUsbTreeCache, pickUsbDevice, usbTree } from "./usb";

export interface MountedVolume {
  name: string; // volume name
  mountPoint: string; // <root>/<name>
  disk: string | null; // disk7s1
  volumeUuid: string | null;
  capacityBytes: number;
  fs: string | null;
  usbSerial: string | null;
  vendor: string | null;
  model: string | null;
  portKey: string | null;
  /** Negotiated USB link rate (bits/s) from the ioreg tree; null = unknown. */
  linkBps: number | null;
  /** Whole-disk truth from `diskutil info` on the parent whole disk:
   *  `false` = physical hardware, `true` = image-backed (virtual),
   *  `null` = probe failed / unavailable (fixtures, degraded hosts). */
  virtual: boolean | null;
  /** Parent whole-disk bus protocol (e.g. "USB", "Disk Image"). */
  busProtocol: string | null;
  /** Parent whole-disk internality: `true` = inside the Mac, `null` = unknown. */
  internal: boolean | null;
}

const IGNORED = new Set([".DS_Store", "Macintosh HD"]);

/**
 * Physical-media gate — the single choke point every volume must pass before
 * it can become a drive. Only external physical hardware (USB/Thunderbolt
 * sticks and SSDs) qualifies. Everything else is rejected:
 * - image-backed volumes (virtual whole disks, disk-image bus, or an empty
 *   DeviceTreePath root) — measured live via `diskutil info` on the parent
 *   whole disk: virtual disks report VirtualOrPhysical "Virtual",
 *   BusProtocol "Disk Image", DeviceTreePath "IODeviceTree:/";
 * - internal volumes (inside the Mac) — they are never DJ hardware.
 * A failed/absent probe does NOT reject: fixtures and degraded hosts have no
 * diskutil answer at all, and a hard failure there would break the e2e path
 * and the drive rail on probe hiccups. Real macOS always answers for a
 * mounted volume, so images and internal volumes are still caught on hardware.
 */
export function isPhysicalExternal(v: {
  virtual: boolean | null;
  busProtocol: string | null;
  internal: boolean | null;
}): boolean {
  if (v.internal === true) return false; // inside the Mac
  if (v.virtual === true) return false; // image-backed (virtual whole disk)
  if (v.busProtocol && /disk image/i.test(v.busProtocol)) return false;
  return true; // physical external, or unknown-because-no-probe (fixtures)
}

// ---- the USB-tree cache lives in detect-usb.ts (#42 item 2 split) ----

export async function listMountedVolumes(
  cfgRoot = "/Volumes",
): Promise<MountedVolume[]> {
  invalidateUsbTreeCache(); // a sweep = one coherent tree snapshot
  let names: string[] = [];
  try {
    names = readdirSync(cfgRoot);
  } catch {
    return [];
  }
  const out: MountedVolume[] = [];
  for (const name of names) {
    if (IGNORED.has(name) || name.startsWith(".")) continue;
    const mountPoint = `${cfgRoot.replace(/\/$/, "")}/${name}`;
    try {
      readdirSync(mountPoint); // readable? else skip (mount in progress)
    } catch {
      continue;
    }
    const detail = await volumeDetail(name, mountPoint);
    if (!isPhysicalExternal(detail)) continue; // images/internal never register
    out.push(detail);
  }
  return out;
}

/** USB link classification from the negotiated rate. The gulf that matters:
 *  USB2 tops out at 480 Mbps (~40 MB/s theoretical, ~35 real) — a 4TB shelf
 *  on a USB2 link takes 3× longer for the same copy than on USB3. Thresholds
 *  match ioreg's UsbLinkSpeed values: 12M full, 480M high, 5G/10G/20G SS. */
export function usbLinkClass(
  linkBps: number | null,
): "usb2-or-less" | "usb3" | "usb3-fast" | "unknown" {
  if (linkBps === null || !Number.isFinite(linkBps)) return "unknown";
  if (linkBps >= 10_000_000_000) return "usb3-fast"; // 10/20 Gbps
  if (linkBps >= 5_000_000_000) return "usb3"; // 5 Gbps
  return "usb2-or-less"; // 480M / 12M / odd values — flag it
}

/** Whole-disk truth: virtual/physical + bus protocol, read from the parent
 *  whole disk (strip the slice suffix: disk7s1 → disk7). The volume slice
 *  alone cannot distinguish physical from image-backed — verified live:
 *  image slices omit VirtualOrPhysical/BusProtocol, their whole disks carry
 *  them. Image-backed volumes carry a root-only DeviceTreePath even when the
 *  whole-disk probe is degraded — treated as virtual too. */
function applyWholeDiskInfo(v: MountedVolume, treePath: string | null): void {
  const whole = v.disk ? v.disk.replace(/s\d+$/, "") : null;
  if (!whole) return;
  const pw = Bun.spawnSync(["diskutil", "info", "-plist", whole], {
    stdout: "pipe",
  });
  const winfo = parsePlist(pw.stdout.toString());
  v.virtual =
    winfo.VirtualOrPhysical === "Virtual"
      ? true
      : winfo.VirtualOrPhysical === "Physical"
        ? false
        : null;
  v.busProtocol =
    typeof winfo.BusProtocol === "string" ? winfo.BusProtocol : null;
  if (v.internal === null && typeof winfo.Internal === "boolean")
    v.internal = winfo.Internal;
  if (treePath && /^IODeviceTree:\/?$/.test(treePath)) v.virtual = true;
}

/** diskutil info for the volume slice itself: device, uuid, fs, capacity. */
function applyVolumeSliceInfo(
  v: MountedVolume,
  info: Record<string, unknown>,
): void {
  v.disk =
    typeof info.DeviceIdentifier === "string" ? info.DeviceIdentifier : null;
  v.volumeUuid = typeof info.VolumeUUID === "string" ? info.VolumeUUID : null;
  v.fs = typeof info.FileSystemType === "string" ? info.FileSystemType : null;
  const rawCapacity = info.TotalSize;
  const capacityBytes =
    typeof rawCapacity === "string" || typeof rawCapacity === "number"
      ? Number(rawCapacity)
      : 0;
  v.capacityBytes = Number.isFinite(capacityBytes) ? capacityBytes : 0;
  v.internal = typeof info.Internal === "boolean" ? info.Internal : null;
}

export async function volumeDetail(
  name: string,
  mountPoint: string,
): Promise<MountedVolume> {
  const v: MountedVolume = {
    name,
    mountPoint,
    disk: null,
    volumeUuid: null,
    capacityBytes: 0,
    fs: null,
    usbSerial: null,
    vendor: null,
    model: null,
    portKey: null,
    linkBps: null,
    virtual: null,
    busProtocol: null,
    internal: null,
  };
  let mediaName: string | null = null;
  let treePath: string | null = null;
  try {
    const p = Bun.spawnSync(["diskutil", "info", "-plist", mountPoint], {
      stdout: "pipe",
    });
    const info = parsePlist(p.stdout.toString());
    applyVolumeSliceInfo(v, info);
    const rawMediaName = info["Device / Media Name"] ?? info.DeviceMediaName;
    mediaName = typeof rawMediaName === "string" ? rawMediaName : null;
    treePath =
      typeof info.DeviceTreePath === "string" ? info.DeviceTreePath : null;
    applyWholeDiskInfo(v, treePath);
  } catch (e) {
    // a volume whose diskutil probe fails still appears on the rail (name +
    // mountpoint are already set) — but the degraded identity is reported.
    console.error(`diskutil info failed for ${mountPoint}`, e);
  }

  try {
    const usb = pickUsbDevice(await usbTree(), mediaName, treePath);
    if (usb) {
      v.usbSerial = usb.serial;
      v.vendor = usb.vendor;
      v.model = usb.product;
      v.portKey = usb.portKey;
      v.linkBps = usb.linkBps;
    }
  } catch (e) {
    console.error(`usb tree lookup failed for ${mountPoint}`, e);
  }
  return v;
}

/** Typed view of `diskutil info -plist` output (only the keys we read). */
export interface DiskutilInfo {
  DeviceIdentifier?: unknown;
  VolumeUUID?: unknown;
  FileSystemType?: unknown;
  TotalSize?: unknown;
  DeviceMediaName?: unknown;
  "Device / Media Name"?: unknown;
  DeviceTreePath?: unknown;
  [key: string]: unknown;
}

/** Guard the JSON emitted by plutil. A malformed subprocess payload is a
 * degraded hardware probe, but it must remain observable to the operator. */
export function parseDiskutilJson(out: string): DiskutilInfo {
  try {
    const value: unknown = JSON.parse(out || "{}");
    if (isRecord(value)) return value;
    console.error("diskutil plist JSON has an invalid object shape");
    return {};
  } catch (error) {
    console.error("diskutil plist JSON is malformed", error);
    return {};
  }
}

/** Robust plist reader: plutil converts JSON from stdin (node child_process
 *  delivers `input` reliably; Bun's spawnSync stdin pipe did not). No temp
 *  files — the old tmp-write+delete churn per volume per poll is gone. */
export function parsePlist(xml: string): DiskutilInfo {
  try {
    const r = spawnSync("plutil", ["-convert", "json", "-o", "-", "-"], {
      input: xml,
      encoding: "utf8",
    });
    if (r.status !== 0) {
      console.error(
        `plutil could not convert diskutil plist (exit ${r.status ?? "unknown"})`,
        r.stderr,
      );
      return {};
    }
    return parseDiskutilJson(r.stdout);
  } catch (error) {
    console.error("diskutil plist conversion failed", error);
    return {};
  }
}

/** Watch the volumes root; call onChange on any appearance/disappearance. */
export function watchVolumes(
  root: string,
  onChange: () => void,
): { stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  try {
    const w = watch(root, { persistent: true }, () => {
      // debounce bursts (macOS fires several events per mount)
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, 300);
    });
    return {
      stop: () => {
        if (timer) clearTimeout(timer);
        w.close();
      },
    };
  } catch {
    // fallback: pure 5s poll (watch unavailable for this root)
    poll = setInterval(onChange, 5000);
    return {
      stop: () => {
        if (poll) clearInterval(poll);
        if (timer) clearTimeout(timer);
      },
    };
  }
}
