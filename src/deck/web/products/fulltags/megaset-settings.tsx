import type { ComponentChildren } from "preact";
import {
  MEGASET_MINUTES_MAX,
  MEGASET_MINUTES_MIN,
  MEGASET_PRESET_DEFS,
  MEGASET_GENRE_FAMILIES,
} from "../../../shared/types";
import { Icon } from "../../ui/icons";
import {
  AdvancedDrawer,
  PresetOption,
  SequencerRow,
  StepTitle,
} from "./MegasetForm";
import type { MegasetBuilder } from "./megaset-builder";

const SET_DURATION_PRESETS = [30, 60, 90, 120] as const;

function PresetSettings(props: { model: MegasetBuilder }) {
  const { model } = props;
  return (
    <fieldset class="megaset-preset" disabled={model.build.loading}>
      <StepTitle
        n={1}
        title="Energy journey"
        hint="how the room should feel from first track to last"
      />
      <div
        class="megaset-preset-grid"
        role="radiogroup"
        aria-labelledby="megaset-preset-label"
      >
        {MEGASET_PRESET_DEFS.map((preset, index) => (
          <PresetOption
            key={preset.id}
            preset={preset}
            selected={model.preset.id === preset.id}
            disabled={model.build.loading}
            index={index}
            onSelect={(next) => {
              if (next.id === model.preset.id) return;
              model.choosePreset(next);
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}

function DurationSettings(props: { model: MegasetBuilder }) {
  const { model } = props;
  return (
    <fieldset class="megaset-length" disabled={model.build.loading}>
      <StepTitle n={2} title="MegaSet length" />
      <div class="megaset-duration">
        <div
          class="megaset-duration-presets"
          role="group"
          aria-label="Common set lengths"
        >
          {SET_DURATION_PRESETS.map((duration) => (
            <button
              key={duration}
              type="button"
              class={`megaset-duration-option${model.minutes === duration ? " on" : ""}`}
              aria-pressed={model.minutes === duration}
              onClick={() => model.setMinutesInput(String(duration))}
            >
              {duration} min
            </button>
          ))}
        </div>
        <label
          class="megaset-minutes"
          title="Enter a custom target between the supported limits"
        >
          <span>
            Custom
            <small>
              {MEGASET_MINUTES_MIN}–{MEGASET_MINUTES_MAX} minutes
            </small>
          </span>
          <input
            type="number"
            min={MEGASET_MINUTES_MIN}
            max={MEGASET_MINUTES_MAX}
            value={model.minutesInput}
            aria-label={`Custom set length in minutes (${MEGASET_MINUTES_MIN}–${MEGASET_MINUTES_MAX})`}
            onInput={(event) =>
              model.setMinutesInput((event.target as HTMLInputElement).value)
            }
            onBlur={model.commitMinutes}
          />
        </label>
      </div>
    </fieldset>
  );
}

function GenreSettings(props: { model: MegasetBuilder }) {
  const { model } = props;
  const filtered = model.build.data?.genre_filtered ?? 0;
  const suggestion = model.build.data?.genre_suggestion;
  // #285: options derive from the PRODUCER table (MEGASET_GENRE_FAMILIES
  // keys, re-exported through the shared leaf) — never a hand-copied twin.
  // Free-form input still works: a datalist suggests, it does not constrain.
  const familyKeys = Object.keys(MEGASET_GENRE_FAMILIES);
  return (
    <fieldset class="megaset-length" disabled={model.build.loading}>
      <StepTitle
        n={3}
        title="Genre"
        hint="narrow the pool to a genre family — blank means everything"
      />
      <input
        type="search"
        class="megaset-genre-input"
        placeholder="e.g. tropical house, house, techno, dnb…"
        aria-label="Genre filter (substring match, blank = whole library)"
        list="megaset-genre-families"
        value={model.genreInput}
        onInput={(event) =>
          model.setGenreInput((event.target as HTMLInputElement).value)
        }
      />
      <datalist id="megaset-genre-families">
        {familyKeys.map((family) => (
          <option key={family} value={family} />
        ))}
      </datalist>
      {suggestion !== undefined && suggestion !== "" && (
        <p class="megaset-genre-count" role="status">
          no tracks matched “{model.genreInput.trim()}” — did you mean{" "}
          <strong>{suggestion}</strong>?
        </p>
      )}
      {filtered > 0 && (
        <p class="megaset-genre-count" role="status">
          pool narrowed to <strong>{filtered}</strong>{" "}
          {filtered === 1 ? "track" : "tracks"} matching “
          {model.genreInput.trim()}”
        </p>
      )}
    </fieldset>
  );
}

function SequencerSettings(props: { model: MegasetBuilder }) {
  const { model } = props;
  const missing = model.build.data?.landmarks_missing ?? [];
  return (
    <fieldset class="megaset-length" disabled={model.build.loading}>
      <StepTitle n={4} title="Sequencer" />
      <SequencerRow
        searchChoice={model.searchChoice}
        onChoice={model.chooseSearch}
        disabled={model.build.loading}
      />
      <label
        class="megaset-genre"
        title="Must-play track ids, comma- or space-separated — each is slotted into the chain at an arc-legal position"
      >
        <span>
          Must-play tracks
          <small>track ids — pinned into the chain (#107 landmarks)</small>
        </span>
        <input
          type="text"
          class="megaset-genre-input"
          placeholder="e.g. dQw4w9WgXcQ, aBcD1234…"
          aria-label="Landmark must-play track ids (comma or space separated)"
          value={model.landmarksInput}
          onInput={(event) =>
            model.setLandmarksInput((event.target as HTMLInputElement).value)
          }
        />
      </label>
      {missing.length > 0 && (
        <p class="megaset-genre-count" role="alert">
          {missing.length === 1 ? "pin" : "pins"} not placed:{" "}
          <strong>{missing.join(", ")}</strong> — no arc-legal position in this
          set
        </p>
      )}
      <AdvancedDrawer
        poolLimitInput={model.poolLimitInput}
        onPoolLimitInput={model.setPoolLimitInput}
        onPoolLimitBlur={model.commitPoolLimit}
        disabled={model.build.loading}
        lastPool={model.build.data ? model.build.data.pool : null}
        searchChoice={model.searchChoice}
      />
    </fieldset>
  );
}

function BuildControls(props: {
  model: MegasetBuilder;
  openerPicker: ComponentChildren;
}) {
  const { model, openerPicker } = props;
  return (
    <div class="megaset-controls">
      {openerPicker}
      <button
        type="submit"
        class="btn primary megaset-build"
        disabled={model.build.loading}
        aria-busy={model.build.loading}
      >
        {model.build.loading ? (
          <span class="spin" aria-hidden="true" />
        ) : (
          <Icon name="play" size={12} />
        )}{" "}
        {model.buildLabel}
      </button>
    </div>
  );
}

export function MegasetSettings(props: {
  model: MegasetBuilder;
  openerPicker: ComponentChildren;
}) {
  return (
    <form
      class="megaset-form"
      aria-label="MegaSet builder settings"
      onSubmit={(event) => {
        event.preventDefault();
        if (!props.model.build.loading) void props.model.run();
      }}
    >
      <PresetSettings model={props.model} />
      <DurationSettings model={props.model} />
      <GenreSettings model={props.model} />
      <SequencerSettings model={props.model} />
      <BuildControls model={props.model} openerPicker={props.openerPicker} />
    </form>
  );
}
