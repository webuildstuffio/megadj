// drive-rename-json.test.ts — issue #226: the /api/drives/:id/name route
// must answer a malformed JSON body with the route family's 400 contract
// ("invalid JSON body"), never an opaque 500. Real fs + real sqlite, the
// same fixture pattern as images-drive-photo.test.ts.
import { describe, expect, test, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIX = `/tmp/cratedeck-rename-${Date.now()}`;
mkdirSync(join(FIX, "vol"), { recursive: true });
mkdirSync(join(FIX, "data"), { recursive: true });
process.env.CRATEDECK_DATA = join(FIX, "data");
process.env.CRATEDECK_VOLUMES = join(FIX, "vol");

// static imports resolve before env is set — config reads env at call time
const { DB } = await import("../db");
const { Registry } = await import("../registry");
const { makeDriveRoutes } = await import("../drive/routes");
const { loadConfig } = await import("../config");

const cfg = loadConfig(FIX);
const db = new DB(cfg.dbPath);
const registry = new Registry(cfg, db, () => {});
const json = (data: unknown, status = 200): Response =>
  Response.json(data, { status });

db.upsertDrive({
  id: "d1",
  volume_uuid: "d1",
  name: "DJRENAME",
  nickname: null,
  photo_path: null,
  capacity_bytes: 1000,
  fs: "exfat",
  vendor: null,
  model: null,
  usb_serial: null,
  role: "unknown",
  first_seen_at: Date.now(),
  last_seen_at: Date.now(),
  last_port_key: null,
  link_bps: null,
  plug_count: 0,
  mounted: true,
  state: "ghost",
  last_snapshot_json: null,
  predecessor_id: null,
  verify_report_json: null,
});

const routes = makeDriveRoutes({
  db,
  cfg,
  registry,
  images: {} as never, // /name never touches the image service
  reportDeps: {} as never, // nor the report builder
  extraPlayers: () => [],
  enqueueDriveJobFor: () => json({ error: "unused" }, 500),
  serveDriveImage: () => json({ error: "unused" }, 500),
  photoUpload: () => Promise.resolve(json({ error: "unused" }, 500)),
  hygieneBadge: () => null,
  shelfSweeps: { latestPerDrive: () => new Map() },
  json,
});

afterAll(() => {
  db.close();
  rmSync(FIX, { recursive: true, force: true });
});

describe("POST /api/drives/:id/name (#226)", () => {
  test("malformed JSON body → 400 invalid JSON body, not 500", async () => {
    const r = await routes.driveSubroute(
      new Request("http://127.0.0.1:7742/api/drives/d1/name", {
        method: "POST",
        body: "not json",
      }),
      new URL("http://127.0.0.1:7742/api/drives/d1/name"),
      "d1",
      "/name",
    );
    expect(r).not.toBeNull();
    expect(r?.status).toBe(400);
    const body = (await r!.json()) as { error: string };
    expect(body.error).toContain("invalid JSON body");
  });

  test("valid body still renames (guard the guard)", async () => {
    const r = await routes.driveSubroute(
      new Request("http://127.0.0.1:7742/api/drives/d1/name", {
        method: "POST",
        body: JSON.stringify({ nickname: "Gig Stick" }),
      }),
      new URL("http://127.0.0.1:7742/api/drives/d1/name"),
      "d1",
      "/name",
    );
    expect(r?.status).toBe(200);
    const body = (await r!.json()) as { ok: boolean };
    expect(body).toEqual({ ok: true });
    expect(db.getDrive("d1")?.nickname).toBe("Gig Stick");
  });
});
