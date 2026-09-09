// ArchiveTab.tsx — the archive half of surface-parity A3, UX pass (Sep 8).
//
// The first render was the pipeline internals in a 2×2 card grid: raw DB
// status buckets ("pending 1064", "gone 90"), verdict-less analysis cards,
// and two actionable lists that hid their data (the off/octave BPM numbers
// and the LOWQ reasons existed in the payloads but were never rendered).
// Nobody could answer the only three questions that matter:
//   1. Is my music library healthy?      → the verdict banner
//   2. What needs work?                  → the work queue (fix-first order)
//   3. What did I add lately?            → recently added
// Fix-first order: Beat Sync breakers (off/octave grids) outrank quality
// upgrades (LOWQ) outrank metadata chores. Every list is copyable so the
// fix (an agent running megadj) is one paste away.
//
// Archive reads stay READ-ONLY (§4-A1): this tab describes work, it never
// writes — the fix is always a megadj command, shown per-card.

import type {
  ArchiveGridCrossCheck,
  ArchiveIngestStatus,
  ArchiveLowqQueue,
  ArchiveMoodProfile,
} from "../../../shared/types";
import { api } from "../../ui/toast";
import { Icon } from "../../ui/icons";
import { FetchedGate, useFetched } from "../../ui/useFetched";
import { InfoTip, TabIntro } from "../../ui/InfoTip";
import {
  ListHead,
  DataTable,
  KVRows,
  KVRow,
  KVKey,
  KVVal,
  StatCard,
  Card,
  Truncated,
} from "../../ui/data";
import {
  ShareBar,
  TrackTitle,
  beatSyncColumns,
  beatSyncCopy,
  gridDeltaPct,
  MOOD_GLOSS,
  STATUS_LANG,
  type GridBreaker,
} from "../shared";

// Payload types are DERIVED from ArchiveReader's return types
// (shared/types.ts) — never re-declare server shapes locally. Local
// duplicates drift silently; the Sep 7 rev shipped three of them.
type IngestPayload = ArchiveIngestStatus;
type MoodPayload = ArchiveMoodProfile;
type LowqPayload = ArchiveLowqQueue;
type GridPayload = ArchiveGridCrossCheck;

type ArchivePayload = [IngestPayload, MoodPayload, LowqPayload, GridPayload];

/** The pipeline pie: have vs broken vs waiting, in plain language. Shares
 *  the ShareBar pie+legend renderer with the other product pages. */
function PipelineBars(props: { ingest: IngestPayload }) {
  const c = props.ingest.counts;
  const sum = (keys: string[]) => keys.reduce((s, k) => s + (c[k] ?? 0), 0);
  const total = props.ingest.total || 1;
  const have = sum(["downloaded"]);
  const broken = sum(["failed", "gone"]);
  const waiting = sum(["pending"]);
  const movedOn = sum(["deleted", "skipped_not_music"]);
  const segs = [
    {
      n: have,
      cls: "have",
      label: "have",
      title: "in the archive — playable, analyzable, gig-eligible",
    },
    {
      n: broken,
      cls: "broken",
      label: "broken",
      title: "failed or gone from source — the re-download backlog",
    },
    {
      n: waiting,
      cls: "waiting",
      label: "waiting",
      title: "still in the download queue",
    },
    {
      n: movedOn,
      cls: "moved",
      label: "moved on",
      title:
        "removed locally or skipped as not-music — bookkeeping, not backlog",
    },
  ];
  return (
    <div
      role="img"
      aria-label={`${have} in the archive, ${broken} broken, ${waiting} waiting, ${movedOn} moved on, of ${props.ingest.total} total`}
    >
      <ShareBar segs={segs} total={total} />
    </div>
  );
}

export function ArchiveTab() {
  const page = useFetched<ArchivePayload>(
    () =>
      Promise.all([
        api<IngestPayload>("/api/archive/ingest-status"),
        api<MoodPayload>("/api/archive/mood"),
        api<LowqPayload>("/api/archive/lowq"),
        api<GridPayload>("/api/archive/grid-cross-check"),
      ]),
    [],
  );
  const [ingest, mood, lowq, grid] =
    page.status === "ok" ? page.data : [null, null, null, null];

  if (page.status !== "ok" || !ingest)
    return <FetchedGate page={page} loading="loading archive reads…" />;

  // ---- the verdict: one line a human reads before anything else ---------
  const syncRisk = grid?.available ? grid.off.length + grid.octave.length : 0;
  const qualityDebt = lowq?.available ? lowq.tracks.length : 0;
  const retryBacklog = ingest.available
    ? (ingest.counts["failed"] ?? 0) + (ingest.counts["gone"] ?? 0)
    : 0;
  const analyzed = mood?.available ? mood.analyzed : 0;
  const inArchive = ingest.available ? (ingest.counts["downloaded"] ?? 0) : 0;
  // unmetered = in the archive but no mood stamp — the analysis backlog
  const unanalyzed =
    inArchive > 0 && mood?.available ? Math.max(0, inArchive - analyzed) : 0;

  const issues: { n: number; text: string }[] = [
    syncRisk > 0 && {
      n: syncRisk,
      text: `${syncRisk} track${syncRisk === 1 ? "" : "s"} will Beat Sync badly (grid check)`,
    },
    qualityDebt > 0 && {
      n: qualityDebt,
      text: `${qualityDebt} below the quality bar (LOWQ)`,
    },
    retryBacklog > 0 && {
      n: retryBacklog,
      text: `${retryBacklog} failed/gone downloads to retry or drop`,
    },
    unanalyzed > 0 && {
      n: unanalyzed,
      text: `${unanalyzed} not yet mood-analyzed`,
    },
  ].filter((x): x is { n: number; text: string } => Boolean(x));

  const c = ingest.available ? ingest.counts : {};
  const cEntry = (k: string) => c[k] ?? 0;
  // runs that actually did something — all-zero runs are pipeline noise,
  // not history (the first render showed a wall of "+0 · 0 · 0" rows)
  const activeRuns = ingest.recent_runs.filter(
    (r) => r.downloaded + r.failed + r.gone > 0,
  );
  const newest = ingest.recent_tracks.slice(0, 8);
  // octave rows first (the dangerous ones) — the shared table renders it
  const breakers: GridBreaker[] = grid?.available
    ? [
        ...grid.octave.map((t) => ({
          videoId: t.video_id,
          title: t.title,
          isOct: true,
          ledgerBpm: t.ledgerBpm,
          rbBpm: t.rbBpm,
          deltaPct: gridDeltaPct(t.ledgerBpm, t.rbBpm),
        })),
        ...grid.off.map((t) => ({
          videoId: t.video_id,
          title: t.title,
          isOct: false,
          ledgerBpm: t.ledgerBpm,
          rbBpm: t.rbBpm,
          deltaPct: gridDeltaPct(t.ledgerBpm, t.rbBpm),
        })),
      ]
    : [];

  const verdict =
    issues.length === 0
      ? {
          cls: "ok",
          text: "Archive is healthy — everything analyzed, nothing flagged.",
        }
      : {
          cls: "warn",
          text: `${issues[0]!.text}${issues.length > 1 ? ` · +${issues.length - 1} more below` : ""}`,
        };

  return (
    <div>
      <TabIntro
        what="Your music library's report card — what's in it, and what still needs work."
        how="The verdict banner is the one-line answer. Below it, the work queue lists problems in fix-first order: tracks that will misbehave in the booth first, quality upgrades second, download backlog last. Copy any list and paste it to an agent (or run the shown megadj command) to work it."
        next="Everything here is read-only — fixes happen via megadj, and each card names the command."
      />

      {/* ---- verdict banner ---- */}
      <div class={`arch-verdict ${verdict.cls}`}>
        <Icon name={verdict.cls === "ok" ? "check" : "warn"} size={15} />
        <span>{verdict.text}</span>
        <span class="arch-verdict-meta">
          {inArchive.toLocaleString()} in the archive
          {mood?.available && analyzed > 0 && <> · {analyzed} analyzed</>}
        </span>
      </div>
      {issues.length > 1 && (
        <div class="arch-issues">
          {issues.slice(1).map((i) => (
            <span key={i.text} class="arch-issue">
              <Icon name="dot" size={10} /> {i.text}
            </span>
          ))}
        </div>
      )}

      {/* ---- what the archive IS (one sentence + the pipeline shape) ---- */}
      <div class="card arch-what">
        <div class="ah-head">
          <b>
            <Icon name="folder" size={13} /> The pipeline, in plain language
          </b>
          <InfoTip
            title="The pipeline"
            body="Downloads land in the archive (megadj sync), get tagged/analyzed on ingest, then graduate to the DJ drives via rekordbox exports. The counts below are that pipeline's shape — 'in the archive' is the part you can actually play."
          />
        </div>
        <p class="arch-lede">
          {ingest.available ? (
            <>
              <b>{inArchive.toLocaleString()}</b> of{" "}
              {ingest.total.toLocaleString()} tracked downloads are playable
              music. The rest is{" "}
              <span class="arch-pill warn">retry backlog</span> /{" "}
              <span class="arch-pill muted">queue</span> /{" "}
              <span class="arch-pill muted">bookkeeping</span> — machinery, not
              music.
            </>
          ) : (
            <>archive DB absent — megadj hasn't run here.</>
          )}
        </p>
        {ingest.available && <PipelineBars ingest={ingest} />}
        {ingest.available && (
          <div class="arch-legend">
            <span>
              <i class="have" /> in the archive{" "}
              <em>{cEntry("downloaded").toLocaleString()}</em>
            </span>
            {cEntry("failed") > 0 && (
              <span>
                <i class="broken" /> failed — retryable{" "}
                <em>{cEntry("failed").toLocaleString()}</em>
              </span>
            )}
            {cEntry("gone") > 0 && (
              <span>
                <i class="broken" /> gone from source{" "}
                <em>{cEntry("gone").toLocaleString()}</em>
              </span>
            )}
            {cEntry("pending") > 0 && (
              <span>
                <i class="waiting" /> waiting to download{" "}
                <em>{cEntry("pending").toLocaleString()}</em>
              </span>
            )}
            {cEntry("deleted") > 0 && (
              <span>
                <i class="moved" /> removed locally{" "}
                <em>{cEntry("deleted").toLocaleString()}</em>
              </span>
            )}
            {cEntry("skipped_not_music") > 0 && (
              <span>
                <i class="moved" /> skipped (not music){" "}
                <em>{cEntry("skipped_not_music").toLocaleString()}</em>
              </span>
            )}
          </div>
        )}
      </div>

      {/* ---- THE WORK QUEUE: fix-first order, every list copyable ---- */}
      <h3 class="sect">
        <Icon name="sliders" /> Needs work
        <span class="sect-n">{issues.reduce((s, i) => s + i.n, 0)}</span>
        <InfoTip
          title="Needs work"
          body="Ordered by what hurts the set first: tracks whose beatgrid will fight the CDJ's Beat Sync, then below-quality files, then the download backlog. Copy a list and paste it to an agent — or run the megadj command on the card."
          align="right"
        />
      </h3>

      {/* 1 — Beat Sync breakers: the highest-stakes list, with numbers */}
      {grid?.available && syncRisk > 0 && (
        <Card>
          <ListHead
            icon="pulse"
            title="Beat Sync breakers"
            n={syncRisk}
            hint="These tracks' independent beatgrid analysis disagrees with rekordbox's BPM — off by >2% tempo or locked an octave (half/double) out. They will drift or jump badly when you hit Sync on hardware, even though they sound fine at home. Click a numeric header to sort."
            lines={beatSyncCopy(breakers)}
          />
          <DataTable
            columns={beatSyncColumns()}
            rows={breakers}
            cap={40}
            ariaLabel="Beat Sync breakers"
            rowTone={(t) => (t.isOct ? "bad" : "")}
            copyLines={beatSyncCopy}
            copyName="Beat Sync breakers"
          />
          <div class="arch-fix">
            fix: <code>megadj beats --force</code> re-analyzes — the write-gate
            on BPM tags is documented in the FullTags roadmap
          </div>
        </Card>
      )}

      {/* 2 — LOWQ: quality upgrades, with the reason each track is flagged */}
      {lowq?.available && qualityDebt > 0 && (
        <Card>
          <ListHead
            icon="warn"
            title="Quality upgrades"
            n={qualityDebt}
            hint="Downloaded tracks below the set-ready floor (AAC < 256 kbps, MP3 < 320). Work this queue to empty and everything in the archive is gig-safe on quality."
            lines={lowq.tracks.map(
              (t) => `${t.title ?? t.video_id} — ${t.reason}`,
            )}
          />
          <KVRows>
            {lowq.tracks.slice(0, 25).map((t) => (
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
            {qualityDebt > 25 && <Truncated shown={25} total={qualityDebt} />}
          </KVRows>
          <div class="arch-fix">
            fix: re-download from a better source, then{" "}
            <code>megadj ingest</code>
          </div>
        </Card>
      )}

      {/* 3 — retry backlog: failed + gone in one actionable count */}
      {ingest.available && retryBacklog > 0 && (
        <div class="card">
          <ListHead
            icon="refresh"
            title="Download backlog"
            n={retryBacklog}
            hint="Failed downloads are retryable (megadj retry resets their counters). 'Gone from source' means the video vanished from YouTube Music — re-source the track or drop it."
            lines={[
              `failed: ${cEntry("failed")}`,
              `gone from source: ${cEntry("gone")}`,
            ]}
          />
          <div class="arch-fix">
            fix: <code>megadj retry</code> then <code>megadj sync</code> —
            "gone" tracks need a new source
          </div>
        </div>
      )}

      {issues.length === 0 && (
        <div class="note ok">
          <Icon name="check" size={14} /> Nothing needs work — the queue is
          empty.
        </div>
      )}

      {/* ---- context cards: mood character + what landed lately ---- */}
      <h3 class="sect">
        <Icon name="bolt" /> Library character
        <InfoTip
          title="Library character"
          body="Aggregate analysis of the archive: mood/dance/valence averages describe the library's overall vibe, extremes are the outliers worth reaching for, and recently-added is the freshest material."
        />
      </h3>
      <div class="archive-cols">
        {mood?.available && (
          <div class="card">
            <ListHead
              icon="bolt"
              title="Mood profile"
              n={analyzed}
              hint="ONNX models score every archived track for danceability, mood, valence (positive ↔ sad) and arousal (calm ↔ intense). Averages = the library's character; the extremes are set-planning lookups — 'play something happy' becomes a query."
            />
            <div class="statgrid">
              {Object.entries(mood.avg).map(([k, v]) => (
                <StatCard
                  key={k}
                  v={
                    k === "valence" || k === "arousal"
                      ? v.toFixed(1)
                      : v.toFixed(2)
                  }
                  l={k}
                  em={MOOD_GLOSS[k]?.split("·")[1]?.trim()}
                  title={MOOD_GLOSS[k] ?? k}
                />
              ))}
            </div>
            <div class="arch-extremes">
              {(["valence", "arousal", "dance"] as const).map((dim) => {
                const list = mood.extremes[dim] ?? [];
                if (list.length === 0) return null;
                return (
                  <div key={dim} class="arch-extreme">
                    <b>highest {dim}</b>
                    {list.slice(0, 3).map((t) => (
                      <span key={t.video_id} title={`${dim} ${t.v}`}>
                        {t.title}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div class="card">
          <ListHead
            icon="clock"
            title="Recently added"
            n={newest.length}
            hint="The newest tracks by archive update — what landed from the last sync/ingest pass."
            lines={newest.map(
              (t) =>
                `${t.title ?? t.video_id}${t.artist ? ` — ${t.artist}` : ""} [${STATUS_LANG[t.status] ?? t.status}]`,
            )}
          />
          {newest.length === 0 ? (
            <div class="empty">nothing yet — run megadj sync</div>
          ) : (
            <KVRows>
              {newest.map((t) => (
                <KVRow key={t.video_id}>
                  <KVKey>
                    <TrackTitle
                      title={t.title ?? t.video_id}
                      videoId={t.video_id}
                      artist={t.artist}
                    />
                  </KVKey>
                  <KVVal title={t.status}>
                    {STATUS_LANG[t.status] ?? t.status}
                  </KVVal>
                </KVRow>
              ))}
            </KVRows>
          )}
          {activeRuns.length > 0 && (
            <div class="arch-fix">
              last active run{" "}
              {new Date(activeRuns[0]!.started_at).toLocaleDateString(
                undefined,
                {
                  month: "short",
                  day: "numeric",
                },
              )}
              : +{activeRuns[0]!.downloaded}
              {activeRuns[0]!.failed > 0
                ? ` · ${activeRuns[0]!.failed} failed`
                : ""}
              {activeRuns[0]!.gone > 0 ? ` · ${activeRuns[0]!.gone} gone` : ""}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
