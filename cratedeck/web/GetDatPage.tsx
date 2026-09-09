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
} from "../shared/types";
import { api } from "./toast";
import { Icon } from "./icons";
import { FetchedGate, useFetched } from "./useFetched";
import { TabIntro } from "./InfoTip";
import { ListHead } from "./ListHead";
import { StatCard } from "./DrivePanels";
import { ProductHead, SectionHead, ShareBar, Verdict } from "./ProductPage";
import { LibraryTab } from "./LibraryTab";
import { fmtBytes } from "../shared/fmt";

type Track = ArchiveIngestStatus["recent_tracks"][number];

const TABS = [
  {
    id: "pipeline",
    label: "Pipeline",
    icon: "refresh",
    title: "The download machine: buckets, recent runs, throughput",
  },
  {
    id: "backlog",
    label: "Backlog",
    icon: "warn",
    title: "What needs work: retries and quality upgrades",
  },
  {
    id: "sources",
    label: "Sources",
    icon: "compass",
    title: "Where the archive's music comes from",
  },
  {
    id: "library",
    label: "Library",
    icon: "disc",
    title: "What's in the archive — searchable, newest first",
  },
] as const;

export function GetDatPage(props: { tab: string }) {
  const tab = TABS.find((t) => t.id === props.tab)?.id ?? TABS[0].id;
  return (
    <div class="canvas fleet getdat">
      <ProductHead product="getdat" tab={tab} tabs={[...TABS]} />
      {tab === "pipeline" && <PipelineTab />}
      {tab === "backlog" && <BacklogTab />}
      {tab === "sources" && <SourcesTab />}
      {tab === "library" && <LibraryTab />}
    </div>
  );
}

/** Raw pipeline statuses → plain language (shared with the old archive
 *  card; keys not listed render through the fallback). */
export const STATUS_LANG: Record<string, string> = {
  downloaded: "in the archive",
  failed: "failed — retryable",
  gone: "gone from source",
  pending: "waiting to download",
  deleted: "removed locally",
  skipped_not_music: "skipped (not music)",
};

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
            <div class={`stat ${broken ? "bad" : ""}`}>
              <div class="v">
                <Icon name="warn" size={13} /> {broken.toLocaleString()}
              </div>
              <div class="l">failed + gone — the retry backlog</div>
            </div>
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
            <div class="covtable">
              <div class="covrow head">
                <span>when</span>
                <span>attempted</span>
                <span>landed</span>
                <span>volume</span>
              </div>
              {runs.map((r) => {
                const mins =
                  r.finished_at && r.attempted
                    ? Math.max(
                        1,
                        Math.round(
                          (new Date(r.finished_at).getTime() -
                            new Date(r.started_at).getTime()) /
                            60000,
                        ),
                      )
                    : null;
                return (
                  <div class="covrow" key={r.started_at}>
                    <span class="covpath">
                      {new Date(r.started_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {r.finished_at ? "" : " · running"}
                    </span>
                    <span class="n muted">
                      {r.attempted ?? "—"}
                      {mins ? ` · ${mins}m` : ""}
                    </span>
                    <span class="n ok-text">
                      +{r.downloaded}
                      {r.failed ? (
                        <span class="bad"> / {r.failed}✗</span>
                      ) : null}
                    </span>
                    <span class="covdrives">
                      {r.bytes_downloaded ? fmtBytes(r.bytes_downloaded) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
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
                <div class="chip-list">
                  {skips.buckets.slice(0, 8).map((b) => (
                    <span
                      class="chip-row"
                      key={b.kind + b.reason}
                      title={`${b.kind}: ${b.reason}`}
                    >
                      <span
                        class={`arch-pill ${b.kind === "gone" ? "bad" : "muted"}`}
                      >
                        {b.kind === "gone" ? "gone" : "skipped"}
                      </span>
                      <span class="chip-name">{b.reason}</span>
                      <span class="chip-n">{b.count}</span>
                    </span>
                  ))}
                  {skips.buckets.length > 8 && (
                    <span class="fleet-note">
                      …and {skips.buckets.length - 8} more buckets
                    </span>
                  )}
                </div>
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
              <div class="rows">
                {quality.slice(0, 30).map((t) => (
                  <div class="row" key={t.video_id}>
                    <span class="arch-what-title">
                      <b>{t.title ?? t.video_id}</b>
                      {t.artist && <span class="covartist"> — {t.artist}</span>}
                    </span>
                    <span class="arch-pill muted">{t.reason}</span>
                  </div>
                ))}
                {quality.length > 30 && (
                  <div class="fleet-note">
                    showing 30 of {quality.length} — Copy has the full list
                  </div>
                )}
              </div>
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
      setDiffErr(String((e as Error).message ?? e));
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
        <div class="rows">
          {props.rows.slice(0, 25).map((t) => (
            <div class="row" key={t.video_id}>
              <span class="arch-what-title">
                <b>{t.title ?? t.video_id}</b>
                {t.artist && <span class="covartist"> — {t.artist}</span>}
              </span>
            </div>
          ))}
          {props.rows.length > 25 && (
            <div class="fleet-note">showing 25 of {props.rows.length}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- library ----------------------------------------------------------------
