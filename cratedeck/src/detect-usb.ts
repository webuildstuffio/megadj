// detect-usb.ts — the USB-tree family (#42 item 2 split, out of
// detect.ts): ioreg-backed device discovery via the python/usb_tree.py
// seam, the port-key join against diskutil's DeviceTreePath, and the
// 2s tree cache that keeps the 5s sweep from spawning python per volume.
import { join } from "node:path";
import { isFiniteNumber, isRecord, isUnknownArray } from "../shared/guards";

export interface UsbDevice {
  product: string;
  serial: string | null;
  vendor: string | null;
  locationId: number | null;
  portKey: string;
  /** Negotiated USB link rate in bits/s (ioreg UsbLinkSpeed), or null when
   *  ioreg didn't answer. Classify with usbLinkClass(). */
  linkBps: number | null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isUsbDevice(value: unknown): value is UsbDevice {
  return (
    isRecord(value) &&
    typeof value.product === "string" &&
    isNullableString(value.serial) &&
    isNullableString(value.vendor) &&
    isNullableFiniteNumber(value.locationId) &&
    typeof value.portKey === "string" &&
    isNullableFiniteNumber(value.linkBps)
  );
}

export function parseUsbTreeJson(out: string): UsbDevice[] {
  try {
    const value: unknown = JSON.parse(out);
    if (!isRecord(value) || !isUnknownArray(value.devices)) {
      console.error("usb_tree.py produced an invalid device payload");
      return [];
    }
    const devices = value.devices.filter(isUsbDevice);
    if (devices.length !== value.devices.length)
      console.error(
        `usb_tree.py skipped ${value.devices.length - devices.length} invalid device row(s)`,
      );
    return devices;
  } catch (error) {
    console.error("usb_tree.py produced invalid JSON", error);
    return [];
  }
}

// The physical USB tree only changes on plug/unplug — exactly the events that
// trigger a reconcile sweep. Caching it per sweep turns every 5s poll from
// "diskutil + python + plutil per volume" into "one cheap diskutil per volume".
let usbTreeCache: { at: number; devices: UsbDevice[] } | null = null;
const USB_TREE_TTL_MS = 2_000;

export function invalidateUsbTreeCache(): void {
  usbTreeCache = null;
}

/** Parse the USB tree via the Python seam (python/usb_tree.py).
 *  Result is cached briefly — the tree only changes on plug/unplug, and this
 *  used to spawn python3 on every volume detail (per poll). */
export function usbTree(): UsbDevice[] {
  const now = Date.now();
  if (usbTreeCache && now - usbTreeCache.at < USB_TREE_TTL_MS)
    return usbTreeCache.devices;
  const p = Bun.spawnSync(
    ["python3", join(import.meta.dir, "..", "python", "usb_tree.py")],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  let devices: UsbDevice[] = [];
  if (p.exitCode === 0) {
    devices = parseUsbTreeJson(p.stdout.toString());
  } else {
    console.error(
      `usb_tree.py exited ${p.exitCode}: ${p.stderr.toString().slice(0, 200)}`,
    );
  }
  usbTreeCache = { at: now, devices };
  return devices;
}

/** Choose the USB device a mounted volume belongs to. The join key is the
 *  physical port: diskutil's DeviceTreePath carries the USB port address
 *  (e.g. `usb-drd1-port-ss@01200000`). ioreg locationIDs share the tree
 *  address's high bits with an extra port-index bit (0x10000) inside the
 *  controller — so compare on mask 0xFF00FFFF, and only accept *storage*
 *  devices (hubs share the same high bits as their children). Falls back to
 *  storage-name heuristics when the tree path is unavailable. */
export function pickUsbDevice(
  devices: UsbDevice[],
  mediaName: string | null,
  treePath: string | null,
): UsbDevice | null {
  if (!devices.length) return null;
  const storage = devices.filter((d) =>
    /usb|drive|disk|storage|card|flash|ssd|extreme|ultra|fit|cruzer|toshiba|sandisk/i.test(
      d.product,
    ),
  );
  const pool = storage.length ? storage : devices;

  if (treePath) {
    const m = treePath.match(/@([0-9a-fA-F]+)\)?$/);
    if (m?.[1]) {
      const treeAddr = parseInt(m[1], 16);
      // ioreg locationID == treeAddr, or treeAddr with the port-index bit
      // (0x10000) set (verified: 0x01200000→0x1200000, 0x02100000→0x2110000).
      // Hubs sit at the tree address exactly, so prefer non-hub devices:
      // a stick under a hub carries the +0x10000 bit or a deeper chain.
      const byLoc = pool.find(
        (d) =>
          d.locationId !== null &&
          !/hub/i.test(d.product) &&
          (d.locationId === treeAddr || d.locationId === (treeAddr | 0x10000)),
      );
      if (byLoc) return byLoc;
    }
  }
  if (candidates_are_unique(pool)) return pool[0] ?? null;
  if (mediaName) {
    const med = mediaName
      .toLowerCase()
      .replace(/\s*media$/, "")
      .trim();
    const match = pool.find(
      (d) =>
        med.includes(d.product.toLowerCase()) ||
        d.product.toLowerCase().includes(med),
    );
    if (match) return match;
  }
  return pool[0] ?? null;
}

function candidates_are_unique(pool: UsbDevice[]): boolean {
  return pool.length === 1;
}
