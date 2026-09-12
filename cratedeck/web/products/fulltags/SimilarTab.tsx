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
  SetBuildStep,
  SetPresetDef,
} from "../../../shared/types";
import {
  SET_PRESET_DEFS,
  SET_MINUTES_MAX,
  SET_MINUTES_MIN,
} from "../../../shared/types";
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

/** The wire row a track-pick search deals in: the search endpoint returns
 *  ArchiveTrack-shaped rows; the caller keeps (video_id, title, artist). */
export interface TrackPick {
  video_id: string;
  title: string | null;
  artist?: string | null;
}

/** Search + pick ONE track — the shared picker under both panels (the
 *  sounds-like query track and the set-builder opener both need it; two
 *  hand-rolled variants had already drifted once). Debounces nothing —
 *  hits stream live from ≥2 chars; picking clears the query. */
export function TrackPickSearch(props: {
  query: string;
  onQuery: (v: string) => void;
  hits: ArchiveSearchHit[] | null;
  hitsStatus: "ok" | "loading" | "error";
  placeholder: string;
  onPick: (t: TrackPick) => void;
  /** optional footer note under the results (e.g. "no matches") */
  emptyNote?: string;
}) {
  return (
    <>
      <SearchBar
        value={props.query}
        onInput={props.onQuery}
        placeholder={props.placeholder}
      />
      {props.query.trim().length === 1 && (
        <div class="fleet-note" role="status" aria-live="polite">
          Type 2 or more characters to search.
        </div>
      )}
      {props.query.trim().length >= 2 && props.hitsStatus === "loading" && (
        <div class="fleet-note" role="status" aria-live="polite">
          Searching the archive…
        </div>
      )}
      {props.query.trim().length >= 2 && props.hitsStatus === "error" && (
        <div class="arch-fix" role="alert">
          Search failed. Try again.
        </div>
      )}
      {props.hitsStatus === "ok" &&
        props.hits &&
        props.query.trim().length >= 2 && (
          <Card>
            <KVRows>
              {props.hits.slice(0, 8).map((t) => (
                <button
                  type="button"
                  class="kvrow kvrow-btn"
                  key={t.video_id}
                  onClick={() => props.onPick(t)}
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
              {props.hits.length === 0 && props.emptyNote && (
                <div class="fleet-note">{props.emptyNote}</div>
              )}
            </KVRows>
          </Card>
        )}
    </>
  );
}

export function SimilarTab() {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<TrackPick | null>(null);
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
      <TrackPickSearch
        query={query}
        onQuery={setQuery}
        hits={search.status === "ok" ? search.data : null}
        hitsStatus={search.status}
        placeholder="Pick a track — search by title or artist…"
        emptyNote={`no tracks match “${query.trim()}”`}
        onPick={(t) => {
          setPicked(t);
          setQuery("");
        }}
      />
      {picked && (
        <Card>
          <ListHead
            icon="compass"
            title={`Sounds like ${picked.title ?? picked.video_id}`}
            n={(hits.status === "ok" && hits.data?.hits.length) || 0}
            hint="Ranked by cosine similarity of the audio embeddings — 1.0 is identical, higher is more similar."
            lines={
              hits.status === "ok" && hits.data
                ? hits.data.hits.map(similarHitLine)
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

/** ISO timestamp → age in whole days (null input → null). Module scope —
 *  unicorn(consistent-function-scoping) + shared by both surfaces. */
const daysAgo = (iso: string | null): number | null =>
  iso === null ? null : Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);

/** Days-since → display word ("never" / "today" / "3d ago"). */
const ageWord = (d: number | null): string =>
  d === null ? "never" : d <= 0 ? "today" : `${d}d ago`;

/** Pool freshness: ledger ages under the proposal, so a stale pool is
 *  VISIBLE instead of silently proposing from yesterday's analysis. Tone:
 *  ok ≤2 days, warn ≤14 days, stale beyond — matches the archive's
 *  living-library rhythm, not a fixed clock. */
function FreshnessLine(props: {
  freshness: { beatsAt: string | null; moodAt: string | null };
  pool: number;
}) {
  if (props.pool === 0) return null;
  const beats = daysAgo(props.freshness.beatsAt);
  const mood = daysAgo(props.freshness.moodAt);
  const worst = Math.max(
    beats ?? Number.POSITIVE_INFINITY,
    mood ?? Number.POSITIVE_INFINITY,
  );
  const cls = worst <= 2 ? "ok" : worst <= 14 ? "warn" : "stale";
  return (
    <div class={`setbuild-fresh ${cls}`}>
      analysis freshness — beats {ageWord(beats)}, mood {ageWord(mood)}
      {worst > 2 && (
        <span class="fresh-note">
          {" "}
          — newer imports? run <code>megadj beats</code> +{" "}
          <code>megadj mood</code>
        </span>
      )}
    </div>
  );
}

/** preset id → human label, straight from the shared registry (unknown id
 *  falls back to the raw id rather than lying). Module scope so the panel
 *  doesn't recreate it per render. */
const presetLabel = (id: string): string =>
  SET_PRESET_DEFS.find((p) => p.id === id)?.label ?? id;

/** ONE line shape for a sounds-like hit — the copy block and any future
 *  consumer agree (mirrors `megadj similar`'s stdout rows). */
const similarHitLine = (h: {
  score: number;
  artist: string | null;
  title: string | null;
  video_id: string;
}): string =>
  `${h.score.toFixed(4)}  ${h.artist ?? "?"} — ${h.title ?? h.video_id}`;

/** ONE line-renderer for a chain step — the copy block, the ListHead lines
 *  and the excluded cross-check all show the same shape (was two drifted
 *  inline arrow pairs). */
const stepLine = (s: SetBuildStep): string =>
  `${s.atMin}min  ${fmtBpm(s.bpm)} BPM ${s.key ?? ""}  ${s.artist ?? "?"} — ${s.title ?? s.videoId}`;

/** minutes → the seconds since epoch the <input type=number> wants. */
const clampMinutes = (raw: number): number =>
  Number.isFinite(raw)
    ? Math.min(SET_MINUTES_MAX, Math.max(SET_MINUTES_MIN, Math.round(raw)))
    : 60;

const energyBand = (value: number): string =>
  value < 3.5 ? "Low" : value < 6 ? "Medium" : value < 8 ? "High" : "Maximum";

const arcY = (value: number): number => 30 - ((value - 1) / 8) * 22;

function PresetOption(props: {
  preset: SetPresetDef;
  selected: boolean;
  disabled: boolean;
  index: number;
  onSelect: (preset: SetPresetDef) => void;
}) {
  const { preset, selected } = props;
  const descriptionId = `setbuild-preset-${preset.id}-description`;
  const [start, end] = preset.arousal;
  const rising = end >= start;

  return (
    <button
      type="button"
      class={`setbuild-preset-option${selected ? " on" : ""}`}
      role="radio"
      aria-checked={selected}
      aria-describedby={descriptionId}
      tabIndex={selected ? 0 : -1}
      disabled={props.disabled}
      onClick={() => props.onSelect(preset)}
      onKeyDown={(event) => {
        const last = SET_PRESET_DEFS.length - 1;
        const nextIndex =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : event.key === "ArrowRight" || event.key === "ArrowDown"
                ? (props.index + 1) % SET_PRESET_DEFS.length
                : event.key === "ArrowLeft" || event.key === "ArrowUp"
                  ? (props.index + last) % SET_PRESET_DEFS.length
                  : null;
        if (nextIndex === null) return;
        event.preventDefault();
        const next = SET_PRESET_DEFS[nextIndex];
        if (!next) return;
        props.onSelect(next);
        event.currentTarget.parentElement
          ?.querySelectorAll<HTMLElement>('[role="radio"]')
          .item(nextIndex)
          .focus();
      }}
    >
      <span class="setbuild-preset-head">
        <strong>{preset.label}</strong>
        {selected && (
          <span class="setbuild-preset-selected">
            <Icon name="check" size={11} /> Selected
          </span>
        )}
      </span>
      <svg
        class="setbuild-preset-arc"
        viewBox="0 0 120 36"
        role="img"
        aria-label={`${preset.label} energy ${rising ? "rises" : "falls"} from ${energyBand(start)} to ${energyBand(end)}`}
      >
        <path class="setbuild-preset-guide" d="M4 30 H116" />
        <path
          class="setbuild-preset-line"
          d={`M4 ${arcY(start)} C42 ${arcY(start)}, 78 ${arcY(end)}, 116 ${arcY(end)}`}
        />
        <circle cx="4" cy={arcY(start)} r="2.5" />
        <circle cx="116" cy={arcY(end)} r="2.5" />
      </svg>
      <span class="setbuild-preset-range" aria-hidden="true">
        <span>{energyBand(start)}</span>
        <span>{rising ? "rises to" : "drifts to"}</span>
        <span>{energyBand(end)}</span>
      </span>
      <span id={descriptionId} class="setbuild-preset-description">
        {preset.description}
      </span>
    </button>
  );
}

/** Set-builder opener: the first track, either auto-picked by the arc or
 *  forced (the `opener` param every other surface takes). */
function OpenerPicker(props: {
  query: string;
  onQuery: (v: string) => void;
  hits: ArchiveSearchHit[] | null;
  hitsStatus: "ok" | "loading" | "error";
  opener: TrackPick | null;
  onPick: (t: TrackPick | null) => void;
  busy: boolean;
}) {
  if (props.opener)
    return (
      <span class="setbuild-opener" title="Forced opener — the arc starts here">
        opener: <b>{props.opener.title ?? props.opener.video_id}</b>
        <button
          type="button"
          class="plsearch-clear"
          aria-label="Clear opener (auto-pick instead)"
          title="Clear opener (auto-pick instead)"
          disabled={props.busy}
          onClick={() => props.onPick(null)}
        >
          <Icon name="x" size={11} />
        </button>
      </span>
    );
  if (props.busy)
    return (
      <span class="setbuild-opener-disabled" aria-disabled="true">
        set opener… <span>available after this build</span>
      </span>
    );
  return (
    <details class="setbuild-opener-pick">
      <summary title="Force the first track — the arc is built from it">
        set opener…
      </summary>
      <TrackPickSearch
        query={props.query}
        onQuery={props.onQuery}
        hits={props.hits}
        hitsStatus={props.hitsStatus}
        placeholder="Search for the opener — title or artist…"
        emptyNote="no tracks match"
        onPick={(t) => {
          props.onPick(t);
          props.onQuery("");
        }}
      />
    </details>
  );
}

/** "62.3m" cumulative clock + the ±6% window's key/tempo pills per step. */
function SetBuildPanel() {
  // the picker is keyed off the SHARED registry — preset ids, labels and
  // arc descriptions render from SET_PRESET_DEFS, never a local twin
  const [preset, setPreset] = useState<SetPresetDef>(
    SET_PRESET_DEFS.find((p) => p.id === "peak") ?? SET_PRESET_DEFS[0]!,
  );
  const [minutesInput, setMinutesInput] = useState("60");
  const minutes =
    minutesInput.trim() === "" ? 60 : clampMinutes(Number(minutesInput));
  const [opener, setOpener] = useState<TrackPick | null>(null);
  const [openerQuery, setOpenerQuery] = useState("");
  const openerSearch = useFetched<ArchiveSearchHit[] | null>(
    () =>
      openerQuery.trim().length >= 2
        ? api<ArchiveSearchHit[]>(
            `/api/archive/search?q=${encodeURIComponent(openerQuery)}`,
          )
        : Promise.resolve(null),
    [openerQuery],
  );
  const [build, setBuild] = useState<{
    data: SetBuildPayload | null;
    loading: boolean;
    error: string | null;
    stale: boolean;
  }>({ data: null, loading: false, error: null, stale: false });

  const invalidateProposal = () => {
    setBuild((current) =>
      current.data && !current.loading && !current.stale
        ? { ...current, stale: true }
        : current,
    );
  };

  const run = async () => {
    setBuild({ data: null, loading: true, error: null, stale: false });
    try {
      const q = new URLSearchParams({
        preset: preset.id,
        minutes: String(minutes),
      });
      if (opener) q.set("opener", opener.video_id);
      setBuild({
        data: await api<SetBuildPayload>(`/api/archive/setbuild?${q}`),
        loading: false,
        error: null,
        stale: false,
      });
    } catch (e) {
      setBuild({
        data: null,
        loading: false,
        error: errMessage(e),
        stale: false,
      });
    }
  };

  // the chain's BPM arc — the same energy-arc glance the crate browser has
  const steps = build.data?.steps ?? [];
  const arcBpms = steps
    .map((s) => s.bpm)
    .filter((b): b is number => b !== null);
  // first→last Camelot glide, "8A → 5A" (null-safe at both ends; was a
  // broken IIFE that printed only the number for the first step)
  const keyGlide = (() => {
    const parsed = steps.map((s) => camelotOf(s.key));
    const first = parsed.find((k) => k !== null);
    const last = parsed.findLast((k) => k !== null);
    if (!first || !last) return null;
    return `${first.n}${first.letter} → ${last.n}${last.letter}`;
  })();
  const buildVerb = build.stale ? "Update" : "Build";
  const buildLabel = build.loading
    ? "Building your set…"
    : `${buildVerb} ${minutes}-minute ${preset.label} set`;

  return (
    <Card class="setbuild">
      <SectionHead icon="compass" title="Build a mix from your whole archive" />
      <p class="setbuild-lead">
        Choose how the room's energy should move. FullTags checks every actual
        file, then orders a playable proposal using tempo, key, and mood.
      </p>
      <fieldset class="setbuild-preset">
        <legend id="setbuild-preset-label">
          <span>1</span> Choose the energy journey
        </legend>
        <div
          class="setbuild-preset-grid"
          role="radiogroup"
          aria-labelledby="setbuild-preset-label"
        >
          {SET_PRESET_DEFS.map((p, index) => (
            <PresetOption
              key={p.id}
              preset={p}
              selected={preset.id === p.id}
              disabled={build.loading}
              index={index}
              onSelect={(next) => {
                if (next.id === preset.id) return;
                setPreset(next);
                invalidateProposal();
              }}
            />
          ))}
        </div>
      </fieldset>
      <div class="setbuild-setup-title">
        <span>2</span> Set the length and build
      </div>
      <div class="setbuild-controls">
        <label
          class="setbuild-minutes"
          title="Target set length — the chain fills until the budget is spent"
        >
          <span>
            Set length
            <small>
              {SET_MINUTES_MIN}–{SET_MINUTES_MAX} minutes
            </small>
          </span>
          <input
            type="number"
            min={SET_MINUTES_MIN}
            max={SET_MINUTES_MAX}
            value={minutesInput}
            aria-label={`Target set length in minutes (${SET_MINUTES_MIN}–${SET_MINUTES_MAX})`}
            disabled={build.loading}
            onInput={(event) => {
              const next = (event.target as HTMLInputElement).value;
              setMinutesInput(next);
              invalidateProposal();
            }}
            onBlur={() => setMinutesInput(String(minutes))}
          />
        </label>
        <OpenerPicker
          query={openerQuery}
          onQuery={setOpenerQuery}
          hits={openerSearch.status === "ok" ? openerSearch.data : null}
          hitsStatus={openerSearch.status}
          opener={opener}
          onPick={(next) => {
            if (next?.video_id === opener?.video_id) return;
            setOpener(next);
            invalidateProposal();
          }}
          busy={build.loading}
        />
        <button
          type="button"
          class="btn primary setbuild-build"
          onClick={run}
          disabled={build.loading}
          aria-busy={build.loading}
        >
          <Icon name="play" size={12} /> {buildLabel}
        </button>
      </div>
      <details class="setbuild-method">
        <summary>
          <span>How FullTags scores this proposal</span>
          <small>read-only</small>
        </summary>
        <dl class="setbuild-evidence" aria-label="Set builder evidence">
          <div>
            <dt>Sources</dt>
            <dd>
              Entire downloaded archive DB · Beats ledger BPM · file key tags ·
              Mood ledger energy
            </dd>
          </div>
          <div>
            <dt>Checks</dt>
            <dd>
              File exists · ±6% tempo window · Camelot-compatible key moves ·
              selected energy arc
            </dd>
          </div>
          <div>
            <dt>Output</dt>
            <dd>
              Writes no tags or playlists — review and accept tracks by hand
            </dd>
          </div>
        </dl>
      </details>
      {build.stale && (
        <div class="setbuild-stale" role="status">
          <b>Proposal settings changed.</b> The chain below still shows the
          previous build. Update it before using or copying the result.
        </div>
      )}
      {build.error && <div class="arch-fix">build failed: {build.error}</div>}
      {build.loading && (
        <div class="setbuild-loading" role="status" aria-live="polite">
          <span class="spin" aria-hidden="true" />
          Checking every downloaded DB row, then scoring actual files…
          <span class="muted"> takes a moment (per-file key reads)</span>
        </div>
      )}
      {build.data && (
        <>
          <Verdict
            cls={build.data.pool === 0 ? "warn" : "ok"}
            text={
              build.data.pool === 0
                ? build.data.source_total > 0 &&
                  build.data.missing_files === build.data.source_total
                  ? `No actual files found — all ${build.data.source_total} downloaded DB paths are missing. Run an archive sweep and repair the paths.`
                  : "No mixable actual files — run `megadj beats` + `megadj mood` so the builder has BPM/mood data."
                : `${build.data.steps.length}-track ${presetLabel(build.data.preset)} proposal from ${build.data.pool} actual files — ${build.data.source_total} downloaded DB rows checked${build.data.missing_files > 0 ? `, ${build.data.missing_files} missing files skipped` : ""} — ${build.data.minutes} min.`
            }
            meta={`propose-only — no tags or playlists written; ${build.data.key_reads} file key tag${build.data.key_reads === 1 ? "" : "s"} read${build.data.key_read_failures > 0 ? `, ${build.data.key_read_failures} failed and scored without key` : ""}`}
          />
          <FreshnessLine
            freshness={build.data.freshness}
            pool={build.data.pool}
          />
          {steps.length > 0 && (
            <ListHead
              icon="play"
              title="The chain"
              n={steps.length}
              hint="Ordered mix proposal: key-compatible (Camelot), tempo within ±6%, energy following the arc. Copy hands it to an agent or your notes. Click a column to sort."
              lines={steps.map(stepLine)}
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
            rows={steps}
            cap={40}
            ariaLabel="Set builder chain"
            copyName="The chain"
            copyLines={(rows) => rows.map(stepLine)}
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
              {keyGlide && <span class="muted">{keyGlide}</span>}
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
