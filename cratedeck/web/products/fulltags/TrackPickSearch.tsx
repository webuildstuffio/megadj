// TrackPickSearch.tsx — the shared "search + pick ONE track" picker used
// by both panels on the Similar tab (sounds-like query track and set-builder
// opener): two hand-rolled variants had already drifted once. Split out of
// SimilarTab.tsx (file-length guard + no circular import: SetBuildPanel
// imports the picker, SimilarTab imports SetBuildPanel).
import type { ArchiveSearchHit } from "../../../shared/types";
import { Card, KVRows, KVKey, KVVal, SearchBar } from "../../ui/data";
import { TrackTitle } from "../shared";

/** The wire row a track-pick search deals in: the search endpoint returns
 *  ArchiveTrack-shaped rows; the caller keeps (video_id, title, artist). */
export interface TrackPick {
  video_id: string;
  title: string | null;
  artist?: string | null;
}

type HitsStatus = "ok" | "loading" | "error";

/** Search + pick ONE track — the shared picker under both panels (the
 *  sounds-like query track and the set-builder opener both need it; two
 *  hand-rolled variants had already drifted once). Debounces nothing —
 *  hits stream live from ≥2 chars; picking clears the query. */
export function TrackPickSearch(props: {
  query: string;
  onQuery: (v: string) => void;
  hits: ArchiveSearchHit[] | null;
  hitsStatus: HitsStatus;
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

export type { HitsStatus };
