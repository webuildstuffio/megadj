import type { ArchiveState } from "../state";

export function status(state: ArchiveState): void {
  const counts = state.statusCounts();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const runs = state.lastRuns(5);

  console.log("megadj archive status");
  console.log("=====================");
  console.log(`total tracks tracked: ${total}`);
  for (const [status, n] of Object.entries(counts)) {
    console.log(`  ${status.padEnd(20)} ${n}`);
  }

  const downloaded = state.allTracks().filter((t) => t.status === "downloaded");
  const bytes = downloaded.reduce((a, t) => a + (t.file_size_bytes ?? 0), 0);
  console.log(`\narchive size: ${(bytes / 1e9).toFixed(2)} GB`);

  const highQ = downloaded.filter(
    (t) => t.bitrate_kbps === null || t.bitrate_kbps >= 250,
  );
  console.log(
    `high-quality tracks (>=250kbps or unprobed): ${highQ.length}/${downloaded.length}`,
  );

  if (runs.length > 0) {
    console.log("\nrecent runs:");
    for (const run of runs) {
      const when = run.started_at.slice(0, 16).replace("T", " ");
      console.log(
        `  ${when}  attempted=${run.attempted} downloaded=${run.downloaded} gone=${run.gone} failed=${run.failed} ${(run.bytes_downloaded / 1e6).toFixed(0)}MB`,
      );
    }
  }
}

export function listTracks(state: ArchiveState, filter?: string): void {
  const tracks = filterTracks(state, filter);

  for (const t of tracks) {
    const flag =
      t.status === "downloaded"
        ? t.bitrate_kbps && t.bitrate_kbps < 250
          ? "LOWQ"
          : "ok  "
        : t.status === "gone"
          ? "GONE"
          : t.status === "failed"
            ? "FAIL"
            : "wait";
    console.log(
      `${flag}  ${(t.title ?? t.video_id).slice(0, 50).padEnd(52)} ${t.status === "downloaded" && t.format_id ? `f${t.format_id}` : ""}`,
    );
  }
  console.log(`\n${tracks.length} track(s)`);
}

// ---- machine output (megadj status --json / list --json) --------------------
// Wire shapes intentionally mirror the human output — same fields, no prose.

export function statusJson(state: ArchiveState): void {
  const counts = state.statusCounts();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const downloaded = state.allTracks().filter((t) => t.status === "downloaded");
  const bytes = downloaded.reduce((a, t) => a + (t.file_size_bytes ?? 0), 0);
  const highQ = downloaded.filter(
    (t) => t.bitrate_kbps === null || t.bitrate_kbps >= 250,
  );
  console.log(
    JSON.stringify(
      {
        total_tracks: total,
        by_status: counts,
        archive_bytes: bytes,
        high_quality: { count: highQ.length, of: downloaded.length },
        recent_runs: state.lastRuns(5),
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

export function listJson(state: ArchiveState, filter?: string): void {
  const tracks = filterTracks(state, filter);
  console.log(JSON.stringify({ count: tracks.length, tracks }, null, 2));
}
