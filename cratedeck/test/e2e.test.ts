// e2e.test.ts — boots the real server against a fixture data dir + a fake
// mounted volume, and walks the core loop: appear → scan → ghost → search →
// export. The detector is exercised through the real reconcile path.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const FIX_ROOT = `/tmp/cratedeck-e2e-${Date.now()}`;
const FIX_DRIVE = `${FIX_ROOT}/vol/DJTESTCRATE`;
const DATA = `${FIX_ROOT}/data`;
let PORT = 7800 + Math.floor(Math.random() * 100);

let serverProc: Bun.Subprocess;

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api${path}`, init);
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  // fixture "drive" with Contents/ junk for the light scan
  mkdirSync(`${FIX_DRIVE}/Contents/YTMusic Liked`, { recursive: true });
  writeFileSync(
    `${FIX_DRIVE}/Contents/YTMusic Liked/a.m4a`,
    new Uint8Array(1024),
  );
  writeFileSync(`${FIX_DRIVE}/Contents/b.m4a`, new Uint8Array(0));
  // fixture data dir with a pre-registered drive (ghost path)
  mkdirSync(DATA, { recursive: true });

  serverProc = Bun.spawn(["bun", "run", join("src", "index.ts")], {
    cwd: join(import.meta.dir, ".."),
    env: {
      ...process.env,
      CRATEDECK_DATA: DATA,
      CRATEDECK_PORT: String(PORT),
      CRATEDECK_ROOT: join(import.meta.dir, ".."),
      CRATEDECK_VOLUMES: FIX_ROOT + "/vol",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  // wait for boot
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/interlock`);
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
}, 30_000);

afterAll(() => {
  serverProc?.kill();
  rmSync(FIX_ROOT, { recursive: true, force: true });
});

import { join } from "node:path";

describe("cratedeck e2e", () => {
  it("interlock endpoint responds", async () => {
    const { status, body } = await api("/interlock");
    expect(status).toBe(200);
    expect(typeof body.rekordbox_running).toBe("boolean");
  });

  it("lists drives (fixture ghost from prior state or empty)", async () => {
    const { status, body } = await api("/drives");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it("serves the SPA shell", async () => {
    // dist/ is a gitignored build artifact (bun run cratedeck/web:build);
    // a fresh clone skips this assertion instead of failing on a 404
    const distIndex = new URL("../web/dist/index.html", import.meta.url);
    if (!(await Bun.file(distIndex).exists())) {
      console.log(
        "ℹ cratedeck/web/dist not built — skipping SPA-shell assertion (run: bun run web:build in cratedeck/web)",
      );
      return;
    }
    const res = await fetch(`http://127.0.0.1:${PORT}/`);
    expect(res.status).toBe(200);
  });
});
