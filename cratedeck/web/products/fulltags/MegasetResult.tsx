import {
  MEGASET_PRESET_DEFS,
  isShelfOffline,
  type MegasetPayload,
} from "../../../shared/types";

export function MegasetResult(props: { data: MegasetPayload }) {
  const { data } = props;
  const empty = data.pool === 0;
  // The all-missing signature = the shelf volume is offline (every DB
  // path points under /Volumes/<shelf>/ and none can exist). This is an
  // environment state, not a library verdict — the old "more compatible
  // tracks needed" framing sent the user hunting for tracks that are
  // merely on a sleeping drive.
  const shelfOffline = !data.complete && isShelfOffline(data, data);
  const tone = data.complete ? "ok" : shelfOffline ? "stale" : "warn";
  const journey = MEGASET_PRESET_DEFS.find(
    (preset) => preset.id === data.preset,
  );
  const journeyLabel = journey?.label ?? data.preset;
  const libraryNotes = [
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
  // pool-size honesty (E7): say WHICH search ran, and why on small pools —
  // the deep search is a visible behavior, never a silent algorithm switch
  const searchNote =
    data.search === "beam" ? "deep beam search" : "standard greedy search";

  return (
    <section
      class={`megaset-result ${tone}`}
      aria-labelledby="megaset-result-title"
      aria-live="polite"
    >
      <div class="megaset-result-head">
        <span class="megaset-result-kicker">
          {empty
            ? "Library needs attention"
            : data.complete
              ? "Ready to review"
              : shelfOffline
                ? "Shelf not mounted"
                : "More compatible tracks needed"}
        </span>
        <h4 id="megaset-result-title">
          {empty
            ? "No playable set could be built"
            : shelfOffline
              ? "Connect the shelf volume, then build again"
              : `${data.actualMinutes}-minute ${journeyLabel} ${data.complete ? "set draft" : "partial draft"}`}
        </h4>
        <p>
          {empty
            ? data.source_total > 0 && data.missing_files === data.source_total
              ? `All ${data.source_total.toLocaleString()} downloaded database paths are missing. Repair the archive paths, then build again.`
              : "Run FullTags beats and mood analysis so the builder has enough tempo and energy data."
            : shelfOffline
              ? `Every one of the ${data.missing_files.toLocaleString()} archive paths is unreadable — the shelf drive is offline. Mount it (Finder or megadj), confirm the files are back, then build again. Nothing is lost; the library ledger is intact.`
              : data.complete
                ? `FullTags reached the ${data.minutes}-minute target with ${data.steps.length} unique tracks.`
                : `FullTags found ${data.actualMinutes} of ${data.minutes} minutes — ${data.shortfallMinutes} minutes short.`}
        </p>
      </div>

      <dl class="megaset-result-metrics" aria-label="Set draft summary">
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
            <strong>{data.pool.toLocaleString()}</strong>
            <small>actual mounted files</small>
          </dd>
        </div>
      </dl>

      <div class="megaset-source-summary">
        <div class="megaset-source-head">
          <strong>What FullTags checked</strong>
          <span>read-only · nothing written</span>
        </div>
        <div class="megaset-source-grid">
          <div>
            <span>Archive database</span>
            <strong>{data.source_total.toLocaleString()} rows</strong>
            <small>
              {shelfOffline
                ? "shelf offline — no mounted files considered"
                : `${data.pool.toLocaleString()} mounted files considered`}
            </small>
          </div>
          <div>
            <span>Sequencer</span>
            <strong>{searchNote}</strong>
            <small>
              {data.search === "beam"
                ? "explores past dead-ends on sparse pools"
                : "greedy chain — plenty of alternatives at this size"}
            </small>
          </div>
          <div>
            <span>FullTags analysis</span>
            <strong>Beats + mood first</strong>
            <small>fresh analysis ledgers take priority</small>
          </div>
          <div>
            <span>Rekordbox fallback</span>
            <strong>
              {data.rekordbox_bpm_hits.toLocaleString()} BPM ·{" "}
              {data.rekordbox_key_hits.toLocaleString()} keys
            </strong>
            <small>used only where FullTags had gaps</small>
          </div>
          <div>
            <span>Live file fallback</span>
            <strong>{data.key_reads.toLocaleString()} key reads</strong>
            <small>
              {data.key_read_failures === 0
                ? "all reads succeeded"
                : `${data.key_read_failures} failed; scored without key`}
            </small>
          </div>
        </div>
        {libraryNotes.length > 0 && (
          <p class="megaset-library-notes">
            Library cleanup: {libraryNotes.join(" · ")}.
          </p>
        )}
        {shelfOffline && (
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
