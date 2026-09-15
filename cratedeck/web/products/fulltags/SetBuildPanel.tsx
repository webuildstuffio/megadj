// SetBuildPanel.tsx — the set-builder panel, the Set product's canvas
// (#/set, rendered by ../set/SetPage.tsx; formerly a FullTags tab, then
// split out of SimilarTab.tsx for file length). The panel is the whole
// product flow: preset/length/sequencer form + proposal view.
//
// Propose-only (§4-A1: nothing here writes anything): the wire envelope
// (SetBuildPayload) is DERIVED from shared/types.ts — never re-declare
// server shapes locally (a local duplicate drifted once and crashed the
// render). The preset picker derives from the SAME SET_PRESET_DEFS
// registry the engine scores against.
import { useState } from "preact/hooks";
import type {
  ArchiveSearchHit,
  SetBuildPayload,
  SetBuildStep,
  SetPresetDef,
} from "../../../shared/types";
import {
  SET_PRESET_DEFS,
  SET_MINUTES_MAX,
  SET_MINUTES_MIN,
  isShelfOffline,
  clampSetPool,
} from "../../../shared/types";
import { api, toast } from "../../ui/toast";
import { errMessage } from "../../../shared/fmt";
import { Icon } from "../../ui/icons";
import { useFetched } from "../../ui/useFetched";
import { ListHead, DataTable, Card } from "../../ui/data";
import { SectionHead } from "../shared";
import { TrackPickSearch, type TrackPick } from "./TrackPickSearch";
import { SetBuilderMethod } from "./SetBuilderMethod";
import { SetBuilderResult } from "./SetBuilderResult";
import { SetArcChart } from "./SetArcChart";
import {
  StepTitle,
  PresetOption,
  SequencerRow,
  AdvancedDrawer,
} from "./SetBuildForm";
import {
  SetBuildLoading,
  FreshnessLine,
  ExcludedBreakdown,
  ReproLine,
  keyGlideOf,
} from "./SetBuildStatus";

const SET_DURATION_PRESETS = [30, 60, 90, 120] as const;

/** minutes → clamped custom input (the <input type=number> bounds). */
const clampMinutes = (raw: number): number =>
  Number.isFinite(raw)
    ? Math.min(SET_MINUTES_MAX, Math.max(SET_MINUTES_MIN, Math.round(raw)))
    : 60;

const fmtBpm = (bpm: number | null): string =>
  bpm === null ? "—" : String(Math.round(bpm * 10) / 10);

/** ONE line-renderer for a chain step — the copy block, the ListHead lines
 *  and the excluded cross-check all show the same shape (was two drifted
 *  inline arrow pairs). */
const stepLine = (s: SetBuildStep): string =>
  `${s.atMin}min  ${fmtBpm(s.bpm)} BPM ${s.key ?? ""}  ${s.artist ?? "?"} — ${s.title ?? s.videoId}`;

/** Save the proposal as a local review artifact. No API call and no library
 * mutation: the browser downloads exactly the measured result on screen. */
function saveDraft(data: SetBuildPayload): void {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          kind: "megadj-set-draft",
          savedAt: new Date().toISOString(),
          status: data.complete ? "complete" : "partial",
          ...data,
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `set-${data.preset}-${data.actualMinutes}min-${data.complete ? "draft" : "partial"}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
  toast(data.complete ? "Set draft saved" : "Partial set draft saved", "ok");
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
      <span
        class="setbuild-opener"
        title="Chosen opening track — the arc starts here"
      >
        <span>Opening track</span>
        <b>{props.opener.title ?? props.opener.video_id}</b>
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
        Opening track <span>Auto-picked for this build</span>
      </span>
    );
  return (
    <details class="setbuild-opener-pick">
      <summary title="Choose the first track — otherwise FullTags picks it">
        <Icon name="search" size={12} /> Choose opening track
        <span>optional · otherwise auto-picked</span>
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

export function SetBuildPanel() {
  // the picker is keyed off the SHARED registry — preset ids, labels and
  // arc descriptions render from SET_PRESET_DEFS, never a local twin
  const [preset, setPreset] = useState<SetPresetDef>(
    SET_PRESET_DEFS.find((p) => p.id === "peak") ?? SET_PRESET_DEFS[0]!,
  );
  const [minutesInput, setMinutesInput] = useState("60");
  const minutes =
    minutesInput.trim() === "" ? 60 : clampMinutes(Number(minutesInput));
  // A/B search override (E7): "auto" = server-side pool-size rule decides;
  // forcing greedy/beam is the compare hook for "was the deep search better?"
  const [searchChoice, setSearchChoice] = useState<"auto" | "greedy" | "beam">(
    "auto",
  );
  // Candidate-pool cap (the `?limit=`/`--limit`/MCP `limit` knob): null =
  // whole analyzed library (the default every surface shares); a number is
  // the newest-N recent imports — the "just this week's drops" build.
  const [poolLimitInput, setPoolLimitInput] = useState("");
  const poolLimit: number | null = (() => {
    const trimmed = poolLimitInput.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return clampSetPool(parsed);
  })();
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
    /** Date.now() when the current build started — the loading explainer
     *  derives its elapsed timer + phase from this. */
    startedAt: number | null;
  }>({
    data: null,
    loading: false,
    error: null,
    stale: false,
    startedAt: null,
  });

  const invalidateProposal = () => {
    setBuild((current) =>
      current.data && !current.loading && !current.stale
        ? { ...current, stale: true }
        : current,
    );
  };

  const run = async () => {
    setBuild({
      data: null,
      loading: true,
      error: null,
      stale: false,
      startedAt: Date.now(),
    });
    try {
      const q = new URLSearchParams({
        preset: preset.id,
        minutes: String(minutes),
      });
      if (searchChoice !== "auto") q.set("search", searchChoice);
      if (poolLimit !== null) q.set("limit", String(poolLimit));
      if (opener) q.set("opener", opener.video_id);
      setBuild({
        data: await api<SetBuildPayload>(`/api/archive/setbuild?${q}`, {
          timeoutMs: 90_000,
        }),
        loading: false,
        error: null,
        stale: false,
        startedAt: null,
      });
    } catch (e) {
      setBuild({
        data: null,
        loading: false,
        error: errMessage(e),
        stale: false,
        startedAt: null,
      });
    }
  };

  // the chain's steps + first→last Camelot glide (shared derivation in
  // SetBuildStatus — the chart caption and the panel never drift apart)
  const steps = build.data?.steps ?? [];
  const keyGlide = keyGlideOf(steps);
  const buildVerb = build.stale ? "Update" : "Build";
  const buildLabel = build.loading
    ? "Building your set…"
    : `${buildVerb} ${minutes}-minute ${preset.label} set`;
  const exportHref = (() => {
    if (!build.data) return null;
    const q = new URLSearchParams({
      preset: build.data.preset,
      minutes: String(build.data.minutes),
    });
    q.set("format", "m3u8");
    if (opener) q.set("opener", opener.video_id);
    // the export must reproduce the chain ON SCREEN: a forced sequencer or
    // a capped pool silently re-sequenced a different proposal (the m3u8
    // endpoint re-runs the build), so every A/B knob travels with it
    if (searchChoice !== "auto") q.set("search", searchChoice);
    if (poolLimit !== null) q.set("limit", String(poolLimit));
    return `/api/archive/setbuild?${q}`;
  })();

  return (
    <Card class="setbuild">
      <SectionHead icon="compass" title="Build a set from your entire shelf" />
      <p class="setbuild-lead">
        Choose the room's energy and a familiar length. FullTags checks the
        whole archive, removes missing files and duplicates, then orders a
        playable draft using tempo, key, and mood.
      </p>
      <form
        class="setbuild-form"
        aria-label="Set builder settings"
        onSubmit={(event) => {
          event.preventDefault();
          if (!build.loading) void run();
        }}
      >
        <fieldset class="setbuild-preset" disabled={build.loading}>
          <StepTitle n={1} title="Energy journey" />
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
        <fieldset class="setbuild-length" disabled={build.loading}>
          <StepTitle n={2} title="Set length" />
          <div class="setbuild-duration">
            <div
              class="setbuild-duration-presets"
              role="group"
              aria-label="Common set lengths"
            >
              {SET_DURATION_PRESETS.map((duration) => (
                <button
                  key={duration}
                  type="button"
                  class={`setbuild-duration-option${minutes === duration ? " on" : ""}`}
                  aria-pressed={minutes === duration}
                  onClick={() => {
                    setMinutesInput(String(duration));
                    invalidateProposal();
                  }}
                >
                  {duration} min
                </button>
              ))}
            </div>
            <label
              class="setbuild-minutes"
              title="Enter a custom target between the supported limits"
            >
              <span>
                Custom
                <small>
                  {SET_MINUTES_MIN}–{SET_MINUTES_MAX} minutes
                </small>
              </span>
              <input
                type="number"
                min={SET_MINUTES_MIN}
                max={SET_MINUTES_MAX}
                value={minutesInput}
                aria-label={`Custom set length in minutes (${SET_MINUTES_MIN}–${SET_MINUTES_MAX})`}
                onInput={(event) => {
                  const next = (event.target as HTMLInputElement).value;
                  setMinutesInput(next);
                  invalidateProposal();
                }}
                onBlur={() => setMinutesInput(String(minutes))}
              />
            </label>
          </div>
        </fieldset>
        <fieldset class="setbuild-length" disabled={build.loading}>
          <StepTitle n={3} title="Sequencer" />
          <SequencerRow
            searchChoice={searchChoice}
            onChoice={(value) => {
              setSearchChoice(value);
              invalidateProposal();
            }}
            disabled={build.loading}
          />
          <AdvancedDrawer
            poolLimitInput={poolLimitInput}
            onPoolLimitInput={(v) => {
              setPoolLimitInput(v);
              invalidateProposal();
            }}
            onPoolLimitBlur={() => setPoolLimitInput(String(poolLimit ?? ""))}
            disabled={build.loading}
            lastPool={build.data ? build.data.pool : null}
            searchChoice={searchChoice}
          />
        </fieldset>
        <div class="setbuild-controls">
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
            type="submit"
            class="btn primary setbuild-build"
            disabled={build.loading}
            aria-busy={build.loading}
          >
            {build.loading ? (
              <span class="spin" aria-hidden="true" />
            ) : (
              <Icon name="play" size={12} />
            )}{" "}
            {buildLabel}
          </button>
        </div>
      </form>
      <SetBuilderMethod />
      {build.stale && (
        <div class="setbuild-stale" role="status">
          <b>Proposal settings changed.</b> The chain below still shows the
          previous build. Update it before using or copying the result.
        </div>
      )}
      {build.error && (
        <div class="arch-fix" role="alert">
          Build failed: {build.error}
        </div>
      )}
      {build.loading && build.startedAt !== null && (
        <SetBuildLoading startedAt={build.startedAt} />
      )}
      {build.data && (
        <>
          <SetBuilderResult data={build.data} />
          {!build.data.complete &&
            build.data.pool > 0 &&
            !isShelfOffline(build.data, build.data) && (
              <div class="setbuild-shortfall" role="alert">
                <Icon name="warn" size={16} />
                <span>
                  <b>Partial draft — not a complete set.</b> FullTags found
                  {build.data.actualMinutes} of the requested{" "}
                  {build.data.minutes}
                  minutes, leaving {build.data.shortfallMinutes} minutes short.
                  Review the exclusions or choose a shorter target before
                  export.
                </span>
              </div>
            )}
          <FreshnessLine
            freshness={build.data.freshness}
            pool={build.data.pool}
          />
          {steps.length > 0 && (
            <div class="setbuild-actions" aria-label="Set draft actions">
              <button
                type="button"
                class="btn ghostbtn"
                aria-label="Save draft as a local JSON file"
                disabled={build.stale}
                onClick={() => saveDraft(build.data!)}
              >
                <Icon name="download" size={13} /> Save JSON draft
              </button>
              {build.stale || exportHref === null ? (
                <span class="btn ghostbtn" aria-disabled="true">
                  <Icon name="download" size={13} /> Export .m3u8 for Rekordbox
                </span>
              ) : (
                <a
                  class="btn ghostbtn"
                  href={exportHref}
                  download
                  title="Download a UTF-8 M3U8 playlist; this does not open or change Rekordbox"
                >
                  <Icon name="download" size={13} /> Export .m3u8 for Rekordbox
                </a>
              )}
              <span class="setbuild-actions-note">
                Import the .m3u8 through Rekordbox File → Import → Playlist.
                Save JSON keeps the full technical evidence. Neither action
                opens or changes the Rekordbox database.
              </span>
            </div>
          )}
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
          {steps.length >= 2 && (
            <SetArcChart steps={steps} preset={preset} keyGlide={keyGlide} />
          )}
          <ReproLine
            data={build.data}
            searchChoice={searchChoice}
            poolLimit={poolLimit}
            openerId={opener?.video_id ?? null}
          />
          {build.data.excluded_total > 0 && (
            <ExcludedBreakdown data={build.data} />
          )}
        </>
      )}
    </Card>
  );
}
