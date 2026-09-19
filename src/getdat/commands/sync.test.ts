import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  beforeAll,
} from "bun:test";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { ArchiveState } from "../../archive/state";
import { RateLimiter, TrackGoneError } from "../ratelimit";
import { Downloader } from "../downloader";
import {
  newTotals,
  parsePlaylistOutput,
  setScSourceQueueImpl,
  settleDownload,
  statSizeSafe,
  sync,
  classifyMusic,
  type SyncOptions,
} from "./sync";
import { tempState } from "../../test-support/testutil";
import { ProgressBar } from "../../shared/progress";
import { SC_SOURCE } from "../soundcloud";
import type { YtdlpInfo } from "../../fulltags/write/metadata-build";

/** A real 1-second audio file — the preview guard ffprobes the landed
 *  path, so the fixture must carry actual media (written by the setup
 *  block below; ffmpeg is a repo dev dependency via media-probe). */
const PREVIEW_FIXTURE = "/tmp/megadj-preview-guard-test.m4a";

const testYtdlpInfo = (over: Partial<YtdlpInfo> = {}): YtdlpInfo =>
  ({ ...over }) as YtdlpInfo;

/**
 * GetDat regression tests for the sync pipeline — run with an injected
 * playlist fetcher so no playlist network is touched, and a yt-dlp binary
 * path that cannot exist so probes fail fast (exit 1, no network). Guards:
 *  - `--json` stdout stays parseable (human logs suppressed) — PRINCIPLES §1
 *  - `dry-run` writes NOTHING to the state DB (no tracks, no run rows)
 *  - a real run still records tracks + a finished run row
 *  - probe failures land as `failed`, never crash the run
 */

let dir: string;
let state: ArchiveState;
const ts = tempState("megadj-sync-test-");

/** Injected fetcher signature matches sync's fetchPlaylistFn. */
const fakeFetch = async () => [{ id: "v1", title: "Track One" }];

function baseOpts(
  st: ArchiveState,
  over: Partial<SyncOptions> = {},
): SyncOptions {
  return {
    state: st,
    limiter: new RateLimiter({ minIntervalMs: 0, baseBackoffMs: 0 }),
    musicDir: "/tmp/megadj-sync-test",
    cookiesFromBrowser: null,
    cookiesFile: null,
    sources: [{ kind: "ytm-playlist", id: "LM", label: "liked" }],
    fetchPlaylistFn: fakeFetch,
    // nonexistent binary → probes fail fast (exit 1, no network), exactly
    // what this file's design comment promises; without it the two "real
    // run" tests hit YouTube and stall on the ~22s real yt-dlp round-trip.
    ytdlpBin: "megadj-no-such-bin",
    onProgress: () => {}, // silence human logs in tests
    ...over,
  };
}

beforeEach(() => {
  ({ dir, state } = ts.next());
});

/** The preview-guard tests ffprobe a REAL media file — synthesize one
 *  (1-second sine) if absent; ffmpeg is a repo dev dependency. */
beforeAll(() => {
  if (!Bun.file(PREVIEW_FIXTURE).size) {
    spawnSync(
      "ffmpeg",
      [
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1",
        "-c:a",
        "aac",
        "-t",
        "1",
        PREVIEW_FIXTURE,
        "-y",
      ],
      { timeout: 30_000 },
    );
  }
});

afterEach(() => {
  ts.done({ dir, state });
});

describe("sync (GetDat pipeline)", () => {
  test("missing landed file is not reported as a zero-byte success", async () => {
    const logs: string[] = [];
    const size = await statSizeSafe(
      `${dir}/landed-file-that-does-not-exist.m4a`,
      (message) => logs.push(message),
    );
    expect(size).toBeNull();
    expect(logs[0]).toContain("not statable");
  });

  test("malformed playlist output is reported as a playlist parse failure", () => {
    expect(() => parsePlaylistOutput("{not-json")).toThrow(
      "playlist output was not valid JSON",
    );
    expect(() => parsePlaylistOutput("[]")).toThrow(
      "playlist output was not valid JSON",
    );
  });

  // Probe failures go through withRetry (3 attempts × ~1.5s spawn resolution
  // of the intentionally-nonexistent binary) — give the tests room.
  test("dry-run writes nothing to the state DB", async () => {
    const logs: string[] = [];
    await sync(
      baseOpts(state, {
        dryRun: true,
        json: true,
        onProgress: (m) => logs.push(m),
      }),
    );
    // Injected onProgress is an explicit log sink — it still receives the
    // human logs even in json mode (suppression only applies to stdout).
    expect(logs.some((m) => m.includes("would download"))).toBe(true);
    expect(state.allTracks().length).toBe(0); // no playlist upserts
    expect(state.lastRuns(1).length).toBe(0); // no run rows
  });

  test("json mode emits exactly one JSON object on stdout (the summary)", async () => {
    // No injected onProgress + json: every human log line is suppressed and
    // the only console.log call is the summary object. Probes fail fast
    // (nonexistent ytdlpBin) — the track lands as failed, run still recorded.
    const originals = console.log;
    const lines: string[] = [];
    console.log = (...args: unknown[]) => lines.push(args.join(" "));
    try {
      await sync(
        baseOpts(state, {
          json: true,
          limit: 1,
          onProgress: undefined,
          fetchPlaylistFn: fakeFetch,
        }),
      );
    } finally {
      console.log = originals;
    }
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(parsed.command).toBe("sync");
    expect(parsed.dryRun).toBe(false);
    expect(parsed.attempted).toBe(1);
    expect(state.statusCounts()["failed"]).toBe(1);
    expect(state.lastRuns(1).length).toBe(1); // real run recorded
  }, 60_000);

  test("non-json run records the playlist and a finished run row", async () => {
    await sync(baseOpts(state, { limit: 1 }));
    expect(state.allTracks().length).toBe(1);
    const run = state.lastRuns(1)[0];
    expect(run?.attempted).toBe(1);
    expect(run?.finished_at).not.toBeNull();
  }, 60_000);

  test("probe failure marks the track failed, not gone", async () => {
    const d = new Downloader({
      musicDir: "/tmp/x",
      ytdlpBin: "megadj-no-such-bin",
    });
    try {
      await d.probe("abc123");
      expect.unreachable();
    } catch (e) {
      // Failure surfaces as a retryable error, not the permanent TrackGoneError.
      expect(e instanceof TrackGoneError).toBe(false);
    }
  }, 60_000);

  // super-sure pass, Sep 19: SC Go+ tracks serve ONLY a 30s preview;
  // yt-dlp downloads it and the run registered a 30s clip as a full
  // download (15 paro-set rows). The guard compares the landed file's
  // real duration against the probe payload's FULL duration.
  test("settleDownload marks a preview-length SC clip gone, never downloaded", async () => {
    state.upsertTrackFromPlaylist(
      "sc-preview-1",
      0,
      "Preview Victim",
      SC_SOURCE,
    );
    const logs: string[] = [];
    const bar = new ProgressBar(1, "test");
    const totals = newTotals();
    await settleDownload(
      baseOpts(state, { onProgress: (m) => logs.push(m) }),
      (m) => logs.push(m),
      bar,
      totals,
      { video_id: "sc-preview-1", title: "Preview Victim" },
      {
        status: "downloaded",
        filePath: PREVIEW_FIXTURE,
        formatId: "http_mp3_1_0_preview",
        info: {
          title: "Preview Victim",
          duration: 214, // the FULL track is 3:34 …
        },
      },
      true, // isSc
    );
    expect(totals.gone).toBe(1);
    expect(totals.downloaded).toBe(0);
    expect(state.trackById("sc-preview-1")?.status).toBe("gone");
    expect(state.trackById("sc-preview-1")?.last_error).toContain(
      "preview-only",
    );
  });

  test("settleDownload still marks a full-length SC file downloaded", async () => {
    state.upsertTrackFromPlaylist("sc-full-1", 0, "Full Track", SC_SOURCE);
    const bar = new ProgressBar(1, "test");
    const totals = newTotals();
    await settleDownload(
      baseOpts(state),
      () => {},
      bar,
      totals,
      { video_id: "sc-full-1", title: "Full Track" },
      {
        status: "downloaded",
        // 1s real file, full track declared 2s: the >90s full-duration
        // precondition is false, so the guard never fires — a short
        // ambient/interlude rip stays a legitimate download.
        filePath: PREVIEW_FIXTURE,
        formatId: "hls_aac_160k",
        info: { title: "Full Track", duration: 2 },
      },
      true,
    );
    expect(totals.downloaded).toBe(1);
    expect(state.trackById("sc-full-1")?.status).toBe("downloaded");
  });
});

describe("sync --sc-url validation (#255)", () => {
  // (the module-level `spawnSync` import now serves this describe —
  //  the old local require() redeclaration shadowed it)
  const CLI = join(import.meta.dir, "../../cli.ts");
  // Hermeticity (Sep 19): the spawned CLI resolves DB_PATH from MEGADJ_DB
  // (cli-env.ts). Without the override these tests wrote sync_runs rows
  // into the LIVE ~/.local/state/megadj/archive.db — empty run rows every
  // ~15s during any full-suite gate (the 21:41Z empty-runs incident). The
  // dead-slug test also hit real network (yt-dlp resolved the 404).
  const cliDir = tempState("megadj-sync-cli-").next().dir;
  const cliDb = join(cliDir, "archive.db");
  const runCli = (args: string[]) => {
    const proc = spawnSync(process.execPath, ["run", CLI, ...args], {
      encoding: "utf8",
      timeout: 60_000,
      env: {
        ...process.env,
        MEGADJ_DB: cliDb,
        MEGADJ_MUSIC_DIR: cliDb.replace(/\.db$/, "-music"),
        MEGADJ_COOKIES: "none",
      },
    });
    return {
      status: proc.status,
      stdout: proc.stdout ?? "",
      stderr: proc.stderr ?? "",
    };
  };

  test("a non-SC URL is a usage error (exit 2, zero work)", () => {
    const r = runCli([
      "sync",
      "--sc-url",
      "https://example.invalid/x",
      "--json",
    ]);
    expect(r.status).toBe(2);
    const last = r.stdout.trim().split("\n").at(-1) ?? "";
    const parsed = JSON.parse(last) as { command: string; error: string };
    expect(parsed.command).toBe("sync");
    expect(parsed.error).toContain("soundcloud.com");
  });

  test("a SC URL passes validation; a dead slug fails honestly (offline)", () => {
    // No network in the gate: the yt-dlp spawn fails fast, the failure is
    // CONTAINED — a permanent source-level error, exit 1 — never a crash.
    const r = runCli([
      "sync",
      "--sc-url",
      "https://soundcloud.com/definitely-not-a-real-artist-zz/definitely-not-a-real-track-zz",
      "--json",
    ]);
    expect(r.status !== null && [0, 1].includes(r.status)).toBe(true);
  });

  test("a run's queue is scoped to its own sources (the 2026-09-19 paro incident)", async () => {
    // The incident: a `--sc-url <set>` run attempted the 1,100 PRE-EXISTING
    // YT pending rows first — the unfiltered pendingTracks() queue ignored
    // which sources the run named. Their YT probes burned the backoff
    // ladder and marked 3 rows failed. The queue must filter to the run's
    // ledger-source labels.
    state.upsertTrackFromPlaylist("ytPending1", 0, null, "liked");
    state.upsertTrackFromPlaylist("ytPending2", 1, null, "liked-videos");
    state.upsertTrackFromPlaylist(
      "2278172975",
      0,
      null,
      "soundcloud:summer-2026",
    );
    state.upsertTrackFromPlaylist(
      "2291593025",
      1,
      null,
      "soundcloud:summer-2026",
    );
    const restore = setScSourceQueueImpl(async () => [
      { id: "2278172975", title: null, label: `soundcloud:summer-2026` },
      { id: "2291593025", title: null, label: `soundcloud:summer-2026` },
    ]);
    try {
      await sync(
        baseOpts(state, {
          sources: [
            {
              kind: "sc-set",
              url: "https://soundcloud.com/x/sets/summer-2026",
              label: "soundcloud",
            },
          ],
          json: true,
        }),
      );
    } finally {
      restore();
    }
    // Every ATTEMPTED row must be an SC row. The dead-binary probe marks
    // the two SC rows failed; the YT rows must remain untouched pending.
    const attempted = state
      .allTracks()
      .filter((t) => t.attempts > 0)
      .map((t) => t.video_id)
      .toSorted();
    expect(attempted).toStrictEqual(["2278172975", "2291593025"]);
    expect(state.trackById("ytPending1")?.status).toBe("pending");
    expect(state.trackById("ytPending2")?.status).toBe("pending");
  }, 60_000);
});

describe("classifyMusic gate — AI/sloppy-metadata uploads are music (#250)", () => {
  const opts = { musicOnly: true } as SyncOptions;

  test("the real PERC 30 false positive passes via its title", () => {
    // Live-measured Sep 19: categories ["People & Blogs"], personal
    // uploader, no artist field — only the title says "song".
    expect(
      classifyMusic(
        testYtdlpInfo({
          title: 'JUICE WRLD - "PERC 30" (FEAT. FUTURE) [AI]',
          categories: ["People & Blogs"],
          uploader: "some channel",
        }),
        opts,
      ),
    ).toBe(true);
  });

  test("AI markers + official-video/lyrics titles count as music", () => {
    for (const title of [
      "RAW WRLD - ANGELS & DEMONS [AI]",
      "Neural Dreams (AI Generated Song)",
      "Midnight City - Official Music Video",
      "Something (Official Visualizer)",
      "Track Title (Lyrics)",
      "Artist - Song (feat. Someone)",
    ]) {
      expect(
        classifyMusic(
          testYtdlpInfo({ title, categories: ["People & Blogs"] }),
          opts,
        ),
      ).toBe(true);
    }
  });

  test("the original signals still pass", () => {
    expect(classifyMusic(testYtdlpInfo({ categories: ["Music"] }), opts)).toBe(
      true,
    );
    expect(
      classifyMusic(
        testYtdlpInfo({ categories: [], uploader: "Artist - Topic" }),
        opts,
      ),
    ).toBe(true);
    expect(
      classifyMusic(testYtdlpInfo({ categories: [], artist: "X" }), opts),
    ).toBe(true);
  });

  test("genuinely non-music uploads still gate out", () => {
    for (const [title, cats] of [
      [
        "Virtual Characters Learn To Work Out…and Undergo Surgery",
        ["People & Blogs"],
      ],
      [
        "Eminem biggest ever freestyle in the world! Westwood",
        ["Entertainment"],
      ],
      ["My podcast episode 42", ["Comedy"]],
    ] as const) {
      expect(
        classifyMusic(testYtdlpInfo({ title, categories: [...cats] }), opts),
      ).toBe(false);
    }
  });

  test("gate off = everything passes (unchanged)", () => {
    expect(
      classifyMusic(testYtdlpInfo({ categories: ["Comedy"] }), {
        musicOnly: false,
      } as SyncOptions),
    ).toBe(true);
  });
});
