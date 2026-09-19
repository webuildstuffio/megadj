import type { ArchiveState } from "../archive/state";
import { writeJson } from "./cli-output";
import { storageReport, printStorageReport } from "./storage";

/** One archive summary — both the human and --json renderers read this,
 * so the two surfaces can never drift apart. */
function summary(state: ArchiveState) {
  const counts = state.statusCounts();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const all = state.allTracks();
  const downloaded = all.filter((t) => t.status === "downloaded");
  const bytes = downloaded.reduce((a, t) => a + (t.file_size_bytes ?? 0), 0);
  // #258: the HIGHQ bar follows the source — SC's ceiling is 160k, so
  // judging SC rips against the 250k YT bar misflagged every honest rip.
  const highQ = downloaded.filter((t) => {
    if (t.bitrate_kbps === null) return true;
    return t.source === "soundcloud"
      ? t.bitrate_kbps >= 160
      : t.bitrate_kbps >= 250;
  });
  // #256: the "go get these properly" queue — links surfaced instead of
  // rips. Its own cohort, never folded into downloaded counts.
  const surfaced = all.filter((t) => t.status === "link_surfaced");
  return {
    total,
    counts,
    downloadedCount: downloaded.length,
    bytes,
    highQ: highQ.length,
    surfacedLinks: surfaced.length,
    runs: state.lastRuns(5),
  };
}

export function status(state: ArchiveState): void {
  const s = summary(state);
  const storage = storageReport(state);
  console.log("megadj archive status");
  console.log("=====================");
  console.log(`total tracks tracked: ${s.total}`);
  for (const [st, n] of Object.entries(s.counts)) {
    console.log(`  ${st.padEnd(20)} ${n}`);
  }
  console.log(`\narchive size: ${(s.bytes / 1e9).toFixed(2)} GB`);
  console.log(
    `high-quality tracks (>=250kbps, SC >=160k, or unprobed): ${s.highQ}/${s.downloadedCount}`,
  );
  if (s.surfacedLinks > 0) {
    console.log(
      `links surfaced (go through them instead of ripping): ${s.surfacedLinks} — megadj list --status link_surfaced`,
    );
  }
  if (s.runs.length > 0) {
    console.log("\nrecent runs:");
    for (const run of s.runs) {
      const when = run.started_at.slice(0, 16).replace("T", " ");
      console.log(
        `  ${when}  attempted=${run.attempted} downloaded=${run.downloaded} gone=${run.gone} failed=${run.failed} ${(run.bytes_downloaded / 1e6).toFixed(0)}MB`,
      );
    }
  }
  printStorageReport(storage, console.log);
}

export async function statusJson(state: ArchiveState): Promise<void> {
  const s = summary(state);
  const report = storageReport(state);
  await writeJson({
    total_tracks: s.total,
    by_status: s.counts,
    archive_bytes: s.bytes,
    high_quality: { count: s.highQ, of: s.downloadedCount },
    links_surfaced: s.surfacedLinks,
    recent_runs: s.runs,
    storage: report.storage,
    ledger_freshness: report.ledgerFreshness,
  });
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

function flagOf(t: {
  status: string;
  bitrate_kbps: number | null;
  codec?: string | null;
  source?: string | null;
}): string {
  // #258: the LOWQ floor is source-aware — SC rows judge against the
  // platform ceiling, not the YT bar (same rule as isLowq/lowqQueue).
  const isSc = t.source === "soundcloud";
  return t.status === "downloaded"
    ? t.bitrate_kbps && (isSc ? t.bitrate_kbps < 160 : t.bitrate_kbps < 250)
      ? "LOWQ"
      : "ok  "
    : t.status === "link_surfaced"
      ? "LINK" // #256: rip skipped on purpose — an official link exists
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
    // #256: a surfaced row carries its acquisition link on the next line —
    // the whole point is the user goes through it.
    if (t.status === "link_surfaced") {
      const detail = t.last_error ?? "";
      if (detail) console.log(`      ↳ ${detail.slice(0, 100)}`);
    }
  }
  console.log(`\n${tracks.length} track(s)`);
}

export async function listJson(
  state: ArchiveState,
  filter?: string,
): Promise<void> {
  const tracks = filterTracks(state, filter);
  await writeJson({ count: tracks.length, tracks });
}
