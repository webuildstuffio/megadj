import { afterAll, describe, it, expect } from "bun:test";
import { ageBucket, freeBytes, nfcCasefold, scanVolume } from "../src/scan";
import { buildChecks, overall } from "../src/report";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { Drive, SnapshotData } from "../shared/types";

const ROOT = `/tmp/cratedeck-scan-test-${process.pid}`;

function makeFakeDrive(): string {
  const dir = `${ROOT}/vol/Contents/loop`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/track one.m4a`, "x".repeat(2_000_000));
  writeFileSync(`${dir}/track two.mp3`, "y".repeat(1_000_000));
  writeFileSync(`${dir}/junk.wav`, "");
  writeFileSync(`${ROOT}/vol/Contents/._orphan`, "z");
  return `${ROOT}/vol`;
}

describe("scan space analysis", () => {
  const vol = makeFakeDrive();
  const snap = scanVolume(vol);

  it("counts files, bytes, junk as before", () => {
    expect(snap.file_count).toBe(3);
    expect(snap.total_bytes).toBe(3_000_000);
    expect(snap.junk?.zero_byte).toEqual(["Contents/loop/junk.wav"]);
    expect(snap.junk?.orphan_resource_forks).toBe(1);
  });

  it("breaks usage down by extension", () => {
    const exts = Object.fromEntries((snap.by_ext ?? []).map((e) => [e.ext, e]));
    expect(exts[".m4a"]?.files).toBe(1);
    expect(exts[".m4a"]?.bytes).toBe(2_000_000);
    expect(exts[".mp3"]?.bytes).toBe(1_000_000);
    expect(exts[".wav"]?.files).toBe(1);
  });

  it("lists largest files sorted desc", () => {
    expect(snap.largest?.[0]?.path).toBe("Contents/loop/track one.m4a");
    expect(snap.largest?.[0]?.bytes).toBe(2_000_000);
  });

  it("buckets audio age", () => {
    const total = Object.values(snap.age ?? {}).reduce((a, b) => a + b, 0);
    expect(total).toBe(2); // only audio files bucketed
  });

  it("reads free space via df", () => {
    const free = freeBytes(vol);
    expect(free).toBeGreaterThan(0);
  });

  it("ageBucket boundaries", () => {
    const now = Date.now();
    expect(ageBucket(now - 5 * 86_400_000, now)).toBe("fresh");
    expect(ageBucket(now - 60 * 86_400_000, now)).toBe("recent");
    expect(ageBucket(now - 400 * 86_400_000, now)).toBe("old");
    expect(ageBucket(now - 800 * 86_400_000, now)).toBe("ancient");
  });

  it("nfcCasefold unchanged", () => {
    expect(nfcCasefold("Dance.MP3")).toBe("dance.mp3");
  });

  afterAll(() => {
    rmSync(ROOT, { recursive: true, force: true });
  });
});

// ---- report checks -------------------------------------------------------

function drive(over: Partial<Drive> = {}): Drive {
  return {
    id: "x",
    volume_uuid: "x",
    name: "CRATE",
    nickname: null,
    photo_path: null,
    capacity_bytes: 120e9,
    fs: "FAT32",
    vendor: null,
    model: null,
    usb_serial: null,
    role: "unknown",
    first_seen_at: 1,
    last_seen_at: 2,
    last_port_key: null,
    plug_count: 1,
    mounted: true,
    state: "mounted",
    last_snapshot_json: null,
    predecessor_id: null,
    verify_report_json: null,
    ...over,
  };
}

function snap(over: Partial<SnapshotData> = {}): SnapshotData {
  return {
    kind: "full",
    taken_at: Date.now(),
    file_count: 100,
    capacity_bytes: 120e9,
    free_bytes: 30e9,
    grid_coverage: 1,
    onelibrary_rows: 100,
    pdb_live_rows: 100,
    ...over,
  };
}

const baseInput = {
  drive: drive(),
  snapshot: snap(),
  latestVerify: { ran_at: Date.now() - 1 * 86_400_000, ok: true },
  bench: [{ ran_at: 1, seq_mbps: 80 }],
  ledgerFiles: 10,
  ledgerStaleDays: 1,
  masterSnapshot: null,
  masterName: "M",
  isMirror: false,
  latestChecksum: { ran_at: Date.now() - 1 * 86_400_000, changed: 0 },
};

describe("report checks", () => {
  it("healthy drive passes the dual-db + grids + space + verify checks", () => {
    const checks = buildChecks(baseInput);
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(byId["dual-db"]?.status).toBe("pass");
    expect(byId["grids"]?.status).toBe("pass");
    expect(byId["space"]?.status).toBe("pass");
    expect(byId["speed"]?.status).toBe("pass");
    expect(overall(checks)).toBe("healthy");
  });

  it("fails the hardware gate when pdb rows diverge", () => {
    const checks = buildChecks({
      ...baseInput,
      snapshot: snap({ pdb_live_rows: 90 }),
    });
    const dual = checks.find((c) => c.id === "dual-db")!;
    expect(dual.status).toBe("fail");
    expect(dual.detail).toContain("90");
    expect(overall(checks)).toBe("critical");
  });

  it("warns on low beatgrid coverage and low space", () => {
    const checks = buildChecks({
      ...baseInput,
      snapshot: snap({ grid_coverage: 0.8, free_bytes: 4e9 }),
    });
    expect(checks.find((c) => c.id === "grids")!.status).toBe("fail");
    expect(checks.find((c) => c.id === "space")!.status).toBe("fail");
  });

  it("fails bitrot when checksums changed", () => {
    const checks = buildChecks({
      ...baseInput,
      latestChecksum: { ran_at: Date.now() - 1000, changed: 3 },
    });
    expect(checks.find((c) => c.id === "bitrot")!.status).toBe("fail");
    expect(overall(checks)).toBe("critical");
  });

  it("bitrot verdict is honest-unknown when checksum never ran", () => {
    const checks = buildChecks({ ...baseInput, latestChecksum: null });
    const bitrot = checks.find((c) => c.id === "bitrot")!;
    expect(bitrot.status).toBe("unknown");
    expect(bitrot.detail).toContain("unknown");
  });

  it("all-unknown checks degrade overall to unknown, never fake healthy", () => {
    const checks = buildChecks({
      ...baseInput,
      snapshot: null,
      latestVerify: null,
      bench: [],
      ledgerFiles: 0,
      latestChecksum: null,
    });
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((c) => c.status === "unknown")).toBe(true);
    expect(overall(checks)).toBe("unknown");
  });

  it("mirror parity: behind by a lot fails", () => {
    const checks = buildChecks({
      ...baseInput,
      isMirror: true,
      masterSnapshot: snap({ file_count: 200 }),
    });
    const mirror = checks.find((c) => c.id === "mirror")!;
    expect(mirror.status).toBe("fail");
    expect(mirror.detail).toContain("100");
  });

  it("mirror parity: superset passes", () => {
    const checks = buildChecks({
      ...baseInput,
      isMirror: true,
      masterSnapshot: snap({ file_count: 50 }),
    });
    expect(checks.find((c) => c.id === "mirror")!.status).toBe("pass");
  });

  it("verify freshness: 6d old passes, 8d old warns (7d auto-verify interval)", () => {
    const fresh = buildChecks({
      ...baseInput,
      latestVerify: { ran_at: Date.now() - 6 * 86_400_000, ok: true },
    });
    expect(fresh.find((c) => c.id === "verify")!.status).toBe("pass");
    const stale = buildChecks({
      ...baseInput,
      latestVerify: { ran_at: Date.now() - 8 * 86_400_000, ok: true },
    });
    const v = stale.find((c) => c.id === "verify")!;
    expect(v.status).toBe("warn");
    expect(v.fix).toContain("auto-verify");
  });

  it("artwork coverage check from dj stats", () => {
    const checks = buildChecks({
      ...baseInput,
      snapshot: snap({
        dj: {
          artwork_missing: 30,
          artwork_total: 100,
        },
      }),
    });
    const art = checks.find((c) => c.id === "artwork")!;
    expect(art.status).toBe("fail");
    expect(art.detail).toContain("70/100");
  });

  it("unknown verdict with no checks", () => {
    expect(overall([])).toBe("unknown");
  });
});
