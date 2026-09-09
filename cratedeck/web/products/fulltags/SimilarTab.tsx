// SimilarTab.tsx — the FullTags "Similar" canvas (#/fulltags/similar),
// split out of FullTagsPage.tsx (file-length guard).
//
// Two propose-only views over the measured ledgers (§4-A1: nothing here
// writes anything):
//   Set builder (M66) — an ordered mix proposal from beats BPM + file TKEY
//                       + mood axes, shaped by an energy-arc preset
//   Sounds like (I49) — nearest tracks by effnet-embedding cosine
import { useState } from "preact/hooks";
import type { ArchiveSimilar, ArchiveSearchHit } from "../../../shared/types";
import { api } from "../../ui/toast";
import { Icon } from "../../ui/icons";
import { FetchedGate, useFetched } from "../../ui/useFetched";
import { TabIntro } from "../../ui/InfoTip";
import { ListHead } from "../../ui/ListHead";
import { SectionHead, Verdict, TrackTitle } from "../shared";

export function SimilarTab() {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<{
    video_id: string;
    title: string | null;
  } | null>(null);
  const hits = useFetched<ArchiveSimilar | null>(
    () =>
      picked
        ? api<ArchiveSimilar>(
            `/api/archive/similar?id=${encodeURIComponent(picked.video_id)}&k=10`,
          )
        : Promise.resolve(null),
    [picked],
  );
  // The search endpoint's wire shape is a BARE ARRAY (ArchiveTrack[]) —
  // derived from the producer in shared/types.ts, not re-declared here
  // (the round-4 lesson: a local duplicate drifted and crashed the render).
  const search = useFetched<ArchiveSearchHit[] | null>(
    () =>
      query.trim().length >= 2
        ? api<ArchiveSearchHit[]>(
            `/api/archive/search?q=${encodeURIComponent(query)}`,
          )
        : Promise.resolve(null),
    [query],
  );

  return (
    <div>
      <TabIntro
        what="Sounds like: nearest tracks by audio-embedding similarity, plus a set-builder that proposes an ordered mix."
        how="Pick a track (search by name) and the effnet model's 1280-d audio embedding finds its nearest neighbours — 'find me more like this one'. The builder below proposes a mix chain from the beats/mood ledgers + file keys: Camelot-compatible, within a ±6% tempo window, shaped into an energy arc. Both are pure reads; nothing is written."
        next="Empty corpus = embeddings not computed yet — run `megadj mood --embeddings`. Empty pool = run `megadj beats` too."
      />
      <SetBuildPanel />
      <div class="pl-tools">
        <input
          placeholder="Pick a track — search by title or artist…"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
      </div>
      {search.status === "ok" &&
        search.data &&
        !picked &&
        query.trim().length >= 2 && (
          <div class="card">
            <div class="rows">
              {search.data.slice(0, 8).map((t) => (
                <button
                  type="button"
                  class="row ghostbtn"
                  style={{ textAlign: "left", cursor: "pointer" }}
                  key={t.video_id}
                  onClick={() => {
                    setPicked(t);
                    setQuery("");
                  }}
                >
                  <TrackTitle
                    title={t.title ?? t.video_id}
                    videoId={t.video_id}
                    artist={t.artist}
                  />
                </button>
              ))}
              {search.data.length === 0 && (
                <div class="fleet-note">no tracks match “{query}”</div>
              )}
            </div>
          </div>
        )}
      {picked && (
        <div class="card">
          <ListHead
            icon="compass"
            title={`Sounds like ${picked.title ?? picked.video_id}`}
            n={(hits.status === "ok" && hits.data?.hits.length) || 0}
            hint="Ranked by cosine similarity of the audio embeddings — 1.0 is identical, higher is more similar."
            lines={
              hits.status === "ok" && hits.data
                ? hits.data.hits.map(
                    (h) =>
                      `${h.score.toFixed(4)}  ${h.artist ?? "?"} — ${h.title ?? h.video_id}`,
                  )
                : []
            }
          />
          {hits.status !== "ok" ? (
            <FetchedGate page={hits} loading="searching the embeddings…" />
          ) : hits.data && hits.data.corpus > 0 ? (
            <div class="rows">
              {hits.data.hits.map((h) => (
                <div class="row" key={h.video_id}>
                  <TrackTitle
                    title={h.title ?? h.video_id}
                    videoId={h.video_id}
                    artist={h.artist}
                  />
                  <span class="arch-pill ok">{h.score.toFixed(3)}</span>
                </div>
              ))}
              <button
                type="button"
                class="btn sm ghostbtn"
                onClick={() => setPicked(null)}
              >
                pick a different track
              </button>
            </div>
          ) : (
            <div class="note-card">
              <Icon name="bolt" size={20} />
              No embeddings yet — <code>megadj mood --embeddings</code> computes
              them (same pass as the mood heads, no extra model).
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- set-builder (M66, propose-only) ----------------------------------------

type SetBuildResult = {
  available: boolean;
  pool: number;
  preset: string;
  minutes: number;
  steps: {
    videoId: string;
    title: string | null;
    artist: string | null;
    bpm: number | null;
    key: string | null;
    arousal: number | null;
    atMin: number;
    transition: number | null;
  }[];
  excluded: { videoId: string; title: string | null; reason: string }[];
  excluded_total: number;
};

const fmtBpm = (bpm: number | null): string =>
  bpm === null ? "—" : String(Math.round(bpm * 10) / 10);

const SET_PRESET_LABELS: Record<string, string> = {
  warmup: "Warm-up",
  peak: "Peak time",
  afterhours: "After hours",
};

function SetBuildPanel() {
  const [preset, setPreset] = useState<"warmup" | "peak" | "afterhours">(
    "peak",
  );
  const [minutes, setMinutes] = useState(60);
  const [build, setBuild] = useState<{
    data: SetBuildResult | null;
    loading: boolean;
    error: string | null;
  }>({ data: null, loading: false, error: null });

  const run = async () => {
    setBuild({ data: null, loading: true, error: null });
    try {
      const data = await api<SetBuildResult>(
        `/api/archive/setbuild?preset=${preset}&minutes=${minutes}`,
      );
      setBuild({ data, loading: false, error: null });
    } catch (e) {
      setBuild({ data: null, loading: false, error: String(e) });
    }
  };

  return (
    <div class="card">
      <SectionHead icon="compass" title="Set builder — propose a mix" />
      <div
        class="pl-tools"
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <select
          value={preset}
          onChange={(e) =>
            setPreset((e.target as HTMLSelectElement).value as typeof preset)
          }
        >
          {Object.entries(SET_PRESET_LABELS).map(([id, label]) => (
            <option value={id} key={id}>
              {label}
            </option>
          ))}
        </select>
        <label
          class="muted"
          style={{ display: "flex", gap: 6, alignItems: "center" }}
        >
          minutes
          <input
            type="number"
            min={10}
            max={240}
            value={minutes}
            style={{ width: 72 }}
            onChange={(e) =>
              setMinutes(
                Math.min(
                  240,
                  Math.max(
                    10,
                    Number((e.target as HTMLInputElement).value) || 60,
                  ),
                ),
              )
            }
          />
        </label>
        <button
          type="button"
          class="btn sm"
          onClick={run}
          disabled={build.loading}
        >
          <Icon name="play" size={12} />{" "}
          {build.loading ? "building…" : "Build proposal"}
        </button>
      </div>
      {build.error && <div class="arch-fix">build failed: {build.error}</div>}
      {build.data && (
        <>
          <Verdict
            cls={build.data.pool === 0 ? "warn" : "ok"}
            text={
              build.data.pool === 0
                ? "No candidates — run `megadj beats` + `megadj mood` so the builder has BPM/mood data."
                : `${build.data.steps.length}-track ${SET_PRESET_LABELS[build.data.preset] ?? build.data.preset} proposal from a ${build.data.pool}-track pool — ${build.data.minutes} min.`
            }
            meta="propose-only — nothing is written; accept tracks into a playlist by hand"
          />
          {build.data.steps.length > 0 && (
            <ListHead
              icon="play"
              title="The chain"
              n={build.data.steps.length}
              hint="Ordered mix proposal: key-compatible (Camelot), tempo within ±6%, energy following the arc. Copy hands it to an agent or your notes."
              lines={build.data.steps.map(
                (s) =>
                  `${s.atMin}min  ${fmtBpm(s.bpm)} BPM ${s.key ?? ""}  ${s.artist ?? "?"} — ${s.title ?? s.videoId}`,
              )}
            />
          )}
          <div class="covtable">
            <div class="covrow head">
              <span>#</span>
              <span>track</span>
              <span>bpm</span>
              <span>key</span>
              <span>at</span>
            </div>
            {build.data.steps.slice(0, 40).map((s, i) => (
              <div class="covrow" key={s.videoId}>
                <span class="n">{i + 1}</span>
                <span class="covpath">
                  <b>{s.title ?? s.videoId}</b>
                  {s.artist && <span class="covartist"> — {s.artist}</span>}
                </span>
                <span class="n">{fmtBpm(s.bpm)}</span>
                <span class="n">{s.key ?? "—"}</span>
                <span class="n">{s.atMin}m</span>
              </div>
            ))}
            {build.data.steps.length > 40 && (
              <div class="fleet-note">
                showing 40 of {build.data.steps.length} — Copy has the full
                chain
              </div>
            )}
          </div>
          {build.data.excluded_total > 0 && (
            <div class="arch-fix">
              {build.data.excluded_total} of {build.data.pool} candidates not in
              the chain —{" "}
              {build.data.excluded[0]?.reason ?? "see the excluded list"}
            </div>
          )}
        </>
      )}
    </div>
  );
}
