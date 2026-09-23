// GenreWhyTab.tsx — the FullTags "Genre Why" canvas (#215): one track's
// #173 vote-ladder breakdown. The FULL ladder renders — all 8 rungs in
// weight order from the shared defs table (src/deck/shared/
// genre-vote-rungs.ts, never a local twin), speaking rungs bold with
// weight bars, abstained rungs dimmed with what they ARE. The election
// replays through the write path's exact seam so the displayed winner is
// the genre the row carries — "why Techno?" answered from the row, not
// from code.
import { useState } from "preact/hooks";
import {
  genreVoteRungsInOrder,
  type ArchiveGenreWhy,
} from "../../../shared/types";
import { api } from "../../ui/toast";
import { FetchedGate, useFetched } from "../../ui/useFetched";
import { KVRows, KVRow, KVKey, KVVal, Card, ListHead } from "../../ui/data";
import { SectionHead, TrackTitle } from "../shared";
import { PickedTrackSearch, type TrackPick } from "./TrackPickSearch";

/** The read seam: same route as deckctl/MCP (surface-parity hub). */
const genreWhyUrl = (id: string) =>
  `/api/archive/genre-why?id=${encodeURIComponent(id)}`;

/** Weight as a fraction of the displayed election — the bar width. The
 *  TOTAL of all votes is the honest denominator: a rung's bar is its
 *  share of the conversation, the ★ marks the winner. Pure — module
 *  level, captures nothing. */
const totalWeight = (votes: { weight: number }[]): number =>
  votes.reduce((sum, v) => sum + v.weight, 0);

export function GenreWhyTab() {
  const [picked, setPicked] = useState<TrackPick | null>(null);
  const why = useFetched<ArchiveGenreWhy | null>(
    () =>
      picked
        ? api<ArchiveGenreWhy>(genreWhyUrl(picked.video_id))
        : Promise.resolve(null),
    [picked],
  );

  return (
    <div>
      <SectionHead
        icon="info"
        title="Genre why — the vote ladder's breakdown"
      />
      <PickedTrackSearch picked={picked} onPick={setPicked} />
      {picked &&
        (why.status !== "ok" ? (
          <FetchedGate page={why} loading="replaying the vote election…" />
        ) : why.data === null || why.data.missing ? (
          // Unknown id (deep link / stale pick): a named empty state,
          // never a blank panel — the payload arrives ok-shaped with
          // missing:true, so FetchedGate cannot catch it.
          <div class="card">
            <div class="empty">
              No track {picked.video_id} in the archive — pick another or search
              above.
            </div>
          </div>
        ) : (
          <Card>
            <ListHead
              icon="info"
              title={`Genre breakdown — ${picked.title ?? picked.video_id}`}
              n={why.data.votes.length}
              hint="The full 8-rung ladder, strongest voice first. A rung with a claim votes its fixed weight (bar = share of all weight cast); ★ = the elected winner. Dimmed rungs found nothing — an honest abstain, never a guess."
              lines={why.data.votes.map(
                (v) =>
                  `${v.elected ? "★" : " "} ${v.rung}  w=${v.weight.toFixed(2)}  ${v.genre}`,
              )}
            />
            {why.data.voted ? (
              <KVRows>
                {(() => {
                  const byRung = new Map(
                    why.data.votes.map((v) => [v.rung, v]),
                  );
                  const total = totalWeight(why.data.votes) || 1;
                  return genreVoteRungsInOrder().map((rung) => {
                    const v = byRung.get(rung.id);
                    if (!v) {
                      // Abstained: dimmed, but still on the ladder — the
                      // descriptor teaches what the rung LOOKS for.
                      return (
                        <KVRow key={rung.id} class="votebar-abstain">
                          <KVKey>
                            <span class="arch-pill muted">{rung.name}</span>{" "}
                            <small>{rung.description}</small>
                          </KVKey>
                          <KVVal>
                            <span class="arch-pill muted">
                              {rung.docRef} · w={rung.weight.toFixed(2)} — no
                              claim
                            </span>
                          </KVVal>
                        </KVRow>
                      );
                    }
                    return (
                      <KVRow key={`${v.rung}:${v.genre}`}>
                        <KVKey>
                          <span
                            class={v.elected ? "arch-pill ok" : "arch-pill"}
                          >
                            {v.elected ? "★ " : ""}
                            {rung.name}
                          </span>{" "}
                          {v.genre}
                          {v.detail ? <small>{` — ${v.detail}`}</small> : null}
                        </KVKey>
                        <KVVal>
                          <span
                            class="votebar"
                            style={{
                              width: `${Math.max(4, (v.weight / total) * 100).toFixed(1)}%`,
                            }}
                          />
                          <span
                            class={
                              v.elected ? "arch-pill ok" : "arch-pill muted"
                            }
                          >
                            w={v.weight.toFixed(2)}
                          </span>
                        </KVVal>
                      </KVRow>
                    );
                  });
                })()}
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
            {why.data.voted && why.data.matches_db === false ? (
              // Drift is the ONE finding this tab exists to surface — a
              // callout, not a pill you might miss.
              <div class="note-card">
                ⚠ Drift: the replay elects <b>{why.data.elected ?? "—"}</b> but
                the row stores <b>{why.data.db_genre ?? "null"}</b> — the genre
                column was edited outside the vote path (hand UPDATE / older
                write). Re-run <code>megadj fetch --genres</code> to re-elect,
                or inspect with <code>megadj genre-why {picked.video_id}</code>.
              </div>
            ) : null}
          </Card>
        ))}
    </div>
  );
}
