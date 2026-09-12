import { describe, expect, test } from "bun:test";
import { portView } from "../src/port_view";
import type { Drive } from "../shared/types";

function drive(overrides: Partial<Drive>): Drive {
  return {
    id: "drive-a",
    volume_uuid: null,
    name: "Drive A",
    capacity_bytes: 0,
    fs: null,
    vendor: null,
    model: null,
    usb_serial: null,
    role: "unknown",
    first_seen_at: 1,
    last_seen_at: 1,
    last_port_key: "/ports/1",
    plug_count: 1,
    mounted: false,
    state: "ghost",
    link_bps: null,
    last_snapshot_json: null,
    predecessor_id: null,
    verify_report_json: null,
    nickname: null,
    photo_path: null,
    ...overrides,
  };
}

describe("portView", () => {
  test("emits one row per physical port, preferring its mounted drive", () => {
    const ports = portView([
      drive({ id: "ghost", name: "Old crate", last_seen_at: 200 }),
      drive({
        id: "mounted",
        name: "New crate",
        mounted: true,
        last_seen_at: 100,
      }),
    ]);

    expect(ports).toEqual([
      expect.objectContaining({
        port_key: "/ports/1",
        drive_id: "mounted",
        drive_name: "New crate",
        mounted: true,
      }),
    ]);
  });

  test("falls back to the newest ghost when no drive is mounted", () => {
    const ports = portView([
      drive({ id: "older", last_seen_at: 10 }),
      drive({ id: "newer", last_seen_at: 20 }),
    ]);

    expect(ports[0]).toMatchObject({ drive_id: "newer", last_seen_at: 20 });
  });
});
