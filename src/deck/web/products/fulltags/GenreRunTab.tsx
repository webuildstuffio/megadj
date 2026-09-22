// GenreRunTab.tsx — the FullTags "Run" tab: the genre vote ladder RUNNING
// in the product (#215 visibility pass). Start a fetch (or attach to the
// live one), then watch it work: the phase rail, the progress bar, and
// the per-track ladder feed streaming in — every rung's vote, the election,
// the winner. The run IS a job (kind "fetch") on the shared JobEngine,
// exactly the Intake tab's engine: interlock, cancel, stall watchdog all
// apply unchanged.
//
// Feed contract: GET /api/fetch/feed?since=N drains the server's event
// ring (fetch_feed.ts); the poller keeps its cursor and gets only the
// tail. Rung names/weights come from the shared defs table
// (src/deck/shared/genre-vote-rungs.ts) — never a local twin.
import { useEffect, useRef, useState } from "preact/hooks";
import {
  genreVoteRungsInOrder,
  type FetchFeedWire,
  type Job,
} from "../../../shared/types";
import { api, apiPost, toast } from "../../ui/toast";
import { errMessage } from "../../../../shared/leaf/fmt";
import { Card, ListHead } from "../../ui/data";
import { SectionHead, Verdict } from "../shared";
import { Icon } from "../../ui/icons";

/** The rung display table, once — id → name, weight, description. */
const RUNGS = new Map(genreVoteRungsInOrder().map((r) => [r.id, r]));

interface FeedState {
  entries: FetchFeedWire["entries"];
  next: number;
}

interface FetchJobOptions {
  all?: boolean;
  only?: string;
  aiFallback?: boolean;
  dryRun?: boolean;
  jobs?: number;
}

const isRunning = (j: Job | null): boolean =>
  j !== null && (j.status === "running" || j.status === "queued");

export function GenreRunTab() {
  const [job, setJob] = useState<Job | null>(null);
  const [feed, setFeed] = useState<FeedState>({ entries: [], next: 0 });
  const [starting, setStarting] = useState(false);
  const [opts, setOpts] = useState<FetchJobOptions>({});
  const cursor = useRef(0);
  const feedBottom = useRef<HTMLDivElement | null>(null);

  // ---- job discovery: attach to the live fetch job if one exists ----
  const attach = (): void => {
    api<Job[]>("/api/jobs?active=1", { quiet: true })
      .then((rows) => {
        const mine = rows.find((r) => r.kind === "fetch") ?? null;
        setJob(mine);
        if (!mine) {
          cursor.current = 0;
          setFeed({ entries: [], next: 0 });
        }
      })
      .catch(() => {}); // quiet: the tab self-heals on the next poll
  };
  useEffect(() => {
    attach();
    const t = setInterval(attach, 5_000);
    return () => clearInterval(t);
  }, []);

  // ---- feed polling: 1s while a job is live, drain-since cursor ----
  useEffect(() => {
    if (!isRunning(job) && feed.entries.length === 0) return;
    let alive = true;
    const poll = (): void => {
      api<FeedState>(`/api/fetch/feed?since=${cursor.current}`, {
        quiet: true,
      })
        .then((s) => {
          if (!alive) return;
          cursor.current = s.next;
          if (s.entries.length > 0)
            setFeed((prev) => ({
              entries: [...prev.entries, ...s.entries].slice(-400),
              next: s.next,
            }));
        })
        .catch(() => {});
    };
    poll();
    const t = setInterval(poll, 1_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [job?.id, isRunning(job)]);

  // follow the feed
  useEffect(() => {
    feedBottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [feed.entries.length]);

  const start = (): void => {
    setStarting(true);
    apiPost<Job>("/api/fetch/start", opts, { quiet: true })
      .then((j) => {
        setJob(j);
        cursor.current = 0;
        setFeed({ entries: [], next: 0 });
      })
      .catch((e: unknown) => {
        // quiet + caller-owned surface: a refused start (interlock, busy)
        // must reach the DJ, not vanish into the poll loop.
        toast(`genre run refused: ${errMessage(e)}`, "err");
      })
      .finally(() => setStarting(false));
  };

  const cancel = (): void => {
    if (job) void apiPost(`/api/jobs/${job.id}/cancel`, {});
  };

  // ---- rung tally across the whole run so far ----
  const tally = new Map<string, { votes: number; elected: number }>();
  let tasksSeen = 0;
  let electedCount = 0;
  for (const e of feed.entries) {
    if (e.type !== "task") continue;
    tasksSeen++;
    if (e.task.elected) electedCount++;
    for (const v of e.task.votes) {
      const cur = tally.get(v.rung) ?? { votes: 0, elected: 0 };
      cur.votes++;
      tally.set(v.rung, cur);
    }
    if (e.task.elected)
      for (const r of e.task.elected.winnerRungs) {
        const cur = tally.get(r) ?? { votes: 0, elected: 0 };
        cur.elected++;
        tally.set(r, cur);
      }
  }
  const maxRungVotes = Math.max(1, ...[...tally.values()].map((t) => t.votes));

  return (
    <div>
      <SectionHead icon="pulse" title="Genre run — the vote ladder, live" />

      {/* ---- start controls (hidden while a run is live) ---- */}
      {!isRunning(job) ? (
        <Card>
          <ListHead
            icon="play"
            title="Run the enrichment pass"
            n={0}
            hint="Runs megadj fetch over the archive: every track's genre goes through the weighted vote ladder — SoundCloud, Beatport, Bandcamp, imprint and more vote; the strongest claim wins and is written to the file + ledger. Watch every vote land here, live."
          />
          <div class="intake-startrow">
            <label class="arch-pill muted">
              <input
                type="checkbox"
                checked={opts.dryRun === true}
                onChange={(e) =>
                  setOpts({ ...opts, dryRun: e.currentTarget.checked })
                }
              />{" "}
              dry run
            </label>
            <label class="arch-pill muted">
              <input
                type="checkbox"
                checked={opts.aiFallback === true}
                onChange={(e) =>
                  setOpts({ ...opts, aiFallback: e.currentTarget.checked })
                }
              />{" "}
              AI fallback
            </label>
            <label class="arch-pill muted">
              <input
                type="checkbox"
                checked={opts.all === true}
                onChange={(e) =>
                  setOpts({ ...opts, all: e.currentTarget.checked })
                }
              />{" "}
              --all (re-tag everything)
            </label>
            <button
              type="button"
              class="intake-go"
              disabled={starting}
              onClick={start}
            >
              <Icon name={starting ? "refresh" : "play"} size={16} />
              {starting ? "starting…" : "Start fetch"}
            </button>
          </div>
        </Card>
      ) : (
        <Verdict
          cls="warn"
          icon="refresh"
          text={
            job?.status === "queued"
              ? "Queued — waiting for the current job to finish."
              : (job?.message ?? "Running…")
          }
        />
      )}

      {job && isRunning(job) ? (
        <button type="button" class="arch-pill warn" onClick={cancel}>
          cancel run
        </button>
      ) : null}

      {/* ---- live progress ---- */}
      {job && job.status === "running" ? (
        <Card>
          <div class="jbar">
            <i
              style={{
                width: `${Math.max(2, Math.round((job.progress ?? 0) * 100))}%`,
              }}
            />
          </div>
          <small class="muted">
            {Math.round((job.progress ?? 0) * 100)}%
            {job.eta_seconds !== null
              ? ` · ~${Math.round(job.eta_seconds / 60)}m left`
              : ""}
          </small>
        </Card>
      ) : null}

      {/* ---- rung tally: the run's vote profile so far ---- */}
      {tasksSeen > 0 ? (
        <Card>
          <ListHead
            icon="grid"
            title="Rung tally — who voted, who won"
            n={tasksSeen}
            hint="Across every track processed this run: how many votes each rung cast, and how many elections it won. The ladder's shape, measured live."
          />
          <KVROWS_TALLY tally={tally} max={maxRungVotes} />
        </Card>
      ) : null}

      {/* ---- the feed: one row per track, newest last ---- */}
      {feed.entries.length > 0 ? (
        <Card>
          <ListHead
            icon="info"
            title="Ladder feed — every vote as it lands"
            n={feed.entries.filter((e) => e.type === "task").length}
            hint="Each row is one track's completed ladder: the votes cast (rung → genre, weight), the election (★ winner). New rows stream in as tracks finish."
          />
          <div class="genre-feed">
            {feed.entries.map((e, i) => {
              if (e.type === "start")
                return (
                  <div class="genre-feed-row start" key={`s${i}`}>
                    <Icon name="play" size={12} /> run started — {e.start.tasks}{" "}
                    tasks ({e.start.total} tracks)
                    {e.start.dry ? " · DRY RUN" : ""}
                  </div>
                );
              if (e.type === "done")
                return (
                  <div class="genre-feed-row done" key={`d${i}`}>
                    <Icon name="check" size={12} /> run complete —{" "}
                    {e.stats.genreElected ?? 0} elections from{" "}
                    {e.stats.votesCast ?? 0} votes
                  </div>
                );
              const t = e.task;
              return (
                <div class="genre-feed-row" key={`t${i}`}>
                  <div class="genre-feed-name">
                    {t.done}/{t.total} · {t.name}
                  </div>
                  {t.votes.length === 0 ? (
                    <div class="genre-feed-votes muted">
                      no votes — honest abstain
                    </div>
                  ) : (
                    <div class="genre-feed-votes">
                      {t.votes.map((v, vi) => {
                        const rung = RUNGS.get(v.rung);
                        return (
                          <span
                            class="arch-pill"
                            key={`${v.rung}${vi}`}
                            title={`${rung?.name ?? v.rung} · w=${v.weight.toFixed(2)} · ${rung?.description ?? ""}`}
                          >
                            {rung?.name ?? v.rung}
                            <b> {v.genre}</b>
                            <small> w={v.weight.toFixed(2)}</small>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {t.elected ? (
                    <div class="genre-feed-elect">
                      ★ <b>{t.elected.genre}</b>
                      <small>
                        {" "}
                        w={t.elected.weight.toFixed(2)} ·{" "}
                        {t.elected.winnerRungs
                          .map((r) => RUNGS.get(r)?.name ?? r)
                          .join(" + ")}
                      </small>
                    </div>
                  ) : (
                    <div class="genre-feed-elect muted">
                      no election (junk-gated or write failed)
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={feedBottom} />
          </div>
        </Card>
      ) : null}

      {!job && feed.entries.length === 0 ? (
        <Card>
          <div class="empty">
            <Icon name="info" size={14} /> Press Start — the ladder's votes,
            elections and rung tally stream here as tracks finish.
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/** The tally bars — one row per rung that voted this run. */
function KVROWS_TALLY(props: {
  tally: Map<string, { votes: number; elected: number }>;
  max: number;
}): preact.ComponentChildren {
  const rows = genreVoteRungsInOrder()
    .map((rung) => {
      const t = props.tally.get(rung.id);
      return t ? { rung, ...t } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  return (
    <div class="genre-tally">
      {rows.map((r) => (
        <div class="genre-tally-row" key={r.rung.id}>
          <span class="genre-tally-name">{r.rung.name}</span>
          <span
            class="votebar"
            style={{ width: `${(r.votes / props.max) * 70}%` }}
          />
          <span class="genre-tally-nums">
            {r.votes} vote{r.votes === 1 ? "" : "s"}
            {r.elected > 0 ? ` · ★ ${r.elected} won` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
