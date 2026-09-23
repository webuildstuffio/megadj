// MegasetCohorts.tsx — the megaset product's Cohorts tab (#295 full
// integration): one panel that plans the whole warmup→peak session PER
// genre family through the shared cohort engine (same /api/archive/
// megaset-cohorts route the CLI and MCP quote). Propose-only: nothing
// writes; the DJ reviews, then imports per-set via the Build tab.
import { Card } from "../../ui/data";
import { Icon } from "../../ui/icons";
import { SectionHead } from "../shared";
import {
  cohortsExportHref,
  type CohortArmWire,
  type CohortsPlanner,
} from "./cohorts-view";

function armSummary(arm: CohortArmWire): string {
  const flag = arm.complete ? "" : ` · short ${arm.shortfallMinutes}m`;
  return `${arm.actualMinutes}m · ${arm.steps} tracks${flag}`;
}

function ArmCard(props: { arm: CohortArmWire }) {
  const { arm } = props;
  return (
    <div class={`megaset-cohort-arm${arm.complete ? "" : " short"}`}>
      <strong>{arm.preset}</strong>
      <span>{armSummary(arm)}</span>
      <small>
        pool {arm.pool.toLocaleString()}
        {arm.avgTransition !== null
          ? ` · blend ${arm.avgTransition.toFixed(3)}${
              arm.minTransition !== null
                ? ` (worst ${arm.minTransition.toFixed(3)})`
                : ""
            }`
          : ""}
        {arm.sameArtistPairs > 0
          ? ` · ${arm.sameArtistPairs} same-artist pair${
              arm.sameArtistPairs === 1 ? "" : "s"
            }`
          : ""}
      </small>
    </div>
  );
}

export function MegasetCohorts(props: { planner: CohortsPlanner }) {
  const { planner } = props;
  const { state } = planner;
  return (
    <Card class="megaset cohorts">
      <SectionHead icon="grid" title="Plan the session, one cohort at a time" />
      <p class="megaset-lead">
        Builds a warmup + peak pair per genre family in one pass — the full
        night's arc per crowd. Same engine, census, and honesty rules as the
        Build tab; nothing writes.
      </p>
      <div class="megaset-cohort-controls">
        <label>
          minutes per arm
          <input
            type="number"
            min={10}
            max={240}
            value={planner.minutesInput}
            onInput={(e) =>
              planner.setMinutesInput((e.target as HTMLInputElement).value)
            }
          />
        </label>
        <label>
          families (comma-separated, blank = the default four)
          <input
            type="text"
            placeholder="edm, house, techno, tech house"
            value={planner.familiesInput}
            onInput={(e) =>
              planner.setFamiliesInput((e.target as HTMLInputElement).value)
            }
          />
        </label>
        <button
          class="primary"
          disabled={state.loading}
          onClick={() => planner.request()}
        >
          {state.loading ? "Planning cohorts…" : "Plan cohorts"}
        </button>
      </div>
      {state.error !== null && (
        <p class="megaset-error" role="alert">
          {state.error}
        </p>
      )}
      {state.data !== null && (
        <div class="megaset-cohort-plan">
          {state.data.cohorts.map((row) => (
            <div class="megaset-cohort-row" key={row.family}>
              <h3>{row.family}</h3>
              <ArmCard arm={row.warmup} />
              <ArmCard arm={row.peak} />
            </div>
          ))}
          <p class="megaset-cohort-verdict">
            {state.data.all_complete
              ? `All ${state.data.cohorts.length} cohort(s) complete — ${(state.data.elapsed_ms / 1000).toFixed(1)}s.`
              : `At least one arm fell short of the budget — same answer the CLI exits 1 with. (${(state.data.elapsed_ms / 1000).toFixed(1)}s)`}
          </p>
          {/* rev-52: the whole session exports as ONE m3u8 (per-family
              sections, SHORT arms labeled) — same honesty as the plan */}
          <a
            class="btn ghostbtn"
            href={cohortsExportHref(state.data, planner.familiesInput)}
            download
            title="Download the whole session as one UTF-8 M3U8 playlist; this does not open or change Rekordbox"
          >
            <Icon name="download" size={13} /> Export session .m3u8 for
            Rekordbox
          </a>
          <details class="megaset-cohort-scope">
            <summary>what's outside every cohort</summary>
            <p>{state.data.outside_scope.blank_genre_note}</p>
          </details>
        </div>
      )}
    </Card>
  );
}
