import type { ArchiveState } from "../state";

/** One archive summary — both the human and --json renderers read this,
 * so the two surfaces can never drift apart. */
function summary(state: ArchiveState) {
  const counts = state.statusCounts();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const downloaded = state.allTracks().filter((t) => t.status === "downloaded");
  const bytes = downloaded.reduce((a, t) => a + (t.file_size_bytes ?? 0), 0);
  const highQ = downloaded.filter(
    (t) => t.bitrate_kbps === null || t.bitrate_kbps >= 250,
  );
  return {
    total,
    counts,
    downloadedCount: downloaded.length,
    bytes,
    highQ: highQ.length,
    runs: state.lastRuns(5),
  };
}

export function status(state: ArchiveState): void {
  const s = summary(state);
  console.log("megadj archive status");
  console.log("=====================");
  console.log(`total tracks tracked: ${s.total}`);
  for (const [status, n] of Object.entries(s.counts)) {
    console.log(`  ${status.padEnd(20)} ${n}`);
  }
  console.log(`\narchive size: ${(s.bytes / 1e9).toFixed(2)} GB`);
  console.log(
    `high-quality tracks (>=250kbps or unprobed): ${s.highQ}/${s.downloadedCount}`,
  );
  if (s.runs.length > 0) {
    console.log("\nrecent runs:");
    for (const run of s.runs) {
      const when = run.started_at.slice(0, 16).replace("T", " ");
      console.log(
        `  ${when}  attempted=${run.attempted} downloaded=${run.downloaded} gone=${run.gone} failed=${run.failed} ${(run.bytes_downloaded / 1e6).toFixed(0)}MB`,
      );
    }
  }
}

export function statusJson(state: ArchiveState): void {
  const s = summary(state);
  console.log(
    JSON.stringify(
      {
        total_tracks: s.total,
        by_status: s.counts,
        archive_bytes: s.bytes,
        high_quality: { count: s.highQ, of: s.downloadedCount },
        recent_runs: s.runs,
      },
      null,
      2,
    ),
  );
}

function filterTracks(state: ArchiveState, filter?: string) {
  const tracks = state.allTracks();
  return filter
    ? tracks.filter(
        (t) =>
          t.status === filter ||
          (t.title ?? "").toLowerCase().includes(filter.toLowerCase()) ||
          (t.artist ?? "").toLowerCase().includes(filter.toLowerCase()),
      )
    : tracks;
}

function flagOf(t: { status: string; bitrate_kbps: number | null }): string {
  return t.status === "downloaded"
    ? t.bitrate_kbps && t.bitrate_kbps < 250
      ? "LOWQ"
      : "ok  "
    : t.status === "gone"
      ? "GONE"
      : t.status === "failed"
        ? "FAIL"
        : "wait";
}

export function listTracks(state: ArchiveState, filter?: string): void {
  const tracks = filterTracks(state, filter);
  for (const t of tracks) {
    console.log(
      `${flagOf(t)}  ${(t.title ?? t.video_id).slice(0, 50).padEnd(52)} ${t.status === "downloaded" && t.format_id ? `f${t.format_id}` : ""}`,
    );
  }
  console.log(`\n${tracks.length} track(s)`);
}

export function listJson(state: ArchiveState, filter?: string): void {
  const tracks = filterTracks(state, filter);
  console.log(JSON.stringify({ count: tracks.length, tracks }, null, 2));
}
