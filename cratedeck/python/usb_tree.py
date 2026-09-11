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
from typing import Any


def walk(node: Any, path: list[str], out: list[dict[str, Any]]) -> None:
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
                    # Negotiated link rate in bits/s (UsbLinkSpeed from ioreg:
                    # 12M full, 480M high, 5G/10G/20G SuperSpeed+). The max
                    # link USB2 speed is 480M — anything above is USB3-class.
                    "linkBps": node.get("UsbLinkSpeed")
                    if isinstance(node.get("UsbLinkSpeed"), int)
                    else None,
                    "portKey": f"{'/'.join(path)}/{prod}@{loc:x}" if loc is not None else f"{'/'.join(path)}/{prod}",
                }
            )
            inner = [*path, prod]
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
    devices: list[dict[str, Any]] = []
    walk(tree, [], devices)
    json.dump({"ok": True, "devices": devices}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
