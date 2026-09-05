import { describe, expect, it } from "bun:test";
import { renderWeeklyPrep, type WeeklyPrepInput } from "../src/weekly_prep";
import type { PreflightReport } from "../src/preflight";
import type { Drive } from "../shared/types";

function drive(over: Partial<Drive> = {}): Drive {
  return {
    id: "d1",
    volume_uuid: "u1",
    name: "DJMASTER",
    nickname: null,
    photo_path: null,
    capacity_bytes: 0,
    fs: null,
    vendor: null,
    model: null,
    usb_serial: null,
    role: "master",
    first_seen_at: 0,
    last_seen_at: 0,
    last_port_key: null,
    plug_count: 0,
    mounted: true,
    state: "mounted",
    last_snapshot_json: null,
    predecessor_id: null,
    verify_report_json: null,
    ...over,
  };
}

function preflight(over: Partial<PreflightReport> = {}): PreflightReport {
  return {
    generated_at: 1_800_000_000_000,
    drives: [],
    mountedCount: 0,
    overall: "ready",
    summary: "no drives mounted",
    firmware_advisories: [],
    ...over,
  };
}

function input(over: Partial<WeeklyPrepInput> = {}): WeeklyPrepInput {
  return {
    preflight: preflight(),
    redundancy: { playlists: [] },
    ingest: {
      available: false,
      counts: {},
      total: 0,
      recent_tracks: [],
    },
    lowq: { available: false, tracks: [] },
    ...over,
  };
}

describe("weekly prep digest (O83)", () => {
  it("clean fleet renders a one-line all-clear", () => {
    const md = renderWeeklyPrep(
      input({
        preflight: preflight({
          overall: "ready",
          summary: "2 ready",
          mountedCount: 2,
        }),
        redundancy: { playlists: [] },
      }),
    );
    expect(md).toContain("🟢 ready — 2 ready");
    expect(md).toContain("All playlists fully protected");
    expect(md).toContain("Nothing below the bitrate floor");
  });

  it("attention drive renders its non-pass checks with fixes", () => {
    const md = renderWeeklyPrep(
      input({
        preflight: preflight({
          overall: "attention",
          summary: "1 need attention",
          mountedCount: 1,
          drives: [
            {
              drive: drive({ name: "DJMIRROR", role: "mirror" }),
              overall: "attention",
              checks: [
                {
                  id: "verify",
                  label: "Last verify",
                  status: "warn",
                  detail: "verified 9d ago (weekly schedule)",
                  fix: "Run Verify before the gig",
                },
                {
                  id: "grids",
                  label: "Beatgrid coverage",
                  status: "pass",
                  detail: "100% of tracks",
                },
              ],
              blockers: [],
            },
          ],
        }),
      }),
    );
    expect(md).toContain("## DJMIRROR — 🟡 attention");
    expect(md).toContain("▲ **Last verify** — verified 9d ago");
    expect(md).toContain("fix: Run Verify before the gig");
    // pass checks are collapsed — the digest is the exception list
    expect(md).not.toContain("Beatgrid coverage");
  });

  it("redundancy gaps listed with counts", () => {
    const md = renderWeeklyPrep(
      input({
        redundancy: {
          playlists: [
            { name: "Warmup", verdict: "pass", missing_count: 0 },
            { name: "Peak", verdict: "fail", missing_count: 3 },
          ],
        },
      }),
    );
    expect(md).not.toContain("Warmup");
    expect(md).toContain("✕ **Peak** — 3 track(s) below floor");
  });

  it("archive section shows counts + failed note + newest tracks", () => {
    const md = renderWeeklyPrep(
      input({
        ingest: {
          available: true,
          counts: { downloaded: 40, failed: 2 },
          total: 50,
          recent_tracks: [
            {
              title: "Awakening",
              artist: "Amelie Lens",
              updated_at: "2026-09-05T01:00:00Z",
            },
          ],
        },
      }),
    );
    expect(md).toContain("40 tracks downloaded of 50");
    expect(md).toContain("**2 failed**");
    expect(md).toContain("Amelie Lens — Awakening (2026-09-05)");
  });

  it("missing archive db degrades the section, not the digest", () => {
    const md = renderWeeklyPrep(input());
    expect(md).toContain("Archive DB not available");
    expect(md).toContain("# Weekly prep —");
  });

  it("lowq tail truncates at 10 with a and-more line", () => {
    const tracks = Array.from({ length: 13 }, (_, i) => ({
      title: `T${i}`,
      artist: "A",
      reason: "128 kbps",
    }));
    const md = renderWeeklyPrep(input({ lowq: { available: true, tracks } }));
    expect(md).toContain("…and 3 more");
    expect(md).toContain("T9");
    expect(md).not.toContain("T10");
  });
});
