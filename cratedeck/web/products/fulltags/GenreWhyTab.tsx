// GenreWhyTab.tsx — the FullTags "Genre Why" canvas (#215): one track's
// #173 vote-ladder breakdown. Every rung's claim (genre + weight +
// elected flag + provenance), re-elected through the write path's exact
// seam so the displayed winner is the genre the row carries — "why
// Techno?" answered from the row, not from code.
import { useState } from "preact/hooks";
import type { ArchiveGenreWhy, ArchiveSearchHit } from "../../../shared/types";
import { api } from "../../ui/toast";
import { FetchedGate, useFetched } from "../../ui/useFetched";
import { KVRows, KVRow, KVKey, KVVal, Card, ListHead } from "../../ui/data";
import { SectionHead, TrackTitle } from "../shared";
import { TrackPickSearch, type TrackPick } from "./TrackPickSearch";

/** The read seam: same route as deckctl/MCP (surface-parity hub). */
const genreWhyUrl = (id: string) =>
  `/api/archive/genre-why?id=${encodeURIComponent(id)}`;

export function GenreWhyTab() {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<TrackPick | null>(null);
  const why = useFetched<ArchiveGenreWhy | null>(
    () =>
      picked
        ? api<ArchiveGenreWhy>(genreWhyUrl(picked.video_id))
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
      <SectionHead
        icon="info"
        title="Genre why — the vote ladder's breakdown"
      />
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
      {picked &&
        (why.status !== "ok" ? (
          <FetchedGate page={why} loading="replaying the vote election…" />
        ) : why.data ? (
          <Card>
            <ListHead
              icon="info"
              title={`Genre breakdown — ${picked.title ?? picked.video_id}`}
              n={why.data.votes.length}
              hint="Each source rung votes its claim with a fixed weight; the highest total elects. ★ = on the winning side."
              lines={why.data.votes.map(
                (v) =>
                  `${v.elected ? "★" : " "} ${v.rung}  w=${v.weight.toFixed(2)}  ${v.genre}`,
              )}
            />
            {why.data.voted ? (
              <KVRows>
                {why.data.votes.map((v) => (
                  <KVRow key={`${v.rung}:${v.genre}`}>
                    <KVKey>
                      <span class={v.elected ? "arch-pill ok" : "arch-pill"}>
                        {v.elected ? "★ " : ""}
                        {v.rung}
                      </span>{" "}
                      {v.genre}
                      {v.detail ? <small>{` — ${v.detail}`}</small> : null}
                    </KVKey>
                    <KVVal>
                      <span class="arch-pill ok">w={v.weight.toFixed(2)}</span>
                    </KVVal>
                  </KVRow>
                ))}
                <KVRow>
                  <KVKey>
                    <TrackTitle
                      title={`Elected: ${why.data.elected ?? "—"}`}
                      videoId={why.data.video_id}
                      artist={null}
                    />
                  </KVKey>
                  <KVVal>
                    <span class="arch-pill ok">
                      w={(why.data.elected_weight ?? 0).toFixed(2)}
                    </span>
                  </KVVal>
                </KVRow>
                <KVRow>
                  <KVKey>Stored genre (matches replay)</KVKey>
                  <KVVal>
                    <span
                      class={
                        why.data.matches_db ? "arch-pill ok" : "arch-pill warn"
                      }
                    >
                      {why.data.db_genre ?? "null"}
                    </span>
                  </KVVal>
                </KVRow>
              </KVRows>
            ) : (
              <div class="note-card">
                Never voted — run <code>megadj fetch --genres</code> to put it
                on the ladder. The stored label (if any) predates the vote write
                path.
              </div>
            )}
          </Card>
        ) : null)}
    </div>
  );
}
