// ArchiveTabSections.tsx — the archive work-queue render sections (#233
// split from ArchiveTab.tsx): the pipeline explainer card, the
// Sync/grid sections, and the library-character cards (mood profile +
// recently added). ArchiveTab keeps the fetch + verdict wiring and
// assembles these in fix-first order.
import type {
  GridPayload,
  IngestPayload,
  MoodPayload,
} from "./ArchiveTabVerdict";
import { Icon } from "../../ui/icons";
import { InfoTip } from "../../ui/InfoTip";
import { GridHealthCard } from "./GridHealthCard";
import {
  ListHead,
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
  BeatSyncBreakersCard,
  MOOD_GLOSS,
  STATUS_LANG,
} from "../shared";
import type { GridBreaker } from "../beat-sync";

/** The breakers payload shape produced by the shared collector. */
type Breakers = GridBreaker[];

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

/** The "what the archive IS" card: one-sentence lede + pie + legend. */
export function PipelineExplainer(props: { ingest: IngestPayload }) {
  const { ingest } = props;
  const c = ingest.available ? ingest.counts : {};
  const cEntry = (k: string) => c[k] ?? 0;
  return (
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
            <b>{(ingest.counts["downloaded"] ?? 0).toLocaleString()}</b> of{" "}
            {ingest.total.toLocaleString()} tracked downloads are playable
            music. The rest is <span class="arch-pill warn">retry backlog</span>{" "}
            / <span class="arch-pill muted">queue</span> /{" "}
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
  );
}

/** Card 1 of the work queue — Beat Sync breakers with numbers. */
export function SyncBreakers(props: {
  grid: GridPayload | null;
  breakers: Breakers;
  syncRisk: number;
}) {
  const { grid, breakers, syncRisk } = props;
  if (!grid?.available || syncRisk <= 0) return null;
  return (
    <BeatSyncBreakersCard
      breakers={breakers}
      syncRisk={syncRisk}
      hint="These tracks' independent beatgrid analysis disagrees with rekordbox — off by >2% tempo, locked an octave (half/double) out, or drifting positionally across the track (>15 ms). They will drift or jump badly when you hit Sync on hardware, even though they sound fine at home. Octave rows are the worst (Sync lands on the wrong pulse entirely); drift rows slide out of phase as the track plays. Click a numeric header to sort."
      fixNote={
        <>
          <code>megadj beats --force</code> re-analyzes — the write-gate on BPM
          tags is documented in the FullTags roadmap
        </>
      }
    />
  );
}

/** Card 1b — grid health (GA-05c, #167): shelf triage buckets. Reads the
 *  last run; the card carries its own scan button when none exists. */
export function GridHealthSection() {
  return <GridHealthCard drive="SHELF1" />;
}

/** Card 3 — retry backlog: failed + gone in one actionable count. */
export function RetryBacklogSection(props: {
  ingest: IngestPayload;
  retryBacklog: number;
}) {
  const { ingest, retryBacklog } = props;
  const c = ingest.available ? ingest.counts : {};
  const cEntry = (k: string) => c[k] ?? 0;
  if (!ingest.available || retryBacklog <= 0) return null;
  return (
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
        fix: <code>megadj retry</code> then <code>megadj sync</code> — "gone"
        tracks need a new source
      </div>
    </div>
  );
}

/** Card 2 — LOWQ: quality upgrades, with the reason each track is flagged. */
export function LowqSection(props: {
  lowq: {
    available: boolean;
    tracks: {
      video_id: string;
      title: string | null;
      artist: string | null;
      reason: string;
    }[];
  } | null;
  qualityDebt: number;
}) {
  const { lowq, qualityDebt } = props;
  if (!lowq?.available || qualityDebt <= 0) return null;
  return (
    <Card>
      <ListHead
        icon="warn"
        title="Quality upgrades"
        n={qualityDebt}
        hint="Downloaded tracks below the set-ready floor (AAC < 256 kbps, MP3 < 320). Work this queue to empty and everything in the archive is gig-safe on quality."
        lines={lowq.tracks.map((t) => `${t.title ?? t.video_id} — ${t.reason}`)}
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
        fix: re-download from a better source, then <code>megadj ingest</code>
      </div>
    </Card>
  );
}

/** Library character: mood profile card (averages + extremes). */
export function MoodProfileSection(props: {
  mood: MoodPayload | null;
  analyzed: number;
}) {
  const { mood, analyzed } = props;
  if (!mood?.available) return null;
  return (
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
            v={k === "valence" || k === "arousal" ? v.toFixed(1) : v.toFixed(2)}
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
  );
}

/** Library character: recently-added card + last active run line. */
export function RecentlyAddedSection(props: { ingest: IngestPayload }) {
  const { ingest } = props;
  const newest = ingest.recent_tracks.slice(0, 8);
  // runs that actually did something — all-zero runs are pipeline noise,
  // not history (the first render showed a wall of "+0 · 0 · 0" rows)
  const activeRuns = ingest.recent_runs.filter(
    (r) => r.downloaded + r.failed + r.gone > 0,
  );
  return (
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
          {new Date(activeRuns[0]!.started_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
          : +{activeRuns[0]!.downloaded}
          {activeRuns[0]!.failed > 0
            ? ` · ${activeRuns[0]!.failed} failed`
            : ""}
          {activeRuns[0]!.gone > 0 ? ` · ${activeRuns[0]!.gone} gone` : ""}
        </div>
      )}
    </div>
  );
}
