// detect.ts — "what's plugged where": FSEvents on the volumes root +
// diskutil detail per mount event + USB tree via the Python seam.
import { readdirSync, watch } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

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
}

const IGNORED = new Set([".DS_Store", "Macintosh HD"]);

// ---- USB tree cache ---------------------------------------------------------
// The physical USB tree only changes on plug/unplug — exactly the events that
// trigger a reconcile sweep. Caching it per sweep turns every 5s poll from
// "diskutil + python + plutil per volume" into "one cheap diskutil per volume".
let usbTreeCache: { at: number; devices: UsbDevice[] } | null = null;
const USB_TREE_TTL_MS = 2_000;

export function invalidateUsbTreeCache(): void {
  usbTreeCache = null;
}

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
    out.push(await volumeDetail(name, mountPoint));
  }
  return out;
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
  };
  let mediaName: string | null = null;
  let treePath: string | null = null;
  try {
    const p = Bun.spawnSync(["diskutil", "info", "-plist", mountPoint], {
      stdout: "pipe",
    });
    const info = parsePlist(p.stdout.toString());
    v.disk = info.DeviceIdentifier ?? null;
    v.volumeUuid = info.VolumeUUID ?? null;
    v.fs = info.FileSystemType ?? null;
    v.capacityBytes = Number(info.TotalSize ?? 0);
    mediaName = info["Device / Media Name"] ?? info.DeviceMediaName ?? null;
    treePath = info.DeviceTreePath ?? null;
  } catch {}

  try {
    const usb = pickUsbDevice(await usbTree(), mediaName, treePath);
    if (usb) {
      v.usbSerial = usb.serial;
      v.vendor = usb.vendor;
      v.model = usb.product;
      v.portKey = usb.portKey;
    }
  } catch {}
  return v;
}

export interface UsbDevice {
  product: string;
  serial: string | null;
  vendor: string | null;
  locationId: number | null;
  portKey: string;
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
    try {
      devices = JSON.parse(p.stdout.toString()).devices ?? [];
    } catch {}
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
      const isDev = (d: UsbDevice) => !/hub/i.test(d.product);
      const byLoc = pool.find(
        (d) =>
          d.locationId !== null &&
          isDev(d) &&
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

/** Robust plist reader: plutil converts JSON from stdin (node child_process
 *  delivers `input` reliably; Bun's spawnSync stdin pipe did not). No temp
 *  files — the old tmp-write+delete churn per volume per poll is gone. */
export function parsePlist(xml: string): Record<string, any> {
  try {
    const r = spawnSync("plutil", ["-convert", "json", "-o", "-", "-"], {
      input: xml,
      encoding: "utf8",
    });
    if (r.status !== 0) return {};
    return JSON.parse(r.stdout || "{}");
  } catch {
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
