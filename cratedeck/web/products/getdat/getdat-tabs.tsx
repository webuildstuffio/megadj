// getdat-tabs.tsx — the GetDatPage content tabs, extracted from
// GetDatPage.tsx (#90 page-monolith split): pipeline (download-machine
// status buckets + recent runs), backlog (retries + LOWQ upgrades), and
// sources (source census + the two-source diff). GetDatPage keeps the tab
// routing; IntakeTab.tsx and LibraryTab.tsx were already their own files.
// READ-ONLY (§4-A1): this page describes work, it never writes — every
// card names the megadj command that does the fixing.
import type {
  ArchiveIngestStatus,
  ArchiveLowqQueue,
  ArchiveSkipCensus,
} from "../../../shared/types";
import { api } from "../../ui/toast";
import { Icon } from "../../ui/icons";
import { FetchedGate, useFetched } from "../../ui/useFetched";
import { TabIntro } from "../../ui/InfoTip";
import {
  ListHead,
  DataTable,
  KVRows,
  KVRow,
  KVKey,
  KVVal,
  BarList,
  Truncated,
  CountStat,
} from "../../ui/data";
import { StatCard } from "../../ui/DrivePanels";
import {
  ArchiveAbsentGate,
  SectionHead,
  ShareBar,
  Verdict,
  TrackTitle,
} from "../shared";
import { fmtBytes } from "../../../../src/shared/leaf/fmt";

// ---- pipeline ---------------------------------------------------------------

export function PipelineTab() {
  const page = useFetched<[ArchiveIngestStatus, ArchiveSkipCensus]>(
    () =>
      Promise.all([
        api<ArchiveIngestStatus>("/api/archive/ingest-status"),
        api<ArchiveSkipCensus>("/api/archive/skip-census"),
      ]),
    [],
  );
  if (page.status !== "ok")
    return <FetchedGate page={page} loading="loading pipeline status…" />;
  const [ingest, skips] = page.data;
  const c = ingest.available ? ingest.counts : {};
  const entry = (k: string) => c[k] ?? 0;
  const inArchive = entry("downloaded");
  const broken = entry("failed") + entry("gone");
  const waiting = entry("pending");
  const movedOn = entry("deleted") + entry("skipped_not_music");
  const runs = ingest.recent_runs.filter(
    (r) => r.downloaded + r.failed + r.gone > 0,
  );

  return (
    <div>
      <TabIntro
        what="Your download pipeline: what's playable now, what's stuck, and how fast it grows."
        how="'In the archive' is music you can actually play and analyze — everything else is machinery: failed/gone downloads (retry backlog), pending queue, bookkeeping rows. Recent runs show the last sync passes with what each one landed."
        next="The fix for a big backlog lives in the Backlog tab; adding music is `megadj sync` / `megadj ingest` (CLI by design)."
      />
      {!ingest.available ? (
        <ArchiveAbsentGate />
      ) : (
        <>
          <Verdict
            cls={broken > 0 ? "warn" : "ok"}
            text={
              broken > 0
                ? `${broken.toLocaleString()} download${broken === 1 ? "" : "s"} need attention — the rest of the pipeline is healthy.`
                : "Pipeline is healthy — nothing stuck, nothing failed."
            }
            meta={`${inArchive.toLocaleString()} playable of ${ingest.total.toLocaleString()} tracked`}
          />
          <div class="statgrid">
            <StatCard
              v={inArchive.toLocaleString()}
              l="in the archive — playable"
              icon="disc"
            />
            <CountStat
              n={broken}
              l="failed + gone — the retry backlog"
              icon="warn"
              title="Failed downloads are retryable; gone-from-source needs a new source. Work it in the Backlog tab."
            />
            <StatCard
              v={waiting.toLocaleString()}
              l="waiting to download"
              icon="clock"
            />
            <StatCard
              v={movedOn.toLocaleString()}
              l="removed / skipped (bookkeeping)"
              icon="doc"
            />
          </div>

          <div class="card arch-what">
            <ShareBar
              total={ingest.total}
              segs={[
                {
                  n: inArchive,
                  cls: "have",
                  label: "in the archive",
                  title: "playable, analyzable, gig-eligible",
                },
                {
                  n: broken,
                  cls: "broken",
                  label: "broken (failed/gone)",
                  title: "the re-download backlog",
                },
                {
                  n: waiting,
                  cls: "waiting",
                  label: "waiting to download",
                  title: "still in the queue",
                },
                {
                  n: movedOn,
                  cls: "moved",
                  label: "removed/skipped",
                  title: "bookkeeping, not backlog",
                },
              ]}
            />
          </div>

          <SectionHead icon="history" title="Recent runs">
            <span class="sect-n">{runs.length}</span>
          </SectionHead>
          {runs.length === 0 ? (
            <div class="fleet-note">
              no active runs recorded yet — `megadj sync` makes one.
            </div>
          ) : (
            <DataTable
              columns={[
                {
                  key: "when",
                  head: "when",
                  min: 150,
                  cell: (r) => (
                    <>
                      {new Date(r.started_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {!r.finished_at && (
                        <span class="arch-pill warn">running</span>
                      )}
                    </>
                  ),
                  sortValue: (r) => r.started_at,
                },
                {
                  key: "attempted",
                  head: "attempted",
                  align: "end",
                  min: 90,
                  grow: 0,
                  cell: (r) => <span class="dt-sub">{r.attempted ?? "—"}</span>,
                  sortValue: (r) => r.attempted ?? -1,
                },
                {
                  key: "mins",
                  head: "took",
                  align: "end",
                  min: 56,
                  grow: 0,
                  cell: (r) =>
                    r.finished_at && r.attempted
                      ? `${Math.max(1, Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 60000))}m`
                      : "—",
                  sortValue: (r) =>
                    r.finished_at && r.attempted
                      ? Math.max(
                          1,
                          Math.round(
                            (new Date(r.finished_at).getTime() -
                              new Date(r.started_at).getTime()) /
                              60000,
                          ),
                        )
                      : null,
                },
                {
                  key: "landed",
                  head: "landed",
                  align: "end",
                  min: 84,
                  grow: 0,
                  cell: (r) => (
                    <>
                      <span class="ok-text">+{r.downloaded}</span>
                      {r.failed ? (
                        <span class="bad"> / {r.failed}✗</span>
                      ) : null}
                    </>
                  ),
                  sortValue: (r) => r.downloaded,
                },
                {
                  key: "volume",
                  head: "volume",
                  align: "end",
                  min: 70,
                  grow: 0,
                  cell: (r) => (
                    <span class="dt-sub">
                      {r.bytes_downloaded ? fmtBytes(r.bytes_downloaded) : "—"}
                    </span>
                  ),
                  sortValue: (r) => r.bytes_downloaded ?? -1,
                },
              ]}
              rows={runs}
              ariaLabel="Recent runs"
              copyName="Recent runs"
              copyLines={(rows) =>
                rows.map(
                  (r) =>
                    `${new Date(r.started_at).toISOString()} — attempted ${r.attempted ?? "?"}, +${r.downloaded}${r.failed ? ` / ${r.failed}✗` : ""}${r.bytes_downloaded ? `, ${fmtBytes(r.bytes_downloaded)}` : ""}`,
                )
              }
            />
          )}

          {skips.available && skips.buckets.length > 0 && (
            <>
              <SectionHead icon="doc" title="What the pipeline decided">
                <span class="sect-n">{skips.buckets.length}</span>
              </SectionHead>
              <div class="card">
                <ListHead
                  icon="doc"
                  title="Why rows didn't land"
                  n={skips.gone + skips.skipped}
                  hint="Every non-downloaded row records its reason. 'Gone from source' = the video vanished from YouTube Music (re-source it or drop it — those are Backlog work). 'Skipped (category: …)' = the ingest skipper deliberately passed on non-music (podcasts, news, trailers) — bookkeeping, not backlog."
                  lines={skips.buckets.map(
                    (b) =>
                      `[${b.kind}] ${b.reason}: ${b.count} track${b.count === 1 ? "" : "s"}`,
                  )}
                />
                <BarList
                  rows={skips.buckets.map((b) => ({
                    key: b.kind + b.reason,
                    name: b.reason,
                    value: b.count,
                    title: `${b.kind}: ${b.reason} — ${b.count} track${b.count === 1 ? "" : "s"}`,
                  }))}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---- backlog ----------------------------------------------------------------

export function BacklogTab() {
  const page = useFetched<[ArchiveIngestStatus, ArchiveLowqQueue]>(
    () =>
      Promise.all([
        api<ArchiveIngestStatus>("/api/archive/ingest-status"),
        api<ArchiveLowqQueue>("/api/archive/lowq"),
      ]),
    [],
  );
  if (page.status !== "ok")
    return <FetchedGate page={page} loading="loading backlog…" />;
  const [ingest, lowq] = page.data;
  const c = ingest.available ? ingest.counts : {};
  const failed = c["failed"] ?? 0;
  const gone = c["gone"] ?? 0;
  const retry = failed + gone;
  const quality = lowq.available ? lowq.tracks : [];
  const total = retry + quality.length;

  return (
    <div>
      <TabIntro
        what="The work queue: everything that can't be played or shouldn't stay."
        how="Retry backlog first (failed/gone downloads — one command clears the failed half), then the LOWQ quality upgrades (lossy files below the set-ready floor), worst bitrate first. Copy any list — the fix is a megadj command, named on the card."
        next="An empty backlog means every download in the archive is playable AND gig-safe on quality."
      />
      {!ingest.available && !lowq.available ? (
        <ArchiveAbsentGate />
      ) : (
        <>
          <Verdict
            cls={total === 0 ? "ok" : "warn"}
            text={
              total === 0
                ? "Backlog is empty — nothing to retry, nothing to upgrade."
                : `${total.toLocaleString()} item${total === 1 ? "" : "s"} in the backlog: ${retry} download${retry === 1 ? "" : "s"}, ${quality.length} quality upgrade${quality.length === 1 ? "" : "s"}.`
            }
            meta={
              retry > 0 ? "fix the failed half with one command" : undefined
            }
          />

          {retry > 0 && (
            <div class="card">
              <ListHead
                icon="refresh"
                title="Download retries"
                n={retry}
                hint="Failed downloads are retryable (megadj retry resets their counters, megadj sync re-attempts). 'Gone from source' means the video vanished from YouTube Music — re-source the track or drop it."
                lines={[`failed: ${failed}`, `gone from source: ${gone}`]}
              />
              <div class="arch-fix">
                fix: <code>megadj retry</code> then <code>megadj sync</code> —
                "gone" tracks need a new source
              </div>
            </div>
          )}

          {lowq.available && quality.length > 0 && (
            <div class="card">
              <ListHead
                icon="warn"
                title="Quality upgrades (LOWQ)"
                n={quality.length}
                hint="Downloaded tracks below the set-ready floor (AAC < 256 kbps, MP3 < 320). Work this queue to empty and everything in the archive is gig-safe on quality."
                lines={quality.map(
                  (t) => `${t.title ?? t.video_id} — ${t.reason}`,
                )}
              />
              <KVRows>
                {quality.slice(0, 30).map((t) => (
                  <KVRow key={t.video_id}>
                    <KVKey>
                      <TrackTitle
                        title={t.title ?? t.video_id}
                        videoId={t.video_id}
                        artist={t.artist}
                      />
                    </KVKey>
                    <KVVal>
                      <span class="arch-pill muted">{t.reason}</span>
                    </KVVal>
                  </KVRow>
                ))}
                {quality.length > 30 && (
                  <Truncated shown={30} total={quality.length} />
                )}
              </KVRows>
              <div class="arch-fix">
                fix: re-download from a better source, then{" "}
                <code>megadj ingest</code>
              </div>
            </div>
          )}

          {total === 0 && (
            <div class="note ok">
              <Icon name="check" size={14} /> Nothing needs work — the queue is
              empty.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- sources ----------------------------------------------------------------
