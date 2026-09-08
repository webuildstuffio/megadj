// ArchiveTab.tsx — the archive half of surface-parity A3.
//
// Archive reads (ingest status, mood profile, LOWQ queue, grid
// cross-check) were CLI (deckctl archive*)/MCP (archive_*) only at audit
// time. This closes it: one tab on the Fleet page over the same readonly
// routes deckctl consumes. Everything here degrades to "not available"
// when the archive DB is absent — same as the MCP tools.

import { useEffect, useState } from "preact/hooks";
import { api } from "./toast";
import { Icon } from "./icons";

interface IngestPayload {
  available: boolean;
  counts: Record<string, number>;
  total: number;
  recent_runs: {
    started_at: string;
    finished_at: string | null;
    downloaded: number;
    failed: number;
    gone: number;
  }[];
  recent_tracks: { title: string; artist: string | null; status: string }[];
}

interface MoodPayload {
  available: boolean;
  analyzed: number;
  avg: Record<string, number>;
  extremes: Record<string, { title: string; video_id: string }[]>;
}

interface LowqPayload {
  available: boolean;
  tracks: { video_id: string; title: string; artist: string | null }[];
}

interface GridPayload {
  available: boolean;
  ledgered?: number;
  checked?: number;
  ok?: number;
  /** real payload: off/octave are per-track arrays, not counts */
  off?: { video_id: string; title: string | null }[];
  octave?: { video_id: string; title: string | null }[];
}

function Stat(props: { v: string; l: string; icon: string }) {
  return (
    <div class="stat">
      <div class="v">
        <Icon name={props.icon} size={13} /> {props.v}
      </div>
      <div class="l">{props.l}</div>
    </div>
  );
}

export function ArchiveTab() {
  const [ingest, setIngest] = useState<IngestPayload | null>(null);
  const [mood, setMood] = useState<MoodPayload | null>(null);
  const [lowq, setLowq] = useState<LowqPayload | null>(null);
  const [grid, setGrid] = useState<GridPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api<IngestPayload>("/api/archive/ingest-status"),
      api<MoodPayload>("/api/archive/mood"),
      api<LowqPayload>("/api/archive/lowq"),
      api<GridPayload>("/api/archive/grid-cross-check"),
    ])
      .then(([i, m, l, g]) => {
        if (!alive) return;
        setIngest(i);
        setMood(m);
        setLowq(l);
        setGrid(g);
      })
      .catch((e: Error) => alive && setErr(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  if (err)
    return (
      <div class="card">
        <div class="empty">
          <Icon name="x" size={16} /> Archive reads failed: {err}
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
                <Stat key={k} v={String(v)} l={k} icon="dot" />
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
              <Stat v={String(mood.analyzed)} l="analyzed" icon="check" />
              {Object.entries(mood.avg).map(([k, v]) => (
                <Stat key={k} v={v.toFixed(2)} l={k} icon="dot" />
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
              <Stat v={String(grid.ok ?? 0)} l="ok" icon="check" />
              <Stat v={String(grid.off?.length ?? 0)} l="off" icon="warn" />
              <Stat v={String(grid.octave?.length ?? 0)} l="octave" icon="x" />
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
