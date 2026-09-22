// fetch-events-census.test.ts — pins the megadj ↔ CrateDeck live-run
// protocol (#215 visibility pass). megadj fetch --json emits structured
// `@event {json}` lines on stderr; the CrateDeck fetch leg parses them
// into the feed the web Genre Run tab renders. The two sides share no
// code (separate products), so the CONTRACT is the pin: tag names, the
// wire shapes, and the parser's junk-refusal. A rename on either side
// fails here instead of silently blanking the live UI.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..");
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

import { parseFetchStart, parseFetchTask, fetchArgs } from "../job-legs";
import {
  emitFetchStart,
  emitTaskDone,
  emitFetchDone,
  taskDoneEvent,
  type FetchTaskDoneEvent,
} from "../../fulltags/fetch/fetch-events";
import {
  fetchFeedPush,
  fetchFeedSince,
  fetchFeedReset,
  fetchFeedClear,
} from "../fetch-feed";
import { JOB_KINDS } from "../shared/types";

describe("fetch live-run protocol (megadj stderr ↔ crateck feed)", () => {
  // ---- the emitter side (megadj) ----
  test("emitters produce the @tag {json} protocol on the three events", () => {
    const lines: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown): boolean => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      emitFetchStart({ total: 10, tasks: 8, jobs: 6, dry: false });
      const evt: FetchTaskDoneEvent = {
        done: 1,
        total: 8,
        name: "Artist - Title",
        notes: ["genre:Techno ELECTED"],
        votes: [{ rung: "bp", genre: "Techno", weight: 0.6 }],
        elected: {
          genre: "Techno",
          weight: 0.6,
          winnerRungs: ["bp"],
        },
      };
      emitTaskDone(evt, true);
      emitFetchDone({ votesCast: 1 });
      emitTaskDone(evt, false); // human mode: MUST be silent
    } finally {
      process.stderr.write = orig;
    }
    expect(lines).toHaveLength(3);
    expect(lines[0]?.trim()).toMatch(
      /^@fetch-start \{"total":10,"tasks":8,"jobs":6,"dry":false\}$/,
    );
    expect(lines[1]?.trim()).toMatch(/^@task-done \{.*"name":"Artist - Title"/);
    expect(lines[2]?.trim()).toMatch(
      /^@fetch-done \{"stats":\{"votesCast":1\}\}$/,
    );
    // taskDoneEvent maps votes to the wire triple
    const mapped = taskDoneEvent({
      done: 2,
      total: 8,
      name: "x",
      notes: [],
      votes: [
        { rung: "sc", genre: "House", weight: 0.35, detail: "d" } as never,
      ],
      elected: null,
    });
    expect(mapped.votes).toEqual([
      { rung: "sc", genre: "House", weight: 0.35 },
    ]);
  });

  // ---- the parser side (cratedeck leg) ----
  test("parseFetchStart accepts the shape, refuses junk", () => {
    expect(parseFetchStart({ total: 5, tasks: 4, jobs: 6, dry: true })).toEqual(
      {
        total: 5,
        tasks: 4,
        jobs: 6,
        dry: true,
      },
    );
    expect(parseFetchStart(null)).toBeNull();
    expect(parseFetchStart("x")).toBeNull();
    expect(parseFetchStart({ total: "5", tasks: 4, jobs: 6 })).toBeNull();
    expect(parseFetchStart({ total: 5, tasks: 4 })).toBeNull(); // missing jobs
    expect(parseFetchStart({ total: 5, tasks: 4, jobs: 6 })).toMatchObject({
      dry: false,
    }); // dry defaults false
  });

  test("parseFetchTask accepts the shape, refuses junk fields", () => {
    const good = parseFetchTask({
      done: 1,
      total: 3,
      name: "A - B",
      notes: ["tags(genre)"],
      votes: [
        { rung: "bp", genre: "Techno", weight: 0.6 },
        { rung: "junk", weight: "no" },
        null,
      ],
      elected: { genre: "Techno", weight: 0.6, winnerRungs: ["bp", 7] },
    });
    expect(good).not.toBeNull();
    expect(good!.votes).toEqual([{ rung: "bp", genre: "Techno", weight: 0.6 }]);
    expect(good!.elected).toEqual({
      genre: "Techno",
      weight: 0.6,
      winnerRungs: ["bp"],
    });
    expect(parseFetchTask({ done: "x" })).toBeNull();
    expect(parseFetchTask([])).toBeNull();
    // elected junk → null election, not a crash
    const badElect = parseFetchTask({
      done: 1,
      total: 3,
      name: "n",
      notes: [],
      votes: [],
      elected: { genre: 42, weight: -1, winnerRungs: [] },
    });
    expect(badElect!.elected).toBeNull();
  });

  // ---- the feed ring ----
  test("feed: push/since cursor arithmetic + reset", () => {
    fetchFeedClear();
    fetchFeedReset();
    fetchFeedPush({
      at: 1,
      type: "start",
      start: { total: 1, tasks: 1, jobs: 1, dry: false },
    });
    fetchFeedPush({
      at: 2,
      type: "task",
      task: {
        done: 1,
        total: 1,
        name: "n",
        notes: [],
        votes: [],
        elected: null,
      },
    });
    const all = fetchFeedSince(0);
    expect(all.entries).toHaveLength(2);
    expect(all.next).toBe(2);
    const tail = fetchFeedSince(1);
    expect(tail.entries).toHaveLength(1);
    expect(tail.entries[0]!.type).toBe("task");
    // a cursor past the end (feed reset under the poller) heals
    const healed = fetchFeedSince(99);
    expect(healed.next).toBe(2);
    fetchFeedClear();
  });

  // ---- the leg argv seam ----
  test("fetchArgs maps options to CLI flags", () => {
    expect(fetchArgs({})).toEqual(["fetch", "--json"]);
    expect(
      fetchArgs({
        all: true,
        only: "genres",
        aiFallback: true,
        dryRun: true,
        jobs: 4,
      }),
    ).toEqual([
      "fetch",
      "--json",
      "--all",
      "--genres",
      "--ai-fallback",
      "--dry-run",
      "--jobs",
      "4",
    ]);
  });

  // ---- both sides stay tied to the job-kind SSOT ----
  test("the fetch job kind exists + both doc tables carry it", () => {
    expect(JOB_KINDS).toContain("fetch");
    const { KIND_DOCS } = require("../deckctl/docs") as {
      KIND_DOCS: Record<string, unknown>;
    };
    const { HELP_JOBS } = require("../shared/help") as {
      HELP_JOBS: { kind: string }[];
    };
    expect(KIND_DOCS.fetch).toBeDefined();
    expect(HELP_JOBS.some((j) => j.kind === "fetch")).toBeTrue();
  });

  test("the megadj pipeline still emits only on stderr (stdout stays P1-pure)", () => {
    // the emitter module must write process.stderr, never stdout
    const src = read("src/fulltags/fetch/fetch-events.ts");
    expect(src).toContain("process.stderr.write");
    expect(src).not.toContain("process.stdout.write");
    expect(src).not.toContain("console.log");
    // and the pipeline gates events on jsonOut (human stderr keeps the bar)
    const pipe = read("src/fulltags/fetch/fetch-pipeline.ts");
    expect(pipe).toContain("emitFetchStart");
    expect(pipe).toContain("emitTaskDone");
    expect(pipe).toContain("emitFetchDone");
    expect(pipe).toMatch(/if \(jsonOut\)\s*\n\s*emitTaskDone/);
  });
});
