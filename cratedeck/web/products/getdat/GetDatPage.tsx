// GetDatPage.tsx — the GetDat product canvas (#/getdat/:tab).
//
// GetDat is megadj's download + ingest half (docs/FEATURES.md): YouTube
// Music → the local archive. This surface answers, in order:
//   Pipeline — is the download machine healthy? (status buckets + runs)
//   Backlog  — what needs work? (failed/gone retries, LOWQ upgrades)
//   Sources  — where did the music come from, and do sources diverge?
//   Library  — what's actually in the archive? (LibraryTab.tsx, extracted)
//
// READ-ONLY (§4-A1): this page describes work, it never writes — every
// card names the megadj command that does the fixing.
import { useCallback, useState } from "preact/hooks";
import type {
  ArchiveIngestStatus,
  ArchiveLowqQueue,
  ArchiveSkipCensus,
  ArchiveSourceCensus,
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
  PRODUCT_TABS,
  ProductIntro,
  SectionHead,
  ShareBar,
  Verdict,
  TrackTitle,
} from "../shared";
import { LibraryTab } from "./LibraryTab";
import { IntakeTab } from "./IntakeTab";
import { errMessage, fmtBytes } from "../../../shared/fmt";

type Track = ArchiveIngestStatus["recent_tracks"][number];

// the GetDat tab strip lives in the product SSOT (ProductPage
// PRODUCT_TABS) — header nav strip and this canvas switch on the SAME rows.
const TABS = PRODUCT_TABS.getdat;

export function GetDatPage(props: { tab: string }) {
  const tab = TABS.find((t) => t.id === props.tab)?.id ?? TABS[0]!.id;
  return (
    <div class="canvas fleet getdat">
      <ProductIntro
        product="getdat"
        sub="Every download decision, recorded: what's in the archive, what failed and can be retried, where music comes from, and what's on disk right now."
      />
      {tab === "pipeline" && <PipelineTab />}
      {tab === "backlog" && <BacklogTab />}
      {tab === "sources" && <SourcesTab />}
      {tab === "intake" && <IntakeTab />}
      {tab === "library" && <LibraryTab />}
    </div>
  );
}

// ---- pipeline ---------------------------------------------------------------

function PipelineTab() {
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
        <div class="note-card">
          <Icon name="folder" size={20} />
          archive DB absent — megadj hasn't run on this machine yet.
        </div>
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
                  cap={8}
                  tone={skips.gone > 0 ? "warn" : "accent"}
                />
                {skips.gone > 0 && (
                  <div class="arch-fix">
                    {skips.gone} gone from source — re-source or drop (see the
                    Backlog tab)
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---- backlog ----------------------------------------------------------------

function BacklogTab() {
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
        <div class="note-card">
          <Icon name="folder" size={20} /> archive DB absent — megadj hasn't run
          on this machine yet.
        </div>
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

function SourcesTab() {
  const page = useFetched<[ArchiveIngestStatus, ArchiveSourceCensus]>(
    () =>
      Promise.all([
        api<ArchiveIngestStatus>("/api/archive/ingest-status"),
        api<ArchiveSourceCensus>("/api/archive/sources"),
      ]),
    [],
  );
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<{
    a: string;
    b: string;
    only_in_a: Track[];
    only_in_b: Track[];
    shared: number;
  } | null>(null);
  const [diffErr, setDiffErr] = useState<string | null>(null);

  const runDiff = useCallback(async () => {
    if (!a.trim() || !b.trim() || a.trim() === b.trim()) return;
    setBusy(true);
    setDiffErr(null);
    try {
      setDiff(
        (await api(
          `/api/archive/source-diff?a=${encodeURIComponent(a.trim())}&b=${encodeURIComponent(b.trim())}`,
        )) as NonNullable<typeof diff>,
      );
    } catch (e) {
      setDiffErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }, [a, b]);

  if (page.status !== "ok")
    return <FetchedGate page={page} loading="loading sources…" />;
  const [ingest, census] = page.data;
  if (!ingest.available)
    return (
      <div class="note-card">
        <Icon name="folder" size={20} /> archive DB absent — megadj hasn't run
        on this machine yet.
      </div>
    );
  const sources = census.available ? census.sources : [];
  return (
    <div>
      <TabIntro
        what="Where the archive's music comes from — and whether two sources drifted apart."
        how="Every archived track carries its source tag: the liked list, a YouTube playlist id, or an ingest run. The chips below are the real census (click one to fill the form); diff any two to see which tracks live in one but not the other — the classic case is 'my liked list vs the playlist I curated'."
        next="Drift is normal (you unlike things); the diff tells you what a re-sync would add or drop."
      />
      {sources.length > 0 && (
        <div class="card">
          <ListHead
            icon="compass"
            title="Source tags in the archive"
            n={sources.length}
            hint="Every source tag with its total and playable (downloaded) track counts. Click a chip to drop it into the diff form — 'playable' is what can actually be mixed; the gap is the source's history (gone/skipped/pending)."
            lines={sources.map(
              (s) => `${s.source}: ${s.tracks} tracked, ${s.playable} playable`,
            )}
          />
          <div class="src-chips">
            {sources.map((s) => (
              <button
                type="button"
                class="src-chip"
                key={s.source}
                title={`${s.playable} playable of ${s.tracks} tracked — click to fill the form`}
                onClick={() => {
                  if (!a.trim()) setA(s.source);
                  else if (!b.trim()) setB(s.source);
                }}
              >
                {s.source}
                <span class="src-chip-n">{s.playable}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div class="pl-tools">
        <input
          placeholder="source A (e.g. liked)"
          value={a}
          onInput={(e) => setA((e.target as HTMLInputElement).value)}
        />
        <span class="diff-arrow">→</span>
        <input
          placeholder="source B (e.g. PLxxxx…)"
          value={b}
          onInput={(e) => setB((e.target as HTMLInputElement).value)}
        />
        <button
          type="button"
          class="btn primary"
          disabled={busy || !a.trim() || !b.trim()}
          onClick={runDiff}
        >
          <Icon name="sort" size={14} /> {busy ? "Diffing…" : "Diff sources"}
        </button>
      </div>
      {diffErr && (
        <div class="note bad">
          <Icon name="warn" size={14} /> Source diff failed: {diffErr}
        </div>
      )}
      {diff && (
        <>
          <Verdict
            cls="ok"
            text={`${diff.only_in_a.length} only in "${diff.a}" · ${diff.only_in_b.length} only in "${diff.b}" · ${diff.shared} shared.`}
          />
          <div class="archive-cols">
            <DiffList
              title={`only in ${diff.a}`}
              rows={diff.only_in_a}
              empty="none — b has everything a has"
            />
            <DiffList
              title={`only in ${diff.b}`}
              rows={diff.only_in_b}
              empty="none — a has everything b has"
            />
          </div>
        </>
      )}
      {!diff && !diffErr && (
        <div class="note-card">
          <Icon name="compass" size={20} />
          Diff two source tags — e.g. <code>liked</code> vs a playlist id (
          <code>PL…</code>) or <code>ingest</code>.
        </div>
      )}
    </div>
  );
}

function DiffList(props: { title: string; rows: Track[]; empty: string }) {
  return (
    <div class="card">
      <ListHead
        icon="disc"
        title={props.title}
        n={props.rows.length}
        hint={`Tracks present in only one of the two sources. Copy hands the list to an agent.`}
        lines={
          props.rows.length
            ? props.rows.map(
                (t) =>
                  `${t.title ?? t.video_id}${t.artist ? ` — ${t.artist}` : ""}`,
              )
            : undefined
        }
      />
      {!props.rows.length ? (
        <div class="fleet-note">{props.empty}</div>
      ) : (
        <KVRows>
          {props.rows.slice(0, 25).map((t) => (
            <KVRow key={t.video_id}>
              <KVKey>
                <TrackTitle
                  title={t.title ?? t.video_id}
                  videoId={t.video_id}
                  artist={t.artist}
                />
              </KVKey>
            </KVRow>
          ))}
          {props.rows.length > 25 && (
            <Truncated shown={25} total={props.rows.length} full={false} />
          )}
        </KVRows>
      )}
    </div>
  );
}

// ---- library ----------------------------------------------------------------
