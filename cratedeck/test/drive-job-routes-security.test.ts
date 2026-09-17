import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { basename, join } from "node:path";
import type { CrateConfig } from "../src/config";
import {
  makeEnqueueDriveJob,
  photoUpload,
  resolveMountPoint,
} from "../src/drive_job_routes";
import { DRIVE_JOB_KINDS, type Drive } from "../shared/types";

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

test("enqueue accepts every DRIVE_JOB_KIND (incl. grid-health) and still rejects junk kinds", async () => {
  const root = mkdtempSync("/tmp/cratedeck-kinds-");
  mkdirSync(join(root, "SHELF1")); // resolveMountPoint requires a real dir
  const enqueuedKinds: string[] = [];
  const enqueue = makeEnqueueDriveJob({
    cfg: config(root),
    images: {
      async choose() {
        return "unused";
      },
      clear() {},
    },
    jobs: {
      enqueue(_driveId, kind) {
        enqueuedKinds.push(kind);
        return { id: "job-1" };
      },
    },
    getDrive: () => mountedDrive("SHELF1"),
    json: (data, status = 200) => Response.json(data, { status }),
  });
  const post = (kind: string) =>
    enqueue(
      new Request("http://127.0.0.1:7742/api/drives/drive-1/jobs", {
        method: "POST",
        body: JSON.stringify({ kind }),
      }),
      "drive-1",
    );
  // The regression: grid-health used to 400 here while the card, KIND_DOCS,
  // and the parity doc advertised `deckctl run SHELF1 grid-health`.
  for (const kind of DRIVE_JOB_KINDS) {
    const r = await post(kind);
    expect(r.status).toBe(200);
  }
  expect(enqueuedKinds).toContain("grid-health");
  const bad = await post("not-a-kind");
  expect(bad.status).toBe(400);
  expect(((await bad.json()) as { error: string }).error).toContain(
    "grid-health",
  );
});

// Issue #226: malformed JSON bodies are a CLIENT mistake — the route
// family's contract is 400 "invalid JSON body", never an opaque 500.
test("enqueue returns 400 (not 500) on a malformed JSON body", async () => {
  const root = mkdtempSync("/tmp/cratedeck-badjson-");
  mkdirSync(join(root, "SHELF1"));
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
        return { id: "job-1" };
      },
    },
    getDrive: () => mountedDrive("SHELF1"),
    json: (data, status = 200) => Response.json(data, { status }),
  });
  const r = await enqueue(
    new Request("http://127.0.0.1:7742/api/drives/drive-1/jobs", {
      method: "POST",
      body: "not json",
    }),
    "drive-1",
  );
  expect(r.status).toBe(400);
  expect(((await r.json()) as { error: string }).error).toContain(
    "invalid JSON body",
  );
});

test("photoUpload returns 400 (not 500) on a malformed JSON body", async () => {
  const r = await photoUpload(
    new Request("http://127.0.0.1:7742/api/drives/drive-1/photo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    }),
    "drive-1",
    {
      async choose() {
        return "unused";
      },
      clear() {},
    },
    (data, status = 200) => Response.json(data, { status }),
  );
  expect(r.status).toBe(400);
  expect(((await r.json()) as { error: string }).error).toContain(
    "invalid JSON body",
  );
});
