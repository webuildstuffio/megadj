import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { basename, join } from "node:path";
import type { CrateConfig } from "../src/config";
import {
  makeEnqueueDriveJob,
  resolveMountPoint,
} from "../src/drive_job_routes";
import type { Drive } from "../shared/types";

function config(volumesRoot: string): CrateConfig {
  return { volumesRoot } as CrateConfig;
}

function mountedDrive(name: string): Drive {
  return {
    id: "drive-1",
    volume_uuid: null,
    name,
    nickname: null,
    photo_path: null,
    capacity_bytes: 0,
    fs: null,
    vendor: null,
    model: null,
    usb_serial: null,
    role: "unknown",
    first_seen_at: 0,
    last_seen_at: 0,
    last_port_key: null,
    link_bps: null,
    plug_count: 1,
    mounted: true,
    state: "mounted",
    last_snapshot_json: null,
    predecessor_id: null,
    verify_report_json: null,
  };
}

test("resolveMountPoint returns a readable volume contained by volumesRoot", () => {
  const root = mkdtempSync("/tmp/cratedeck-volumes-");
  const volume = join(root, "DJMASTER");
  mkdirSync(volume);

  expect(resolveMountPoint(config(root), "DJMASTER")).toBe(
    realpathSync(volume),
  );
});

test("resolveMountPoint rejects traversal into a sibling-prefix directory", () => {
  const parent = mkdtempSync("/tmp/cratedeck-mount-parent-");
  const root = join(parent, "Volumes");
  const sibling = join(parent, "Volumes-escape");
  mkdirSync(root);
  mkdirSync(sibling);

  expect(() =>
    resolveMountPoint(config(root), `../${basename(sibling)}`),
  ).toThrow("outside configured volumes root");
});

test("resolveMountPoint rejects absolute names and symlink escapes", () => {
  const root = mkdtempSync("/tmp/cratedeck-volumes-");
  const outside = mkdtempSync("/tmp/cratedeck-outside-");
  symlinkSync(outside, join(root, "escaped"));

  expect(() => resolveMountPoint(config(root), outside)).toThrow(
    "outside configured volumes root",
  );
  expect(() => resolveMountPoint(config(root), "escaped")).toThrow(
    "outside configured volumes root",
  );
});

test("enqueue rejects a persisted traversal name before creating a job", async () => {
  const parent = mkdtempSync("/tmp/cratedeck-enqueue-parent-");
  const root = join(parent, "Volumes");
  const sibling = join(parent, "Volumes-escape");
  mkdirSync(root);
  mkdirSync(sibling);
  let enqueued = false;
  const enqueue = makeEnqueueDriveJob({
    cfg: config(root),
    images: {
      async choose() {
        return "unused";
      },
      clear() {},
    },
    jobs: {
      enqueue() {
        enqueued = true;
        return { id: "job-1" };
      },
    },
    getDrive: () => mountedDrive(`../${basename(sibling)}`),
    json: (data, status = 200) => Response.json(data, { status }),
  });

  await expect(
    enqueue(
      new Request("http://127.0.0.1:7742/api/drives/drive-1/jobs", {
        method: "POST",
        body: JSON.stringify({ kind: "scan" }),
      }),
      "drive-1",
    ),
  ).rejects.toThrow("outside configured volumes root");
  expect(enqueued).toBe(false);
});
