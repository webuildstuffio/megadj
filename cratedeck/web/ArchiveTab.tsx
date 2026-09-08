// ArchiveTab.tsx — the archive half of surface-parity A3.
//
// Archive reads (ingest status, mood profile, LOWQ queue, grid
// cross-check) were CLI (deckctl archive*)/MCP (archive_*) only at audit
// time. This closes it: one tab on the Fleet page over the same readonly
// routes deckctl consumes. Everything here degrades to "not available"
// when the archive DB is absent — same as the MCP tools.

import type {
  ArchiveGridCrossCheck,
  ArchiveIngestStatus,
  ArchiveLowqQueue,
  ArchiveMoodProfile,
} from "../shared/types";
import { api } from "./toast";
import { Icon } from "./icons";
import { StatCard } from "./DrivePanels";
import { useFetched } from "./useFetched";

// Payload types are DERIVED from ArchiveReader's return types
// (shared/types.ts) — never re-declare server shapes locally. Local
// duplicates drift silently; the Sep 7 rev shipped three of them.
type IngestPayload = ArchiveIngestStatus;
type MoodPayload = ArchiveMoodProfile;
type LowqPayload = ArchiveLowqQueue;
type GridPayload = ArchiveGridCrossCheck;

type ArchivePayload = [IngestPayload, MoodPayload, LowqPayload, GridPayload];

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

  if (page.status === "error")
    return (
      <div class="card">
        <div class="empty">
          <Icon name="x" size={16} /> Archive reads failed: {page.message}
        </div>
      </div>
    );
  if (!ingest)
    return (
      <div class="card">
        <div class="empty">loading archive reads…</div>
      </div>
    );

  return (
    <div class="archive-cols">
      <div class="card">
        <h3>
          <Icon name="doc" size={14} /> Ingest status
        </h3>
        {!ingest.available ? (
          <div class="empty">archive DB absent</div>
        ) : (
          <>
            <div class="statgrid">
              {Object.entries(ingest.counts).map(([k, v]) => (
                <StatCard key={k} v={String(v)} l={k} icon="dot" />
              ))}
            </div>
            {ingest.recent_runs.length > 0 && (
              <div class="rows">
                {ingest.recent_runs.map((r, i) => (
                  <div class="row" key={i}>
                    <span>{new Date(r.started_at).toLocaleString()}</span>
                    <span class="muted">
                      +{r.downloaded}
                      {r.failed > 0 ? ` · ${r.failed} failed` : ""}
                      {r.gone > 0 ? ` · ${r.gone} gone` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div class="card">
        <h3>
          <Icon name="bolt" size={14} /> Mood profile
        </h3>
        {!mood?.available ? (
          <div class="empty">mood ledger empty</div>
        ) : (
          <>
            <div class="statgrid">
              <StatCard v={String(mood.analyzed)} l="analyzed" icon="check" />
              {Object.entries(mood.avg).map(([k, v]) => (
                <StatCard key={k} v={v.toFixed(2)} l={k} icon="dot" />
              ))}
            </div>
            {(["valence", "arousal", "dance"] as const).map((dim) => {
              const list = mood.extremes[dim] ?? [];
              if (list.length === 0) return null;
              return (
                <div key={dim} class="pf-blockers">
                  <b>{dim}</b>
                  {list.map((t) => (
                    <div key={t.video_id}>· {t.title}</div>
                  ))}
                </div>
              );
            })}
          </>
        )}
      </div>

      <div class="card">
        <h3>
          <Icon name="sort" size={14} /> LOWQ queue
        </h3>
        {!lowq?.available ? (
          <div class="empty">archive DB absent</div>
        ) : lowq.tracks.length === 0 ? (
          <div class="empty">queue empty — nothing flagged</div>
        ) : (
          <div class="rows">
            {lowq.tracks.map((t) => (
              <div class="row" key={t.video_id}>
                <span>{t.title}</span>
                <span class="muted">{t.artist ?? "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div class="card">
        <h3>
          <Icon name="grid" size={14} /> Grid cross-check
        </h3>
        {!grid?.available ? (
          <div class="empty">beats ledger absent — run megadj beats</div>
        ) : (
          <>
            <div class="statgrid">
              <StatCard v={String(grid.ok)} l="ok" icon="check" />
              <StatCard v={String(grid.off.length)} l="off" icon="warn" />
              <StatCard v={String(grid.octave.length)} l="octave" icon="x" />
            </div>
            <div class="fleet-sub">
              beat_this grid vs RB BPM×duration (rev 6 verdicts)
            </div>
          </>
        )}
      </div>
    </div>
  );
}
