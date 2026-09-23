import { useState } from "preact/hooks";
import {
  MEGASET_MINUTES_MAX,
  MEGASET_MINUTES_MIN,
  MEGASET_PRESET_DEFS,
  clampMegasetPool,
  type ArchiveSearchHit,
  type MegasetPayload,
  type MegasetPresetDef,
} from "../../../shared/types";
import { errMessage } from "../../../../shared/leaf/fmt";
import { api } from "../../ui/toast";
import { useFetched } from "../../ui/useFetched";
import type { TrackPick } from "./TrackPickSearch";
import { keyGlideOf } from "./MegasetStatus";
import type { MegasetDraftKnobs } from "./megaset-draft";

export type MegasetSearchChoice = "auto" | "greedy" | "beam";

export interface MegasetBuildState {
  data: MegasetPayload | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  startedAt: number | null;
}

type SetBuild = (
  next: MegasetBuildState | ((current: MegasetBuildState) => MegasetBuildState),
) => void;

const initialBuild: MegasetBuildState = {
  data: null,
  loading: false,
  error: null,
  stale: false,
  startedAt: null,
};

function defaultPreset(): MegasetPresetDef {
  return (
    MEGASET_PRESET_DEFS.find((preset) => preset.id === "peak") ??
    MEGASET_PRESET_DEFS[0]!
  );
}

/** #293: resolve a draft's preset ID to the shared registry def; an
 *  unknown id falls back to the default (same shape as defaultPreset). */
function presetFrom(id: string): MegasetPresetDef {
  return (
    MEGASET_PRESET_DEFS.find((preset) => preset.id === id) ?? defaultPreset()
  );
}

function clampMinutes(raw: number): number {
  return Number.isFinite(raw)
    ? Math.min(
        MEGASET_MINUTES_MAX,
        Math.max(MEGASET_MINUTES_MIN, Math.round(raw)),
      )
    : 60;
}

function minutesFrom(input: string): number {
  return input.trim() === "" ? 60 : clampMinutes(Number(input));
}

function poolLimitFrom(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return clampMegasetPool(parsed);
}

function staleBuild(current: MegasetBuildState): MegasetBuildState {
  return current.data && !current.loading && !current.stale
    ? { ...current, stale: true }
    : current;
}

function loadOpeners(query: string): Promise<ArchiveSearchHit[] | null> {
  return query.trim().length >= 2
    ? api<ArchiveSearchHit[]>(
        `/api/archive/search?q=${encodeURIComponent(query)}`,
      )
    : Promise.resolve(null);
}

function requestQuery(
  preset: MegasetPresetDef,
  minutes: number,
  searchChoice: MegasetSearchChoice,
  poolLimit: number | null,
  opener: TrackPick | null,
  genre: string,
  landmarkIds: readonly string[],
): URLSearchParams {
  const q = new URLSearchParams({
    preset: preset.id,
    minutes: String(minutes),
  });
  if (searchChoice !== "auto") q.set("search", searchChoice);
  if (poolLimit !== null) q.set("limit", String(poolLimit));
  if (opener) q.set("opener", opener.video_id);
  // #283 genre pool filter — a trimmed non-empty value narrows the pool
  if (genre.trim() !== "") q.set("genre", genre.trim());
  // S13 (#107): landmark pins ride as repeatable params (order preserved)
  for (const id of landmarkIds) q.append("landmark", id);
  return q;
}

async function requestMegaset(
  preset: MegasetPresetDef,
  minutes: number,
  searchChoice: MegasetSearchChoice,
  poolLimit: number | null,
  opener: TrackPick | null,
  genre: string,
  landmarkIds: readonly string[],
  setBuild: SetBuild,
): Promise<void> {
  setBuild({
    data: null,
    loading: true,
    error: null,
    stale: false,
    startedAt: Date.now(),
  });
  try {
    const query = requestQuery(
      preset,
      minutes,
      searchChoice,
      poolLimit,
      opener,
      genre,
      landmarkIds,
    );
    setBuild({
      data: await api<MegasetPayload>(`/api/archive/megaset?${query}`, {
        timeoutMs: 90_000,
      }),
      loading: false,
      error: null,
      stale: false,
      startedAt: null,
    });
  } catch (error) {
    setBuild({
      data: null,
      loading: false,
      error: errMessage(error),
      stale: false,
      startedAt: null,
    });
  }
}

function buildLabel(
  build: MegasetBuildState,
  minutes: number,
  preset: MegasetPresetDef,
): string {
  const verb = build.stale ? "Update" : "Build";
  return build.loading
    ? "Building your set…"
    : `${verb} ${minutes}-minute ${preset.label} set`;
}

function exportHref(
  build: MegasetBuildState,
  opener: TrackPick | null,
  searchChoice: MegasetSearchChoice,
  poolLimit: number | null,
  genre: string,
  landmarkIds: readonly string[],
): string | null {
  if (!build.data) return null;
  const q = new URLSearchParams({
    preset: build.data.preset,
    minutes: String(build.data.minutes),
  });
  q.set("format", "m3u8");
  if (opener) q.set("opener", opener.video_id);
  if (searchChoice !== "auto") q.set("search", searchChoice);
  if (poolLimit !== null) q.set("limit", String(poolLimit));
  if (genre.trim() !== "") q.set("genre", genre.trim());
  for (const id of landmarkIds) q.append("landmark", id);
  return `/api/archive/megaset?${q}`;
}

export function useMegasetBuilder() {
  const [preset, setPreset] = useState(defaultPreset);
  const [minutesInput, setMinutesInput] = useState("60");
  const [searchChoice, setSearchChoice] = useState<MegasetSearchChoice>("auto");
  const [poolLimitInput, setPoolLimitInput] = useState("");
  const [genreInput, setGenreInput] = useState("");
  const [landmarksInput, setLandmarksInput] = useState("");
  const [opener, setOpener] = useState<TrackPick | null>(null);
  const [openerQuery, setOpenerQuery] = useState("");
  const [build, setBuild] = useState<MegasetBuildState>(initialBuild);
  const minutes = minutesFrom(minutesInput);
  const poolLimit = poolLimitFrom(poolLimitInput);
  // S13 (#107): comma/space-separated landmark ids → clean unique list
  const landmarkIds = [
    ...new Set(
      landmarksInput
        .split(/[\s,]+/)
        .filter((id) => id.trim() !== "")
        .map((id) => id.trim()),
    ),
  ];
  const openerSearch = useFetched(
    () => loadOpeners(openerQuery),
    [openerQuery],
  );
  const steps = build.data?.steps ?? [];
  const invalidateProposal = () => setBuild(staleBuild);

  return {
    preset,
    minutesInput,
    minutes,
    searchChoice,
    poolLimitInput,
    poolLimit,
    genreInput,
    landmarksInput,
    landmarkIds,
    opener,
    openerQuery,
    openerSearch,
    build,
    steps,
    keyGlide: keyGlideOf(steps),
    buildLabel: buildLabel(build, minutes, preset),
    exportHref: exportHref(
      build,
      opener,
      searchChoice,
      poolLimit,
      genreInput,
      landmarkIds,
    ),
    choosePreset: (next: MegasetPresetDef) => {
      setPreset(next);
      invalidateProposal();
    },
    setMinutesInput: (next: string) => {
      setMinutesInput(next);
      invalidateProposal();
    },
    commitMinutes: () => setMinutesInput(String(minutes)),
    chooseSearch: (next: MegasetSearchChoice) => {
      setSearchChoice(next);
      invalidateProposal();
    },
    setPoolLimitInput: (next: string) => {
      setPoolLimitInput(next);
      invalidateProposal();
    },
    commitPoolLimit: () => setPoolLimitInput(String(poolLimit ?? "")),
    // #283 genre filter — live invalidate so the Build button re-scores
    setGenreInput: (next: string) => {
      setGenreInput(next);
      invalidateProposal();
    },
    // S13 (#107): landmark pins — live invalidate (the pins change the chain)
    setLandmarksInput: (next: string) => {
      setLandmarksInput(next);
      invalidateProposal();
    },
    setOpenerQuery,
    chooseOpener: (next: TrackPick | null) => {
      setOpener(next);
      invalidateProposal();
    },
    run: () =>
      requestMegaset(
        preset,
        minutes,
        searchChoice,
        poolLimit,
        opener,
        genreInput,
        landmarkIds,
        setBuild,
      ),
    // #293: hydrate the controls from a saved draft's parsed knobs, then
    // the user presses Build (the standard button) — no auto-request, the
    // restore is reviewable. Only the knobs the draft actually carries
    // change; unknown/older-draft fields keep their current values.
    loadDraft: (knobs: MegasetDraftKnobs) => {
      setPreset(presetFrom(knobs.preset));
      setMinutesInput(String(knobs.minutes));
      setSearchChoice(knobs.search);
      setPoolLimitInput(
        knobs.poolLimit === null ? "" : String(knobs.poolLimit),
      );
      setGenreInput(knobs.genre ?? "");
      setLandmarksInput(knobs.landmarkIds.join(", "));
      // the opener stays unresolved until the user re-picks it: the id
      // rides the repro/knobs, but a stale id cannot silently pin the build
      setOpener(null);
      invalidateProposal();
    },
  };
}

export type MegasetBuilder = ReturnType<typeof useMegasetBuilder>;
