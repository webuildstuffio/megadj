// MegasetOpenerPicker.tsx — the set-builder opener picker (#209 split from
// MegasetPanel.tsx): the first track, either auto-picked by the arc or
// forced (the `opener` param every other surface takes).
import type { ArchiveSearchHit } from "../../../shared/types";
import { Icon } from "../../ui/icons";
import { TrackPickSearch, type TrackPick } from "./TrackPickSearch";

export function MegasetOpenerPicker(props: {
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
        class="megaset-opener"
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
      <span class="megaset-opener-disabled" aria-disabled="true">
        Opening track <span>Auto-picked for this build</span>
      </span>
    );
  return (
    <details class="megaset-opener-pick">
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
