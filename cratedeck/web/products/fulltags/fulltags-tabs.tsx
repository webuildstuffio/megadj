// fulltags-tabs.tsx — the FullTagsPage content tabs, extracted from
// FullTagsPage.tsx (#90 page-monolith split): beatgrids (the beats ledger
// + the independent grid cross-check), mood (the vibe map), and cues (the
// 8-bar phrase-cue ledger). FullTagsPage keeps the tab routing; each tab
// owns its fetch + verdict + rendering. Tags (TagCompareTab) and Similar
// (SimilarTab) were already their own files.
//
// Split per concern (#233, closing slice): the shared coverage hook +
// strip live in coverage.tsx; the three analysis tabs stay here.
import { CoverageStrip, useCoverage } from "./coverage";
export { CoverageStrip, useCoverage } from "./coverage";
import type {
  ArchiveCueStats,
  ArchiveGridCrossCheck,
  ArchiveMoodProfile,
} from "../../../shared/types";
import { api } from "../../ui/toast";
import { Icon } from "../../ui/icons";
import { FetchedGate, useFetched } from "../../ui/useFetched";
import { TabIntro } from "../../ui/InfoTip";
import {
  DataTable,
  KVKey,
  KVRow,
  KVRows,
  KVVal,
  ListHead,
  StatCard,
} from "../../ui/data";
import {
  Meter,
  ArchiveAbsentGate,
  SectionHead,
  Verdict,
  TrackTitle,
  BeatSyncBreakersCard,
  collectBreakers,
  MOOD_GLOSS,
} from "../shared";

// ---- beatgrids --------------------------------------------------------------

export function BeatgridsTab() {
  const coverage = useCoverage();
  const page = useFetched<[ArchiveGridCrossCheck, ArchiveMoodProfile]>(
    () =>
      Promise.all([
        api<ArchiveGridCrossCheck>("/api/archive/grid-cross-check"),
        api<ArchiveMoodProfile>("/api/archive/mood"),
      ]),
    [],
  );
  if (page.status !== "ok")
    return <FetchedGate page={page} loading="loading beats ledger…" />;
  const [grid, mood] = page.data;
  const off = grid.available ? grid.off : [];
  const octave = grid.available ? grid.octave : [];
  const drift = grid.available ? grid.drift : [];
  const syncRisk = off.length + octave.length + drift.length;
  // severity order (octave → drift → off) is owned by collectBreakers
  const breakers = collectBreakers(grid);
  const ledgered = grid.available ? grid.ledgered : 0;
  const checked = grid.available ? grid.checked : 0;
  const inArchive = mood.available ? mood.analyzed : 0;

  return (
    <div>
      <TabIntro
        what="Beatgrids: the independent beat_this analysis vs what rekordbox wrote."
        how="beat_this re-analyzes every track; the beat array is fitted to one constant tempo (grid-locked music) and compared against rekordbox's BPM. 'off' = tempo disagrees by >2%; 'octave' = locked half/double (Sync jumps); 'drift' = the grid slides >15 ms across the track (wrong tempo, counted grids look fine). Everything else agreed."
        next="BPM tag writes stay BLOCKED until the bar-grid re-gate passes (roadmap) — the ledger is truth until then. Re-analyze with `megadj beats`."
      />
      {!grid.available ? (
        <ArchiveAbsentGate />
      ) : (
        <>
          <CoverageStrip cov={coverage} active="beats" />
          <Verdict
            cls={syncRisk === 0 ? "ok" : "warn"}
            text={
              ledgered === 0
                ? "No beats ledger yet — run `megadj beats` to analyze the archive."
                : syncRisk === 0
                  ? `All ${checked} checked grids agree with rekordbox — Beat Sync is safe.`
                  : `${syncRisk} of ${checked} grids disagree with rekordbox — those tracks will misbehave on Beat Sync.`
            }
            meta={
              ledgered > 0
                ? `${octave.length} octave · ${drift.length} drift · ${off.length} off · ${grid.ok} ok`
                : undefined
            }
          />

          {ledgered > 0 && (
            <div class="card">
              <Meter
                done={ledgered}
                total={inArchive || ledgered}
                label="of the archive in the beats ledger"
                cls="ok"
              />
              {inArchive > ledgered && (
                <div class="arch-fix">
                  {inArchive - ledgered} tracks not yet analyzed — fix:{" "}
                  <code>megadj beats</code>
                </div>
              )}
            </div>
          )}

          {syncRisk > 0 && (
            <BeatSyncBreakersCard
              breakers={breakers}
              syncRisk={syncRisk}
              hint="These tracks' independent beatgrid analysis disagrees with rekordbox — off by >2% tempo, locked an octave (half/double) out, or drifting positionally across the track (>15 ms). They will drift or jump badly when you hit Sync on hardware, even though they sound fine at home. Octave rows are the worst (Sync lands on the wrong pulse entirely); drift rows slide out of phase as the track plays. Click a numeric header to sort."
              fixNote={
                <>
                  <code>megadj beats --force</code> re-analyzes — batch BPM tag
                  writes stay gated (roadmap)
                </>
              }
            />
          )}

          {ledgered === 0 && (
            <div class="note-card">
              <Icon name="pulse" size={20} />
              The beats ledger is empty — <code>megadj beats</code> fills it
              (beat_this BPM + beat arrays per track).
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- mood -------------------------------------------------------------------

export function MoodTab() {
  const coverage = useCoverage();
  const page = useFetched<ArchiveMoodProfile>(
    () => api<ArchiveMoodProfile>("/api/archive/mood"),
    [],
  );
  if (page.status !== "ok")
    return <FetchedGate page={page} loading="loading mood ledger…" />;
  const mood = page.data;
  if (!mood.available) return <ArchiveAbsentGate />;

  return (
    <div>
      <CoverageStrip cov={coverage} active="mood" />
      <TabIntro
        what="The vibe map: what the mood models say the archive sounds like."
        how="Every archived track is scored by ONNX heads — danceability, party/aggressive/electronic mood, valence (sad → happy, 1–9) and arousal (calm → intense, 1–9). Averages describe the library's character; the extremes are set-planning lookups ('play something dark/hyped/smooth')."
        next="Stamps live on the files as TXXX:MOOD and in the DB ledger; the write pass is `megadj mood`."
      />
      {mood.analyzed === 0 ? (
        <div class="note-card">
          <Icon name="bolt" size={20} />
          Nothing analyzed yet — <code>megadj mood</code> runs the ONNX heads
          (~320 MB of models on first run).
        </div>
      ) : (
        <>
          <Verdict
            cls="ok"
            text={`${mood.analyzed} tracks carry a mood profile.`}
            meta="TXXX:MOOD on the files · mirrored in the DB ledger"
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
                em={(MOOD_GLOSS[k] ?? "").split("·")[1]?.trim()}
                title={MOOD_GLOSS[k] ?? k}
              />
            ))}
          </div>
          <SectionHead
            icon="compass"
            title="Extremes — the set-planning lookups"
          />
          <div class="archive-cols">
            {(["valence", "arousal", "dance"] as const).map((dim) => {
              const list = mood.extremes[dim] ?? [];
              const high = list.slice(0, Math.ceil(list.length / 2));
              const low = list.slice(Math.ceil(list.length / 2));
              return (
                <div class="card" key={dim}>
                  <ListHead
                    icon="bolt"
                    title={`${dim} extremes`}
                    n={list.length}
                    hint={`${MOOD_GLOSS[dim] ?? dim} — highest and lowest scored tracks. This is the 'play me something …' picker data.`}
                    lines={[
                      ...high.map(
                        (t) => `HIGH ${t.v} — ${t.title ?? t.video_id}`,
                      ),
                      ...low.map(
                        (t) => `LOW ${t.v} — ${t.title ?? t.video_id}`,
                      ),
                    ]}
                  />
                  <KVRows>
                    {high.map((t) => (
                      <KVRow key={t.video_id}>
                        <KVKey>
                          <TrackTitle
                            title={t.title ?? t.video_id}
                            videoId={t.video_id}
                            artist={t.artist}
                          />
                        </KVKey>
                        <KVVal>
                          <span class="arch-pill warn">
                            {dim} {t.v}
                          </span>
                        </KVVal>
                      </KVRow>
                    ))}
                    {low.map((t) => (
                      <KVRow key={t.video_id}>
                        <KVKey>
                          <TrackTitle
                            title={t.title ?? t.video_id}
                            videoId={t.video_id}
                            artist={t.artist}
                          />
                        </KVKey>
                        <KVVal>
                          {dim} {t.v}
                        </KVVal>
                      </KVRow>
                    ))}
                    {list.length === 0 && (
                      <div class="fleet-note">no scores on this axis</div>
                    )}
                  </KVRows>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ---- cues -------------------------------------------------------------------

/** cue position seconds → "3:24" / "42s" (table + copy share it). */
function fmtCueAt(s: number): string {
  return s >= 60
    ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`
    : `${Math.round(s)}s`;
}

export function CuesTab() {
  const coverage = useCoverage();
  const page = useFetched<ArchiveCueStats>(
    () => api<ArchiveCueStats>("/api/archive/cues"),
    [],
  );
  if (page.status !== "ok")
    return <FetchedGate page={page} loading="loading cues ledger…" />;
  const cues = page.data;
  if (!cues.available) return <ArchiveAbsentGate />;

  return (
    <div>
      <CoverageStrip cov={coverage} active="cues" />
      <TabIntro
        what="Structure cues: 8-bar phrase markers derived from each track's downbeats."
        how="Phrase cues mark the natural section boundaries (every 8 bars) — the places a DJ mixes in and out. They're derived from the beats ledger and stored DB-side; pushing them to rekordbox memory cues is a separate gated step (not shipped)."
        next="Rebuild with `megadj cues`. The first cue (bar 1) is the mix-in point; the last is usually the outro."
      />
      {cues.analyzed === 0 ? (
        <div class="note-card">
          <Icon name="play" size={20} />
          The cues ledger is empty — <code>megadj cues</code> derives phrase
          markers from the beats ledger.
        </div>
      ) : (
        <>
          <Verdict
            cls="ok"
            text={`${cues.analyzed} tracks carry ${cues.total_cues.toLocaleString()} phrase cues (avg ${cues.avg_cues} per track).`}
            meta="DB-side — rekordbox cue writes are gated, not shipped"
          />
          <div class="statgrid">
            <StatCard
              v={cues.analyzed.toLocaleString()}
              l="tracks with cues"
              icon="disc"
            />
            <StatCard
              v={cues.total_cues.toLocaleString()}
              l="phrase markers total"
              icon="play"
            />
            <StatCard
              v={`${cues.avg_cues}`}
              l="avg cues per track"
              icon="hash"
            />
          </div>
          <SectionHead icon="history" title="Freshest cue sets">
            <span class="sect-n">{cues.tracks.length}</span>
          </SectionHead>
          <div class="card">
            <ListHead
              icon="play"
              title="Cue ledger (newest first)"
              n={cues.tracks.length}
              hint="Per-track cue counts and the position of the first cue (bar 1 = the mix-in point)."
              lines={cues.tracks.map(
                (t) =>
                  `${t.title ?? t.video_id}${t.artist ? ` — ${t.artist}` : ""} · ${t.cue_count} cues`,
              )}
            />
            <DataTable
              columns={[
                {
                  key: "track",
                  head: "track",
                  grow: 1.6,
                  cell: (t) => (
                    <>
                      <b>{t.title ?? t.video_id}</b>
                      {t.artist && <span class="covartist"> — {t.artist}</span>}
                    </>
                  ),
                  sortValue: (t) => (t.title ?? t.video_id).toLowerCase(),
                },
                {
                  key: "cues",
                  head: "cues",
                  align: "end",
                  min: 54,
                  grow: 0,
                  cell: (t) => t.cue_count,
                  sortValue: (t) => t.cue_count,
                },
                {
                  key: "first",
                  head: "first at",
                  align: "end",
                  min: 64,
                  grow: 0,
                  cell: (t) => fmtCueAt(t.first_cue_at),
                  sortValue: (t) => t.first_cue_at,
                },
                {
                  key: "model",
                  head: "model",
                  min: 90,
                  cell: (t) => <span class="dt-sub">{t.model}</span>,
                  sortValue: (t) => t.model,
                },
              ]}
              rows={cues.tracks}
              cap={40}
              ariaLabel="Cue ledger"
              copyName="Cue ledger (newest first)"
              copyLines={(rows) =>
                rows.map(
                  (t) =>
                    `${t.title ?? t.video_id}${t.artist ? ` — ${t.artist}` : ""} · ${t.cue_count} cues`,
                )
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
