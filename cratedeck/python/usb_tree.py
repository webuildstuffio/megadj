#!/usr/bin/env python3
"""CrateDeck USB bridge — parses `ioreg -p IOUSB -a -l` (XML plist, which
plutil refuses to JSON-convert because of <data> values) using the system
python3 + plistlib. No third-party deps.

Output: JSON {"ok": true, "devices": [{product, serial, vendor, locationId,
portKey}]} — portKey is the chain of ancestor product names plus the
@locationID (stable per physical port).
"""

import json
import plistlib
import subprocess
import sys


def walk(node, path, out):
    if isinstance(node, dict):
        if "kUSBProductString" in node:
            prod = str(node["kUSBProductString"]).strip()
            loc = node.get("locationID")
            serial = node.get("kUSBSerialNumberString")
            vendor = node.get("kUSBVendorString")
            out.append(
                {
                    "product": prod,
                    "serial": serial.decode(errors="replace") if isinstance(serial, bytes) else serial,
                    "vendor": vendor.strip() if isinstance(vendor, str) else vendor,
                    "locationId": loc,
                    "portKey": f"{'/'.join(path)}/{prod}@{loc:x}" if loc is not None else f"{'/'.join(path)}/{prod}",
                }
            )
            inner = path + [prod]
        else:
            inner = path
        for key, val in node.items():
            if not key.startswith("kUSB"):
                walk(val, inner, out)
    elif isinstance(node, list):
        for item in node:
            walk(item, path, out)


def main() -> int:
    raw = subprocess.run(
        ["ioreg", "-p", "IOUSB", "-a", "-l"], capture_output=True, check=False
    ).stdout
    tree = plistlib.loads(raw)
    devices: list = []
    walk(tree, [], devices)
    print(json.dumps({"ok": True, "devices": devices}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
