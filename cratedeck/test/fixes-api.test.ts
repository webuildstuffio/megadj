// fixes-api.test.ts — the /api/fixes family: routes answer from the
// last-scan cache (null until a scan ran) and enqueue jobs for scan/apply.
// Same shape as hygiene-api.test.ts; the engine itself is megadj's CLI
// (covered by src/commands/booth-fix*.test.ts) — this file only proves
// the CrateDeck wiring.
import { describe, expect, test } from "bun:test";
import { makeFixesRoutes, recordFixes } from "../src/fixes_routes";
import type { FixesPayload } from "../shared/fixes";

function makeApi(enqueued: string[] = []) {
  return makeFixesRoutes({
    enqueue: (kind) => {
      enqueued.push(kind);
      return { id: `job-${enqueued.length}` };
    },
    json: (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  });
}

describe("fixes routes (/api/fixes)", () => {
  test("GET before any scan answers null (never scanned), not an error", async () => {
    const api = makeFixesRoutes({
      enqueue: () => ({ id: "j" }),
      json: (d, s = 200) => new Response(JSON.stringify(d), { status: s }),
    });
    const res = api.list();
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  test("scan/apply enqueue the matching job kinds", async () => {
    const enqueued: string[] = [];
    const api = makeApi(enqueued);
    const scan = api.scan();
    expect(scan.status).toBe(200);
    expect(((await scan.json()) as { id: string }).id).toBe("job-1");
    api.apply();
    expect(enqueued).toEqual(["fixes-scan", "fixes-apply"]);
  });

  test("recordFixes caches the payload the GET serves (the job leg's write path)", async () => {
    const api = makeApi();
    const payload: FixesPayload = {
      fleet: ["xdj-xz", "cdj-3000", "cdj-2000nxs2"],
      checked: 3543,
      fixable: 157,
      applied: 0,
      rows: [
        {
          file: "/V/Contents/a .wav",
          gate: "booth-text",
          reasons: ["path-trailing-dot-or-space"],
          action: "rename",
          plan: "rename → a.wav",
          to: "/V/Contents/a.wav",
        },
      ],
      scannedPath: "/V/Contents",
    };
    recordFixes(payload);
    const served = (await api.list().json()) as FixesPayload;
    expect(served.fixable).toBe(157);
    expect(served.rows[0]!.action).toBe("rename");
    expect(served.scannedPath).toBe("/V/Contents");
  });
});
