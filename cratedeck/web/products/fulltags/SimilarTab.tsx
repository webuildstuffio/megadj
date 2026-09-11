// SimilarTab.tsx — the FullTags "Similar" canvas (#/fulltags/similar),
// split out of FullTagsPage.tsx (file-length guard).
//
// Two propose-only views over the measured ledgers (§4-A1: nothing here
// writes anything):
//   Sounds like (I49) — nearest tracks by effnet-embedding cosine
//   Set builder (M66) — an ordered mix proposal from beats BPM + file TKEY
//                       + mood axes, shaped by an energy-arc preset
import { useState } from "preact/hooks";
import type {
  ArchiveSimilar,
  ArchiveSearchHit,
  SetBuildPayload,
  SetPresetDef,
} from "../../../shared/types";
import { SET_PRESET_DEFS } from "../../../shared/types";
import { camelotOf } from "../../../shared/camelot";
import { api } from "../../ui/toast";
import { errMessage } from "../../../shared/fmt";
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
  Card,
  SearchBar,
} from "../../ui/data";
import { Sparkline } from "../../ui/charts";
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
      <SectionHead icon="compass" title="Sounds like — nearest by embedding" />
      <SearchBar
        value={query}
        onInput={(v) => setQuery(v)}
        placeholder="Pick a track — search by title or artist…"
      />
      {search.status === "ok" &&
        search.data &&
        !picked &&
        query.trim().length >= 2 && (
          <Card>
            <KVRows>
              {search.data.slice(0, 8).map((t) => (
                <button
                  type="button"
                  class="kvrow kvrow-btn"
                  key={t.video_id}
                  onClick={() => {
                    setPicked(t);
                    setQuery("");
                  }}
                >
                  <KVKey>
                    <TrackTitle
                      title={t.title ?? t.video_id}
                      videoId={t.video_id}
                      artist={t.artist}
                    />
                  </KVKey>
                  <KVVal>pick →</KVVal>
                </button>
              ))}
              {search.data.length === 0 && (
                <div class="fleet-note">no tracks match “{query}”</div>
              )}
            </KVRows>
          </Card>
        )}
      {picked && (
        <Card>
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
            <>
              <KVRows>
                {hits.data.hits.map((h) => (
                  <KVRow key={h.video_id}>
                    <KVKey>
                      <TrackTitle
                        title={h.title ?? h.video_id}
                        videoId={h.video_id}
                        artist={h.artist}
                      />
                    </KVKey>
                    <KVVal>
                      <span class="arch-pill ok">{h.score.toFixed(3)}</span>
                    </KVVal>
                  </KVRow>
                ))}
              </KVRows>
              <button
                type="button"
                class="btn sm ghostbtn"
                onClick={() => setPicked(null)}
              >
                pick a different track
              </button>
            </>
          ) : (
            <div class="note-card">
              <Icon name="bolt" size={20} />
              No embeddings yet — <code>megadj mood --embeddings</code> computes
              them (same pass as the mood heads, no extra model).
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ---- set-builder (M66, propose-only) ----------------------------------------
// The wire envelope (SetBuildPayload) is DERIVED from shared/types.ts —
// never re-declare server shapes locally (a local duplicate drifted once
// and crashed the render). The preset picker derives from the SAME
// SET_PRESET_DEFS registry the engine scores against.

const fmtBpm = (bpm: number | null): string =>
  bpm === null ? "—" : String(Math.round(bpm * 10) / 10);

/** preset id → human label, straight from the shared registry (unknown id
 *  falls back to the raw id rather than lying). Module scope so the panel
 *  doesn't recreate it per render. */
const presetLabel = (id: string): string =>
  SET_PRESET_DEFS.find((p) => p.id === id)?.label ?? id;

/** "62.3m" cumulative clock + the ±6% window's key/tempo pills per step. */
function SetBuildPanel() {
  // the picker is keyed off the SHARED registry — preset ids, labels and
  // arc descriptions render from SET_PRESET_DEFS, never a local twin
  const [preset, setPreset] = useState<SetPresetDef>(
    SET_PRESET_DEFS.find((p) => p.id === "peak") ?? SET_PRESET_DEFS[0]!,
  );
  const [minutes, setMinutes] = useState(60);
  const [build, setBuild] = useState<{
    data: SetBuildPayload | null;
    loading: boolean;
    error: string | null;
  }>({ data: null, loading: false, error: null });

  const run = async () => {
    setBuild({ data: null, loading: true, error: null });
    try {
      const data = await api<SetBuildPayload>(
        `/api/archive/setbuild?preset=${preset.id}&minutes=${minutes}`,
      );
      setBuild({ data, loading: false, error: null });
    } catch (e) {
      setBuild({ data: null, loading: false, error: errMessage(e) });
    }
  };

  // the chain's BPM arc — the same energy-arc glance the crate browser has
  const arcBpms =
    build.data?.steps
      .map((s) => s.bpm)
      .filter((b): b is number => b !== null) ?? [];

  return (
    <Card class="setbuild">
      <SectionHead
        icon="compass"
        title="Set builder — propose a mix"
      ></SectionHead>
      <div class="setbuild-controls">
        <div class="seg" role="radiogroup" aria-label="Energy arc preset">
          {SET_PRESET_DEFS.map((p) => (
            <button
              type="button"
              key={p.id}
              class={preset.id === p.id ? "on" : ""}
              title={p.description}
              aria-pressed={preset.id === p.id}
              onClick={() => setPreset(p)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label
          class="muted setbuild-minutes"
          title="Target set length — the chain fills until the budget is spent"
        >
          minutes
          <input
            type="number"
            min={10}
            max={240}
            value={minutes}
            style={{ width: 72 }}
            aria-label="Target set length in minutes (10–240)"
            onChange={(e) => {
              const raw = Number((e.target as HTMLInputElement).value);
              setMinutes(
                Number.isFinite(raw)
                  ? Math.min(240, Math.max(10, Math.round(raw)))
                  : 60,
              );
            }}
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
        <span class="setbuild-desc">{preset.description}</span>
      </div>
      {build.error && <div class="arch-fix">build failed: {build.error}</div>}
      {build.data && (
        <>
          <Verdict
            cls={build.data.pool === 0 ? "warn" : "ok"}
            text={
              build.data.pool === 0
                ? "No candidates — run `megadj beats` + `megadj mood` so the builder has BPM/mood data."
                : `${build.data.steps.length}-track ${presetLabel(build.data.preset)} proposal from a ${build.data.pool}-track pool — ${build.data.minutes} min.`
            }
            meta="propose-only — nothing is written; accept tracks into a playlist by hand"
          />
          {build.data.steps.length > 0 && (
            <ListHead
              icon="play"
              title="The chain"
              n={build.data.steps.length}
              hint="Ordered mix proposal: key-compatible (Camelot), tempo within ±6%, energy following the arc. Copy hands it to an agent or your notes. Click a column to sort."
              lines={build.data.steps.map(
                (s) =>
                  `${s.atMin}min  ${fmtBpm(s.bpm)} BPM ${s.key ?? ""}  ${s.artist ?? "?"} — ${s.title ?? s.videoId}`,
              )}
            />
          )}
          <DataTable
            columns={[
              {
                key: "pos",
                head: "#",
                align: "end",
                min: 34,
                grow: 0,
                cell: (_s, i) => i + 1,
              },
              {
                key: "track",
                head: "track",
                grow: 2,
                cell: (s) => (
                  <>
                    <b>{s.title ?? s.videoId}</b>
                    {s.artist && <span class="covartist"> — {s.artist}</span>}
                  </>
                ),
                sortValue: (s) => (s.title ?? s.videoId).toLowerCase(),
              },
              {
                key: "bpm",
                head: "bpm",
                align: "end",
                min: 56,
                grow: 0,
                cell: (s) => fmtBpm(s.bpm),
                sortValue: (s) => s.bpm,
              },
              {
                key: "key",
                head: "key",
                align: "center",
                min: 48,
                grow: 0,
                cell: (s) => s.key ?? "—",
                sortValue: (s) => s.key,
              },
              {
                key: "mix",
                head: "mix",
                align: "center",
                min: 44,
                grow: 0,
                cell: (s) =>
                  s.transition === null ? (
                    <span title="Opener — no transition into it">open</span>
                  ) : (
                    <span
                      class={`arch-pill ${s.transition >= 0.75 ? "ok" : "muted"}`}
                      title={`transition score into this track: ${s.transition.toFixed(3)} (tempo + key + arc fit)`}
                    >
                      {s.transition >= 0.75
                        ? "clean"
                        : s.transition >= 0.5
                          ? "ok"
                          : "tight"}
                    </span>
                  ),
                sortValue: (s) => s.transition,
              },
              {
                key: "at",
                head: "at",
                align: "end",
                min: 48,
                grow: 0,
                cell: (s) => `${s.atMin}m`,
                sortValue: (s) => s.atMin,
              },
            ]}
            rows={build.data.steps}
            cap={40}
            ariaLabel="Set builder chain"
            copyName="The chain"
            copyLines={(rows) =>
              rows.map(
                (s) =>
                  `${s.atMin}min  ${fmtBpm(s.bpm)} BPM ${s.key ?? ""}  ${s.artist ?? "?"} — ${s.title ?? s.videoId}`,
              )
            }
            rowTone={(s) => {
              // first step has no transition — never tinted
              if (s.transition === null) return "";
              return s.transition >= 0.5 ? "ok" : "warn";
            }}
          />
          {arcBpms.length >= 2 && (
            <div class="setbuild-arc">
              <span class="muted">bpm arc</span>
              <Sparkline
                values={arcBpms}
                title={`Energy arc across the chain (${Math.round(Math.min(...arcBpms))}–${Math.round(Math.max(...arcBpms))} BPM)`}
              />
              <span class="muted">
                {camelotOf(build.data.steps[0]?.key)?.n ?? "—"}
                {" → "}
                {(() => {
                  const keys = build.data.steps
                    .map((s) => camelotOf(s.key))
                    .filter((k) => k !== null);
                  return keys.length > 0
                    ? `${keys[keys.length - 1]!.n}${keys[keys.length - 1]!.letter}`
                    : "—";
                })()}
              </span>
            </div>
          )}
          {build.data.excluded_total > 0 && (
            <details class="setbuild-excluded">
              <summary>
                {build.data.excluded_total} of {build.data.pool} candidates not
                in the chain — why?
              </summary>
              <KVRows>
                {build.data.excluded.slice(0, 40).map((e) => (
                  <KVRow key={e.videoId}>
                    <KVKey>{e.title ?? e.videoId}</KVKey>
                    <KVVal>{e.reason}</KVVal>
                  </KVRow>
                ))}
                {build.data.excluded_total > build.data.excluded.length && (
                  <div class="fleet-note">
                    …and{" "}
                    {build.data.excluded_total - build.data.excluded.length}{" "}
                    more
                  </div>
                )}
              </KVRows>
            </details>
          )}
        </>
      )}
    </Card>
  );
}
