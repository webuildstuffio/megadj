// getdat-tabs.tsx — the GetDatPage content tabs, extracted from
// GetDatPage.tsx (#90 page-monolith split): pipeline (download-machine
// status buckets + recent runs), backlog (retries + LOWQ upgrades), and
// sources (source census + the two-source diff). GetDatPage keeps the tab
// routing; IntakeTab.tsx and LibraryTab.tsx were already their own files.
// READ-ONLY (§4-A1): this page describes work, it never writes — every
// card names the megadj command that does the fixing. (The user-marking
// actions — not-music skip, surfaced checklist — are ledger judgments,
// not library writes; they route through the engine CLI seam.)
import type {
  ArchiveIngestStatus,
  ArchiveAnalysisCoverage,
  ArchiveLowqQueue,
  ArchiveSkipCensus,
} from "../../../shared/types";
import { api, apiPost, toast } from "../../ui/toast";
import { Icon } from "../../ui/icons";
import { FetchedGate, useFetched } from "../../ui/useFetched";
import { useState } from "preact/hooks";
import { navigateProduct } from "../../app/router";
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
  Meter,
  SectionHead,
  ShareBar,
  Verdict,
  TrackTitle,
} from "../shared";
import { SurfacedLinksCard } from "./surfaced-card";
import { fmtBytes } from "../../../../src/shared/leaf/fmt";

// ---- pipeline ---------------------------------------------------------------

/** Scroll to an in-page list section (the stat-card jump). No-op when
 *  the target is gone (cohort emptied since render). */
function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

export function PipelineTab() {
  const page = useFetched<
    [ArchiveIngestStatus, ArchiveSkipCensus, ArchiveAnalysisCoverage]
  >(
    () =>
      Promise.all([
        api<ArchiveIngestStatus>("/api/archive/ingest-status"),
        api<ArchiveSkipCensus>("/api/archive/skip-census"),
        api<ArchiveAnalysisCoverage>("/api/archive/analysis-coverage"),
      ]),
    [],
  );
  if (page.status !== "ok")
    return <FetchedGate page={page} loading="loading pipeline status…" />;
  const [ingest, skips, coverage] = page.data;
  const c = ingest.available ? ingest.counts : {};
  const entry = (k: string) => c[k] ?? 0;
  const inArchive = entry("downloaded");
  const broken = entry("failed") + entry("gone");
  const waiting = entry("pending");
  const movedOn =
    entry("deleted") +
    entry("skipped_not_music") +
    entry("skipped_short") +
    entry("skipped_low_quality");
  const surfacedRows = ingest.surfaced;
  const surfaced = surfacedRows.length;
  const runs = ingest.recent_runs.filter(
    (r) => r.downloaded + r.failed + r.gone > 0,
  );
  const stages = coverage.available ? coverage.stages : undefined;

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
              onClick={() => navigateProduct("getdat", "library")}
            />
            <CountStat
              n={broken}
              l="failed + gone — the retry backlog"
              icon="warn"
              title="Failed downloads are retryable; gone-from-source needs a new source. Work it in the Backlog tab."
              onClick={() => navigateProduct("getdat", "backlog")}
            />
            <StatCard
              v={waiting.toLocaleString()}
              l="waiting to download"
              icon="clock"
              title="The queue `megadj sync` works through next — review it in the Backlog tab and mark anything that isn't music out."
              onClick={() => navigateProduct("getdat", "backlog")}
            />
            <StatCard
              v={surfaced.toLocaleString()}
              l="links surfaced — go through them"
              icon="compass"
              title="SoundCloud tracks that offer an official download/purchase link: the rip was skipped on purpose. The card below lists the URLs."
              onClick={() => jumpTo("pipeline-surfaced")}
            />
            <StatCard
              v={movedOn.toLocaleString()}
              l="removed / skipped (bookkeeping)"
              icon="doc"
              onClick={() => navigateProduct("getdat", "backlog")}
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
                  onClick: () => navigateProduct("getdat", "library"),
                },
                {
                  n: broken,
                  cls: "broken",
                  label: "broken (failed/gone)",
                  title: "the re-download backlog",
                  onClick: () => navigateProduct("getdat", "backlog"),
                },
                {
                  n: surfaced,
                  cls: "surfaced",
                  label: "links surfaced",
                  title:
                    "an official link exists — rip skipped on purpose (#256)",
                  onClick: () => jumpTo("pipeline-surfaced"),
                },
                {
                  n: waiting,
                  cls: "waiting",
                  label: "waiting to download",
                  title: "still in the queue",
                  onClick: () => navigateProduct("getdat", "backlog"),
                },
                {
                  n: movedOn,
                  cls: "moved",
                  label: "removed/skipped",
                  title: "bookkeeping, not backlog",
                  onClick: () => navigateProduct("getdat", "backlog"),
                },
              ]}
            />
          </div>

          {stages && <EnrichmentFunnel stages={stages} />}

          <div id="pipeline-surfaced" />
          {surfacedRows.length > 0 && (
            <SurfacedLinksCard
              rows={surfacedRows}
              context="ledger"
              sets={ingest.sc_sets}
              onChanged={() => page.refresh?.()}
            />
          )}

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
  const page = useFetched<
    [
      ArchiveIngestStatus,
      ArchiveLowqQueue,
      {
        available: boolean;
        tracks: {
          video_id: string;
          title: string | null;
          artist: string | null;
          duration_s: number | null;
          status: string;
          source: string;
          attempts: number;
        }[];
      },
    ]
  >(
    () =>
      Promise.all([
        api<ArchiveIngestStatus>("/api/archive/ingest-status"),
        api<ArchiveLowqQueue>("/api/archive/lowq"),
        api<{
          available: boolean;
          tracks: {
            video_id: string;
            title: string | null;
            artist: string | null;
            duration_s: number | null;
            status: string;
            source: string;
            attempts: number;
          }[];
        }>("/api/archive/pending-queue"),
      ]),
    [],
  );
  if (page.status !== "ok")
    return <FetchedGate page={page} loading="loading backlog…" />;
  const [ingest, lowq, pendingQ] = page.data;
  const c = ingest.available ? ingest.counts : {};
  const failed = c["failed"] ?? 0;
  const gone = c["gone"] ?? 0;
  const retry = failed + gone;
  const quality = lowq.available ? lowq.tracks : [];
  const pending = pendingQ.available ? pendingQ.tracks : [];
  // #256: surfaced links are backlog work of a different KIND — the fix
  // isn't a re-download, it's the user going through the official link.
  const surfaced = ingest.available ? ingest.surfaced : [];
  const total = retry + quality.length;

  return (
    <div>
      <TabIntro
        what="The work queue: everything that can't be played or shouldn't stay."
        how="Review the pending download queue first (mark anything that isn't YouTube music out of it), then the retry backlog (failed/gone downloads — one command clears the failed half), then the LOWQ quality upgrades, worst bitrate first. Copy any list — the fix is a megadj command, named on the card."
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
                ? surfaced.length > 0
                  ? `No download or quality debt — ${surfaced.length} surfaced link${surfaced.length === 1 ? "" : "s"} below are yours to click.`
                  : "Backlog is empty — nothing to retry, nothing to upgrade."
                : `${total.toLocaleString()} item${total === 1 ? "" : "s"} in the backlog: ${retry} download${retry === 1 ? "" : "s"}, ${quality.length} quality upgrade${quality.length === 1 ? "" : "s"}.`
            }
            meta={
              retry > 0 ? "fix the failed half with one command" : undefined
            }
          />

          {pending.length > 0 && (
            <PendingQueueCard
              tracks={pending}
              onSkipped={() => page.refresh?.()}
            />
          )}

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

          {surfaced.length > 0 && (
            <SurfacedLinksCard
              rows={surfaced}
              context="backlog"
              sets={ingest.available ? ingest.sc_sets : []}
              onChanged={() => page.refresh?.()}
            />
          )}

          {total === 0 && (
            <div class="note ok">
              <Icon name="check" size={14} />{" "}
              {surfaced.length > 0
                ? `No downloads need work — ${surfaced.length} surfaced link${surfaced.length === 1 ? "" : "s"} await you above.`
                : "Nothing needs work — the queue is empty."}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- sources ----------------------------------------------------------------

/** PendingQueueCard — the download queue awaiting `megadj sync`, with a
 *  per-row "not music" action (Sep 19): marks the row skipped_not_music
 *  through POST /api/archive/skip (engine CLI) so sync never downloads
 *  it. This is how non-YouTube-video rows leave the import pipeline. */
export function PendingQueueCard(props: {
  tracks: {
    video_id: string;
    title: string | null;
    artist: string | null;
    status: string;
    source: string;
    attempts: number;
  }[];
  onSkipped: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const skip = async (videoId: string) => {
    setBusy(videoId);
    try {
      await apiPost(`/api/archive/skip?id=${encodeURIComponent(videoId)}`, {});
      props.onSkipped();
    } finally {
      setBusy(null);
    }
  };
  const n = props.tracks.length;
  return (
    <div class="card">
      <ListHead
        icon="inbox"
        title="Pending downloads — review before sync"
        n={n}
        hint="What megadj sync WILL download next. Anything here that isn't actually music you want (podcasts, mixes you already have, junk), mark it not-music — the row leaves the queue permanently and sync skips it."
        lines={[
          `showing ${Math.min(n, 30)} of ${n}`,
          ...props.tracks
            .slice(0, 3)
            .map((t) => `${t.title ?? t.video_id} — ${t.source}`),
        ]}
      />
      <KVRows>
        {props.tracks.slice(0, 30).map((t) => (
          <KVRow key={t.video_id}>
            <KVKey>
              <TrackTitle
                title={t.title ?? t.video_id}
                videoId={t.video_id}
                artist={t.artist}
              />
              <span class="dt-sub">
                {t.source}
                {t.attempts > 0
                  ? ` · ${t.attempts} failed attempt${t.attempts === 1 ? "" : "s"}`
                  : ""}
                {t.status === "failed" ? " · failed" : ""}
              </span>
            </KVKey>
            <KVVal>
              <button
                class="btn tiny"
                disabled={busy === t.video_id}
                onClick={() => void skip(t.video_id)}
                title="Mark as not-YouTube-music — sync will never download this"
              >
                {busy === t.video_id ? "…" : "not music"}
              </button>
            </KVVal>
          </KVRow>
        ))}
        {n > 30 && <Truncated shown={30} total={n} />}
      </KVRows>
      <div class="arch-fix">
        CLI equivalent: <code>megadj skip &lt;video_id…&gt;</code> — bulk-mark
        from a terminal
      </div>
    </div>
  );
}

/** EnrichmentFunnel (#260 UX) — "downloaded ≠ finished". The archive's
 *  playable pool decomposed by processing stage: how much has no genre,
 *  how much ran under the CURRENT genre vote system, and which dated
 *  batch folders are still raw downloads (untouched by ingest). Each
 *  unfinished cohort names its fix: a CLI command or a one-click button
 *  (Process batch → the intake job engine; Genre pass → the Run tab).
 *  Rendered only when the producer reports stages (absent ledger → no
 *  card, never fake numbers). */
export function EnrichmentFunnel(props: {
  stages: NonNullable<ArchiveAnalysisCoverage["stages"]>;
}) {
  const { stages } = props;
  const raw = stages.rawBatches;
  const rawFiles = raw.reduce((a, b) => a + b.files, 0);
  const goGenre = (): void => navigateProduct("fulltags", "run"); // eslint-disable-line unicorn/consistent-function-scoping -- inline handler sugar reads clearer here
  return (
    <div class="card">
      <ListHead
        icon="pulse"
        title="Processing funnel — downloaded vs finished"
        n={rawFiles + stages.noGenre}
        hint="A downloaded file is NOT a finished track until tags/art/analysis ran on it. 'No genre' = never went through the genre pass; 'genre-voted' = processed under the current (voted) system; 'raw batches' = fresh downloads still untouched. Everything else is done."
        lines={[
          `${stages.noGenre.toLocaleString()} without genre · ${stages.genreVoted.toLocaleString()} genre-voted · ${rawFiles.toLocaleString()} raw in ${raw.length} batch folder${raw.length === 1 ? "" : "s"}`,
        ]}
      />
      <div class="fleet-note">
        {stages.noGenre.toLocaleString()} without genre ·{" "}
        {stages.genreVoted.toLocaleString()} genre-voted ·{" "}
        {rawFiles.toLocaleString()} raw in {raw.length} batch folder
        {raw.length === 1 ? "" : "s"}
      </div>
      <KVRows>
        <KVRow>
          <KVKey>
            genre system (voted) coverage
            <span class="dt-sub">
              {" "}
              — re-run after the system changes:{" "}
              <code>megadj fetch --genres --all</code> or the Run tab
            </span>
          </KVKey>
          <KVVal>
            <Meter
              done={stages.genreVoted}
              total={Math.max(1, stages.genreVoted + stages.noGenre)}
              label=""
              cls={stages.noGenre === 0 ? "ok" : ""}
            />
          </KVVal>
        </KVRow>
        {raw.length > 0 && (
          <KVRow>
            <KVKey>
              raw batch folder{raw.length === 1 ? "" : "s"}
              <span class="dt-sub">
                {" "}
                — fresh downloads, not yet tagged/artworked/analyzed
              </span>
            </KVKey>
            <KVVal>
              <span class="surfaced-links">
                {raw.map((b) => (
                  <ProcessBatchButton
                    key={b.folder}
                    folder={b.folder}
                    files={b.files}
                  />
                ))}
              </span>
            </KVVal>
          </KVRow>
        )}
        <KVRow>
          <KVKey>
            <button
              type="button"
              class="btn btn-sm surfaced-link"
              onClick={goGenre}
              title="Open the FullTags Run tab — the live genre ladder with progress and cancel"
            >
              run the genre pass <Icon name="compass" size={12} />
            </button>
          </KVKey>
          <KVVal>
            <span class="dt-sub">
              the fulltags page's coverage strip tracks beats/mood/cues
            </span>
          </KVVal>
        </KVRow>
      </KVRows>
    </div>
  );
}

/** ProcessBatchButton — ONE click turns a raw dated batch folder into
 *  finished tracks: enqueues the REAL intake job (kind "ingest", the
 *  Intake tab's engine — interlock, one-at-a-time, SSE live stream),
 *  then jumps to the Intake tab to watch it. Toasts the refusal when the
 *  engine is busy; the folder stays raw and retryable. */
export function ProcessBatchButton(props: { folder: string; files: number }) {
  const [busy, setBusy] = useState(false);
  // Button label shows the BATCH NAME (the dated tail, what the user
  // recognizes); the POST sends the ABSOLUTE path (the allowlist's shape).
  // `folder` is always absolute now (archive.ts extracts full paths).
  const name = props.folder.split("/").filter(Boolean).pop() ?? props.folder;
  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      const job = await apiPost<{ id: string }>(
        "/api/intake/start",
        { folder: props.folder },
        { quiet: true },
      );
      toast(
        `Processing ${props.files} file${props.files === 1 ? "" : "s"} — job ${job.id.slice(0, 8)}`,
        "ok",
      );
      navigateProduct("getdat", "intake");
    } catch (e: unknown) {
      toast(
        `intake refused: ${e instanceof Error ? e.message : String(e)}`,
        "err",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      class="btn btn-sm surfaced-link"
      disabled={busy}
      onClick={() => void start()}
      title={`Run the full intake pipeline on ${props.folder} (${props.files} files)`}
    >
      {busy ? (
        <span class="spin">
          <Icon name="refresh" size={12} />
        </span>
      ) : (
        <Icon name="download" size={12} />
      )}{" "}
      process {name} ({props.files})
    </button>
  );
}
