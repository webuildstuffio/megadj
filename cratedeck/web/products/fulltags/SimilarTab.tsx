// SimilarTab.tsx — the FullTags "Similar" canvas (#/fulltags/similar),
// split out of FullTagsPage.tsx (file-length guard).
//
// The sounds-like view (I49): nearest tracks by effnet-embedding cosine
// similarity. The set builder is its own product now (SetBuildPanel under
// #/set) — it outgrew this canvas.
import { useState } from "preact/hooks";
import type { ArchiveSimilar, ArchiveSearchHit } from "../../../shared/types";
import { api } from "../../ui/toast";
import { Icon } from "../../ui/icons";
import { FetchedGate, useFetched } from "../../ui/useFetched";
import { ListHead, KVRows, KVRow, KVKey, KVVal, Card } from "../../ui/data";
import { SectionHead, TrackTitle } from "../shared";
import { TrackPickSearch, type TrackPick } from "./TrackPickSearch";

/** ONE line shape for a sounds-like hit — the copy block and any future
 *  consumer agree (mirrors `megadj similar`'s stdout rows). */
const similarHitLine = (h: {
  score: number;
  artist: string | null;
  title: string | null;
  video_id: string;
}): string =>
  `${h.score.toFixed(4)}  ${h.artist ?? "?"} — ${h.title ?? h.video_id}`;

export function SimilarTab() {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<TrackPick | null>(null);
  const hits = useFetched<ArchiveSimilar | null>(
    () =>
      picked
        ? api<ArchiveSimilar>(
            `/api/archive/similar?id=${encodeURIComponent(picked.video_id)}&k=10`,
          )
        : Promise.resolve(null),
    [picked],
  );
  // The search endpoint's wire shape is a BARE ARRAY (ArchiveTrack[]) —
  // derived from the producer in shared/types.ts, not re-declared here
  // (the round-4 lesson: a local duplicate drifted and crashed the render).
  const search = useFetched<ArchiveSearchHit[] | null>(
    () =>
      query.trim().length >= 2
        ? api<ArchiveSearchHit[]>(
            `/api/archive/search?q=${encodeURIComponent(query)}`,
          )
        : Promise.resolve(null),
    [query],
  );

  return (
    <div>
      <SectionHead icon="grid" title="Sounds like — nearest by embedding" />
      <TrackPickSearch
        query={query}
        onQuery={setQuery}
        hits={search.status === "ok" ? search.data : null}
        hitsStatus={search.status}
        placeholder="Pick a track — search by title or artist…"
        emptyNote={`no tracks match “${query.trim()}”`}
        onPick={(t) => {
          setPicked(t);
          setQuery("");
        }}
      />
      {picked && (
        <Card>
          <ListHead
            icon="compass"
            title={`Sounds like ${picked.title ?? picked.video_id}`}
            n={(hits.status === "ok" && hits.data?.hits.length) || 0}
            hint="Ranked by cosine similarity of the audio embeddings — 1.0 is identical, higher is more similar."
            lines={
              hits.status === "ok" && hits.data
                ? hits.data.hits.map(similarHitLine)
                : []
            }
          />
          {hits.status !== "ok" ? (
            <FetchedGate page={hits} loading="searching the embeddings…" />
          ) : hits.data && hits.data.corpus > 0 ? (
            <>
              <KVRows>
                {hits.data.hits.map((h) => (
                  <KVRow key={h.video_id}>
                    <KVKey>
                      <TrackTitle
                        title={h.title ?? h.video_id}
                        videoId={h.video_id}
                        artist={h.artist}
                      />
                    </KVKey>
                    <KVVal>
                      <span class="arch-pill ok">{h.score.toFixed(3)}</span>
                    </KVVal>
                  </KVRow>
                ))}
              </KVRows>
              <button
                type="button"
                class="btn sm ghostbtn"
                onClick={() => setPicked(null)}
              >
                pick a different track
              </button>
            </>
          ) : (
            <div class="note-card">
              <Icon name="bolt" size={20} />
              No embeddings yet — <code>megadj mood --embeddings</code> computes
              them (same pass as the mood heads, no extra model).
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
