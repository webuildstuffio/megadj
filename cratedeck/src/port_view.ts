// port_view.ts — one current-or-most-recent drive per physical USB port.
// A port identifies a slot, not a drive: historic ghosts can share it after
// a swap and must not produce duplicate rail rows (or duplicate UI keys).
import type { Drive, PortInfo } from "../shared/types";

export function portView(drives: Drive[]): PortInfo[] {
  const byPort = new Map<string, Drive>();
  for (const drive of drives) {
    const portKey = drive.last_port_key;
    if (!portKey) continue;
    const prior = byPort.get(portKey);
    if (
      !prior ||
      (drive.mounted && !prior.mounted) ||
      (drive.mounted === prior.mounted &&
        drive.last_seen_at > prior.last_seen_at)
    )
      byPort.set(portKey, drive);
  }
  return [...byPort.entries()].map(([port_key, drive]) => ({
    port_key,
    label: null,
    drive_id: drive.id,
    drive_name: drive.nickname ?? drive.name,
    mounted: drive.mounted,
    last_seen_at: drive.last_seen_at,
  }));
}
