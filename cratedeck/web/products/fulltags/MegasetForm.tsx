// MegasetForm.tsx — the set builder's input widgets, split out of
// MegasetPanel.tsx (file-length guard): the preset cards, the length
// row, the sequencer row + advanced drawer (pool cap + scoring evidence).
//
// Every limit/number on screen is DERIVED from the shared registry
// (cratedeck/shared/megaset.ts) — the same table the CLI help, the MCP
// schema and the engine quote. Help text is written for a DJ who has
// never read the docs: what it does, when to touch it, what happens if
// they don't.
import {
  MEGASET_PRESET_DEFS,
  MEGASET_TRACK_MINUTES_MAX,
  MEGASET_TRACK_MINUTES_MIN,
  MEGASET_TEMPO_PERFECT,
  MEGASET_TEMPO_WINDOW,
  MEGASET_TRANSITION_WEIGHTS,
  MEGASET_POOL_MAX,
  MEGASET_BEAM_POOL_MAX,
  MEGASET_BEAM_WIDTH,
  type MegasetPresetDef,
} from "../../../shared/types";
import { Icon } from "../../ui/icons";

const energyBand = (value: number): string =>
  value < 3.5 ? "Low" : value < 6 ? "Medium" : value < 8 ? "High" : "Maximum";

const arcY = (value: number): number => 30 - ((value - 1) / 8) * 22;

/** Step number badge + title. Kept terse: the widgets under each step are
 *  self-describing (preset cards carry their own energy ranges and
 *  descriptions), so a per-step sub-line only repeated them. */
export function StepTitle(props: { n: number; title: string; hint?: string }) {
  return (
    <legend class="megaset-setup-title">
      <span>{props.n}</span>
      <span class="megaset-setup-text">
        {props.title}
        {props.hint && <small>{props.hint}</small>}
      </span>
    </legend>
  );
}

export function PresetOption(props: {
  preset: MegasetPresetDef;
  selected: boolean;
  disabled: boolean;
  index: number;
  onSelect: (preset: MegasetPresetDef) => void;
}) {
  const { preset, selected } = props;
  const descriptionId = `megaset-preset-${preset.id}-description`;
  const [start, end] = preset.arousal;
  const rising = end >= start;

  return (
    <button
      type="button"
      class={`megaset-preset-option${selected ? " on" : ""}`}
      role="radio"
      aria-checked={selected}
      aria-describedby={descriptionId}
      tabIndex={selected ? 0 : -1}
      disabled={props.disabled}
      onClick={() => props.onSelect(preset)}
      onKeyDown={(event) => {
        const last = MEGASET_PRESET_DEFS.length - 1;
        const nextIndex =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : event.key === "ArrowRight" || event.key === "ArrowDown"
                ? (props.index + 1) % MEGASET_PRESET_DEFS.length
                : event.key === "ArrowLeft" || event.key === "ArrowUp"
                  ? (props.index + last) % MEGASET_PRESET_DEFS.length
                  : null;
        if (nextIndex === null) return;
        event.preventDefault();
        const next = MEGASET_PRESET_DEFS[nextIndex];
        if (!next) return;
        props.onSelect(next);
        event.currentTarget.parentElement
          ?.querySelectorAll<HTMLElement>('[role="radio"]')
          .item(nextIndex)
          .focus();
      }}
    >
      <span class="megaset-preset-head">
        <strong>{preset.label}</strong>
        {selected && (
          <span class="megaset-preset-selected">
            <Icon name="check" size={11} /> Selected
          </span>
        )}
      </span>
      <svg
        class="megaset-preset-arc"
        viewBox="0 0 120 36"
        role="img"
        aria-label={`${preset.label} energy ${rising ? "rises" : "falls"} from ${energyBand(start)} to ${energyBand(end)}`}
      >
        <path class="megaset-preset-guide" d="M4 30 H116" />
        <path
          class="megaset-preset-line"
          d={`M4 ${arcY(start)} C42 ${arcY(start)}, 78 ${arcY(end)}, 116 ${arcY(end)}`}
        />
        <circle cx="4" cy={arcY(start)} r="2.5" />
        <circle cx="116" cy={arcY(end)} r="2.5" />
      </svg>
      <span class="megaset-preset-range" aria-hidden="true">
        <span>{energyBand(start)}</span>
        <span>{rising ? "rises to" : "drifts to"}</span>
        <span>{energyBand(end)}</span>
      </span>
      <span id={descriptionId} class="megaset-preset-description">
        {preset.description}
      </span>
    </button>
  );
}

export function SequencerRow(props: {
  searchChoice: "auto" | "greedy" | "beam";
  onChoice: (v: "auto" | "greedy" | "beam") => void;
  disabled: boolean;
}) {
  return (
    <div
      class="megaset-duration-presets"
      role="group"
      aria-label="Sequencer strategy"
    >
      {(
        [
          ["auto", "Auto", "Let the pool size decide — nothing to think about"],
          [
            "beam",
            "Deep",
            "Force the deep search: explores past dead-ends when few tracks are compatible",
          ],
          [
            "greedy",
            "Standard",
            "Force the fast chain — best when the whole library is in play",
          ],
        ] as const
      ).map(([value, label, why]) => (
        <button
          key={value}
          type="button"
          class={`megaset-duration-option${props.searchChoice === value ? " on" : ""}`}
          aria-pressed={props.searchChoice === value}
          title={why}
          disabled={props.disabled}
          onClick={() => props.onChoice(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function AdvancedDrawer(props: {
  poolLimitInput: string;
  onPoolLimitInput: (v: string) => void;
  onPoolLimitBlur: () => void;
  disabled: boolean;
  /** The pool the last build actually scanned (null before any build). */
  lastPool: number | null;
  searchChoice: "auto" | "greedy" | "beam";
}) {
  return (
    <details class="megaset-advanced">
      <summary>
        <span>Advanced</span>
        <small>
          pool cap · scoring weights · the same knobs the CLI and API take
        </small>
      </summary>
      <div class="megaset-advanced-grid">
        <label
          class="megaset-limit"
          title={`Cap the candidate pool to the newest N imports (1–${MEGASET_POOL_MAX}). Empty = the whole analyzed library.`}
        >
          <span>
            Pool cap
            <small>
              newest N of the library · 1–{MEGASET_POOL_MAX} · empty = all
            </small>
          </span>
          <input
            type="number"
            min={1}
            max={MEGASET_POOL_MAX}
            placeholder="all"
            value={props.poolLimitInput}
            aria-label={`Candidate pool cap, 1 to ${MEGASET_POOL_MAX}; empty uses the whole library`}
            disabled={props.disabled}
            onInput={(event) =>
              props.onPoolLimitInput((event.target as HTMLInputElement).value)
            }
            onBlur={props.onPoolLimitBlur}
          />
          {props.poolLimitInput.trim() !== "" && (
            <small class="megaset-limit-hint">
              builds from the {props.poolLimitInput.trim()} newest imports —
              clear it to use the whole library
            </small>
          )}
        </label>
        <dl class="megaset-weights" aria-label="Scoring rules and limits">
          <div>
            <dt>tempo rule</dt>
            <dd>
              within ±{Math.round(MEGASET_TEMPO_PERFECT * 100)}% scores full;
              beyond ±{Math.round(MEGASET_TEMPO_WINDOW * 100)}% a track is
              unmixable and never joins the chain
            </dd>
          </div>
          <div>
            <dt>transition score</dt>
            <dd>
              tempo {MEGASET_TRANSITION_WEIGHTS.tempo} · key{" "}
              {MEGASET_TRANSITION_WEIGHTS.key} · arc fit{" "}
              {MEGASET_TRANSITION_WEIGHTS.arcFit} — key clashes and tempo misses
              are hard gates, not soft penalties
            </dd>
          </div>
          <div>
            <dt>track limits</dt>
            <dd>
              {MEGASET_TRACK_MINUTES_MIN}–{MEGASET_TRACK_MINUTES_MAX} min per
              track — shorter are samples, longer are continuous mixes
            </dd>
          </div>
          <div>
            <dt>deep search</dt>
            <dd>
              joins automatically under {MEGASET_BEAM_POOL_MAX} tracks (width{" "}
              {MEGASET_BEAM_WIDTH}); big pools keep the fast chain — measured,
              no quality loss
            </dd>
          </div>
          <div>
            <dt>openers</dt>
            <dd>
              the auto-pick needs ≥15 tempo-neighbors so your first track never
              dead-ends the set
            </dd>
          </div>
          <div>
            <dt>determinism</dt>
            <dd>
              same settings → the same chain, every time (ties break by track
              id) — safe to rebuild and re-check
            </dd>
          </div>
        </dl>
        {props.lastPool !== null && (
          <p class="megaset-advanced-note">
            Last build scanned {props.lastPool.toLocaleString()} mounted tracks
            {props.lastPool < MEGASET_BEAM_POOL_MAX
              ? ` — that is why it ran the deep search`
              : ` — above the deep-search threshold, so the fast chain ran`}
            .
          </p>
        )}
      </div>
    </details>
  );
}
