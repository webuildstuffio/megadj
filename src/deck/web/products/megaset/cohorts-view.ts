// cohorts-view.ts — the megaset product's Cohorts tab state (#295 full
// integration): calls /api/archive/megaset-cohorts (the SAME plan engine
// as the CLI's `megadj megaset-cohorts` and the MCP `megaset_cohorts`
// tool — one source of truth), renders the per-family warmup/peak plan.
import { useState } from "preact/hooks";
import { errMessage } from "../../../../shared/leaf/fmt";
import { api } from "../../ui/toast";

/** One warmup-or-peak arm — mirrors deck/megaset/cohorts.ts CohortBuild. */
export interface CohortArmWire {
  preset: string;
  actualMinutes: number;
  requestedMinutes: number;
  complete: boolean;
  shortfallMinutes: number;
  steps: number;
  avgTransition: number | null;
  minTransition: number | null;
  sameArtistPairs: number;
  genreFiltered: number;
  pool: number;
}

export interface CohortRowWire {
  family: string;
  warmup: CohortArmWire;
  peak: CohortArmWire;
}

/** The /api/archive/megaset-cohorts payload (snake_case on the wire). */
export interface CohortPlanWire {
  command: "megaset-cohorts";
  minutes: number;
  families: string[];
  cohorts: CohortRowWire[];
  all_complete: boolean;
  outside_scope: { blank_genre_note: string };
  elapsed_ms: number;
}

/** The cohort-session M3U8 download URL — the SAME plan re-requested
 *  with ?format=m3u8 (rev-52: the route renders the whole session as one
 *  importable playlist; the JSON plan stays the review surface). */
export function cohortsExportHref(
  plan: CohortPlanWire,
  familiesInput: string,
): string {
  const q = new URLSearchParams({ minutes: String(plan.minutes) });
  const families = familiesInput
    .split(",")
    .map((f) => f.trim().toLowerCase())
    .filter((f) => f !== "");
  if (families.length > 0) q.set("families", families.join(","));
  q.set("format", "m3u8");
  return `/api/archive/megaset-cohorts?${q}`;
}

export interface CohortsState {
  data: CohortPlanWire | null;
  loading: boolean;
  error: string | null;
  /** Minutes the user asked for — echoed on the wire when it lands. */
  requestedMinutes: number;
}

const initialState: CohortsState = {
  data: null,
  loading: false,
  error: null,
  requestedMinutes: 60,
};

function clampMinutes(raw: number): number {
  return Number.isFinite(raw)
    ? Math.min(240, Math.max(10, Math.round(raw)))
    : 60;
}

function minutesFrom(input: string): number {
  return input.trim() === "" ? 60 : clampMinutes(Number(input));
}

export function useCohortsPlanner() {
  const [state, setState] = useState<CohortsState>(initialState);
  const [familiesInput, setFamiliesInput] = useState("");
  const [minutesInput, setMinutesInput] = useState("60");
  // same conversion shape as megaset-builder's minutesFrom: the raw form
  // value converts once and clampMinutes finite-checks the result
  const minutes = minutesFrom(minutesInput);

  const request = () => {
    setState({
      data: null,
      loading: true,
      error: null,
      requestedMinutes: minutes,
    });
    const q = new URLSearchParams({ minutes: String(minutes) });
    const families = familiesInput
      .split(",")
      .map((f) => f.trim().toLowerCase())
      .filter((f) => f !== "");
    if (families.length > 0) q.set("families", families.join(","));
    api<CohortPlanWire>(`/api/archive/megaset-cohorts?${q}`, {
      timeoutMs: 120_000,
    })
      .then((data) =>
        setState({
          data,
          loading: false,
          error: null,
          requestedMinutes: minutes,
        }),
      )
      .catch((error: unknown) =>
        setState({
          data: null,
          loading: false,
          error: errMessage(error),
          requestedMinutes: minutes,
        }),
      );
  };

  return {
    state,
    familiesInput,
    setFamiliesInput,
    minutesInput,
    setMinutesInput: (next: string) => setMinutesInput(next),
    minutes,
    request,
  };
}

export type CohortsPlanner = ReturnType<typeof useCohortsPlanner>;
