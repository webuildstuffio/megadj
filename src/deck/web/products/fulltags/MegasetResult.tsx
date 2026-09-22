import {
  MEGASET_PRESET_DEFS,
  isShelfOffline,
  type MegasetPayload,
} from "../../../shared/types";

/** Derived banner verdict — computed ONCE so the JSX stays declarative.
 *  B1 (#104) added a mirror-built dimension on top of the complete /
 *  shelf-offline pair, and the inline nested ternaries hit CCN 33; the
 *  verdict now comes from four small classifiers instead. Pure over the
 *  payload. */
interface ResultVerdict {
  empty: boolean;
  shelfOffline: boolean;
  mirrorBuilt: boolean;
  tone: "ok" | "warn" | "stale";
  kicker: string;
  title: string;
  body: string;
  journeyLabel: string;
}

function resultTone(
  complete: boolean,
  shelfOffline: boolean,
  mirrorBuilt: boolean,
): ResultVerdict["tone"] {
  if (!complete) return shelfOffline ? "stale" : "warn";
  return mirrorBuilt ? "warn" : "ok";
}

function resultKicker(
  empty: boolean,
  complete: boolean,
  shelfOffline: boolean,
  mirrorBuilt: boolean,
): string {
  if (empty) return "Library needs attention";
  if (mirrorBuilt) return "Mirror-metadata draft — shelf offline";
  if (complete) return "Ready to review";
  if (shelfOffline) return "Shelf not mounted";
  return "More compatible tracks needed";
}

function resultTitle(
  data: MegasetPayload,
  empty: boolean,
  shelfOffline: boolean,
  mirrorBuilt: boolean,
  journeyLabel: string,
): string {
  if (empty) return "No playable set could be built";
  if (shelfOffline && !mirrorBuilt)
    return "Connect the shelf volume, then build again";
  return `${data.actualMinutes}-minute ${journeyLabel} ${data.complete ? "set draft" : "partial draft"}`;
}

function resultBody(
  data: MegasetPayload,
  shelfOffline: boolean,
  mirrorBuilt: boolean,
): string {
  if (data.pool === 0) {
    if (data.source_total > 0 && data.missing_files === data.source_total)
      return `All ${data.source_total.toLocaleString()} downloaded database paths are missing. Repair the archive paths, then build again.`;
    return "Run FullTags beats and mood analysis so the builder has enough tempo and energy data.";
  }
  if (shelfOffline && !mirrorBuilt)
    return `Every one of the ${data.missing_files.toLocaleString()} archive paths is unreadable — the shelf drive is offline. Mount it (Finder or megadj), confirm the files are back, then build again. Nothing is lost; the library ledger is intact.`;
  if (mirrorBuilt)
    return `${data.metadata_only.toLocaleString()} of ${data.pool.toLocaleString()} proposal tracks have no mounted file — they are scored from measured Rekordbox/FullTags tempo, so this chain is a PLAN, not a playable playlist until the shelf is mounted.`;
  if (data.complete)
    return `FullTags reached the ${data.minutes}-minute target with ${data.steps.length} unique tracks.`;
  return `FullTags found ${data.actualMinutes} of ${data.minutes} minutes — ${data.shortfallMinutes} minutes short.`;
}

function deriveVerdict(data: MegasetPayload): ResultVerdict {
  // The all-missing signature = the shelf volume is offline (every DB
  // path points under /Volumes/<shelf>/ and none can exist). This is an
  // environment state, not a library verdict — the old "more compatible
  // tracks needed" framing sent the user hunting for tracks that are
  // merely on a sleeping drive. B1 (#104): with metadata-only rows
  // admitted, an offline shelf usually still BUILDS a chain from mirror
  // tempo — the pool is then mirror-metadata, not mounted audio.
  const empty = data.pool === 0;
  const shelfOffline = !data.complete && isShelfOffline(data, data);
  const mirrorBuilt = data.metadata_only > 0;
  const journey = MEGASET_PRESET_DEFS.find(
    (preset) => preset.id === data.preset,
  );
  const journeyLabel = journey?.label ?? data.preset;
  return {
    empty,
    shelfOffline,
    mirrorBuilt,
    journeyLabel,
    tone: resultTone(data.complete, shelfOffline, mirrorBuilt),
    kicker: resultKicker(empty, data.complete, shelfOffline, mirrorBuilt),
    title: resultTitle(data, empty, shelfOffline, mirrorBuilt, journeyLabel),
    body: resultBody(data, shelfOffline, mirrorBuilt),
  };
}

/** Cleanup notes under the source grid — only the nonzero facts. */
function libraryNotesOf(data: MegasetPayload, shelfOffline: boolean): string[] {
  return [
    data.missing_files > 0 && !shelfOffline
      ? `${data.missing_files} missing skipped`
      : null,
    data.duplicate_files > 0
      ? `${data.duplicate_files} DB aliases collapsed`
      : null,
    data.relocated_files > 0
      ? `${data.relocated_files} found on the mounted shelf`
      : null,
  ].filter((note): note is string => note !== null);
}

/** One "what FullTags checked" cell. */
function SourceCell(props: { span: string; strong: string; small: string }) {
  return (
    <div>
      <span>{props.span}</span>
      <strong>{props.strong}</strong>
      <small>{props.small}</small>
    </div>
  );
}

function SourceGrid(props: { data: MegasetPayload; shelfOffline: boolean }) {
  const { data, shelfOffline } = props;
  // pool-size honesty (E7): say WHICH search ran, and why on small pools —
  // the deep search is a visible behavior, never a silent algorithm switch
  const beam = data.search === "beam";
  return (
    <div class="megaset-source-grid">
      <SourceCell
        span="Archive database"
        strong={`${data.source_total.toLocaleString()} rows`}
        small={
          shelfOffline
            ? "shelf offline — no mounted files considered"
            : `${data.pool.toLocaleString()} pool tracks considered`
        }
      />
      <SourceCell
        span="Metadata-only tracks"
        strong={data.metadata_only.toLocaleString()}
        small={
          data.metadata_only > 0
            ? "no mounted file — scored from measured tempo"
            : "every pool track is a mounted file"
        }
      />
      <SourceCell
        span="Sequencer"
        strong={beam ? "deep beam search" : "standard greedy search"}
        small={
          beam
            ? "explores past dead-ends on sparse pools"
            : "greedy chain — plenty of alternatives at this size"
        }
      />
      <SourceCell
        span="FullTags analysis"
        strong="Beats + mood first"
        small="fresh analysis ledgers take priority"
      />
      <SourceCell
        span="Rekordbox fallback"
        strong={`${data.rekordbox_bpm_hits.toLocaleString()} BPM · ${data.rekordbox_key_hits.toLocaleString()} keys`}
        small="used only where FullTags had gaps"
      />
      <SourceCell
        span="Live file fallback"
        strong={`${data.key_reads.toLocaleString()} key reads`}
        small={
          data.key_read_failures === 0
            ? "all reads succeeded"
            : `${data.key_read_failures} failed; scored without key`
        }
      />
    </div>
  );
}

export function MegasetResult(props: { data: MegasetPayload }) {
  const { data } = props;
  const v = deriveVerdict(data);
  const libraryNotes = libraryNotesOf(data, v.shelfOffline);
  return (
    <section
      class={`megaset-result ${v.tone}`}
      aria-labelledby="megaset-result-title"
      aria-live="polite"
    >
      <div class="megaset-result-head">
        <span class="megaset-result-kicker">{v.kicker}</span>
        <h4 id="megaset-result-title">{v.title}</h4>
        <p>{v.body}</p>
      </div>

      <dl class="megaset-result-metrics" aria-label="MegaSet draft summary">
        <div>
          <dt>Duration</dt>
          <dd>
            <strong>{data.actualMinutes} min</strong>
            <small>{data.minutes} min target</small>
          </dd>
        </div>
        <div>
          <dt>Tracks</dt>
          <dd>
            <strong>{data.steps.length}</strong>
            <small>unique and ordered</small>
          </dd>
        </div>
        <div>
          <dt>Mounted pool</dt>
          <dd>
            <strong>{(data.pool - data.metadata_only).toLocaleString()}</strong>
            <small>mounted files in the pool</small>
          </dd>
        </div>
        {data.avg_transition !== null && (
          <div>
            <dt>Avg blend</dt>
            <dd>
              <strong>{data.avg_transition.toFixed(3)}</strong>
              <small>
                worst {data.min_transition?.toFixed(3)} · higher is smoother
              </small>
            </dd>
          </div>
        )}
      </dl>

      <div class="megaset-source-summary">
        <div class="megaset-source-head">
          <strong>What FullTags checked</strong>
          <span>read-only · nothing written</span>
        </div>
        <SourceGrid data={data} shelfOffline={v.shelfOffline} />
        {libraryNotes.length > 0 && (
          <p class="megaset-library-notes">
            Library cleanup: {libraryNotes.join(" · ")}.
          </p>
        )}
        {v.shelfOffline && (
          <p class="megaset-library-notes">
            Shelf check: {data.missing_files.toLocaleString()} of{" "}
            {data.source_total.toLocaleString()} downloaded paths were
            unreadable during this build.
          </p>
        )}
      </div>
    </section>
  );
}
