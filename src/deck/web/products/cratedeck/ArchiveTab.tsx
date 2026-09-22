// ArchiveTab.tsx — the archive half of surface-parity A3, UX pass (Sep 8).
//
// The first render was the pipeline internals in a 2×2 card grid: raw DB
// status buckets ("pending 1064", "gone 90"), verdict-less analysis cards,
// and two actionable lists that hid their data (the off/octave BPM numbers
// and the LOWQ reasons existed in the payloads but were never rendered).
// Nobody could answer the only three questions that matter:
//   1. Is my music library healthy?      → the verdict banner
//   2. What needs work?                  → the work queue (fix-first order)
//   3. What did I add lately?            → recently added
// Fix-first order: Beat Sync breakers (off/octave grids) outrank quality
// upgrades (LOWQ) outrank metadata chores. Every list is copyable so the
// fix (an agent running megadj) is one paste away.
//
// Archive reads stay READ-ONLY (§4-A1): this tab describes work, it never
// writes — the fix is always a megadj command, shown per-card.
//
// Split per concern (#233, the #209 pattern): the fetch + verdict wiring
// and section assembly stay here; the pure verdict engine + banner live
// in ArchiveTabVerdict.tsx and the render sections in
// ArchiveTabSections.tsx.

import { api } from "../../ui/toast";
import { Icon } from "../../ui/icons";
import { FetchedGate, useFetched } from "../../ui/useFetched";
import { InfoTip, TabIntro } from "../../ui/InfoTip";
import {
  deriveVerdict,
  VerdictBanner,
  type IngestPayload,
  type MoodPayload,
  type LowqPayload,
  type GridPayload,
} from "./ArchiveTabVerdict";
import {
  PipelineExplainer,
  SyncBreakers,
  GridHealthSection,
  LowqSection,
  RetryBacklogSection,
  MoodProfileSection,
  RecentlyAddedSection,
} from "./ArchiveTabSections";
import { collectBreakers } from "../shared";

type ArchivePayload = [IngestPayload, MoodPayload, LowqPayload, GridPayload];

export function ArchiveTab() {
  const page = useFetched<ArchivePayload>(
    () =>
      Promise.all([
        api<IngestPayload>("/api/archive/ingest-status"),
        api<MoodPayload>("/api/archive/mood"),
        api<LowqPayload>("/api/archive/lowq"),
        api<GridPayload>("/api/archive/grid-cross-check"),
      ]),
    [],
  );
  const [ingest, mood, lowq, grid] =
    page.status === "ok" ? page.data : [null, null, null, null];

  if (page.status !== "ok" || !ingest)
    return <FetchedGate page={page} loading="loading archive reads…" />;

  // ---- the verdict: one line a human reads before anything else ---------
  const verdict = deriveVerdict(ingest, mood, lowq, grid);
  const { syncRisk, qualityDebt, retryBacklog, analyzed, inArchive } = verdict;
  const { issues } = verdict;
  const breakers = collectBreakers(grid);

  return (
    <div>
      <TabIntro
        what="Your music library's report card — what's in it, and what still needs work."
        how="The verdict banner is the one-line answer. Below it, the work queue lists problems in fix-first order: tracks that will misbehave in the booth first, quality upgrades second, download backlog last. Copy any list and paste it to an agent (or run the shown megadj command) to work it."
        next="Everything here is read-only — fixes happen via megadj, and each card names the command."
      />

      {/* ---- verdict banner ---- */}
      <VerdictBanner
        verdict={verdict}
        inArchive={inArchive}
        analyzed={analyzed}
        moodAvailable={Boolean(mood?.available)}
      />

      {/* ---- what the archive IS (one sentence + the pipeline shape) ---- */}
      <PipelineExplainer ingest={ingest} />

      {/* ---- THE WORK QUEUE: fix-first order, every list copyable ---- */}
      <h3 class="sect">
        <Icon name="sliders" /> Needs work
        <span class="sect-n">{issues.reduce((s, i) => s + i.n, 0)}</span>
        <InfoTip
          title="Needs work"
          body="Ordered by what hurts the set first: tracks whose beatgrid will fight the CDJ's Beat Sync, then below-quality files, then the download backlog. Copy a list and paste it to an agent — or run the megadj command on the card."
          align="right"
        />
      </h3>

      {/* 1 — Beat Sync breakers: the highest-stakes list, with numbers.
          Card body is the shared BeatSyncBreakersCard (products/shared). */}
      <SyncBreakers grid={grid} breakers={breakers} syncRisk={syncRisk} />

      {/* 1b — Grid health (GA-05c, #167): the shelf-tier triage buckets
          (SYNC vs analysis) over the collection's ANLZ + our ledger. */}
      <GridHealthSection />

      {/* 2 — LOWQ: quality upgrades */}
      <LowqSection lowq={lowq} qualityDebt={qualityDebt} />

      {/* 3 — retry backlog: failed + gone in one actionable count */}
      <RetryBacklogSection ingest={ingest} retryBacklog={retryBacklog} />

      {issues.length === 0 && (
        <div class="note ok">
          <Icon name="check" size={14} /> Nothing needs work — the queue is
          empty.
        </div>
      )}

      {/* ---- context cards: mood character + what landed lately ---- */}
      <h3 class="sect">
        <Icon name="bolt" /> Library character
        <InfoTip
          title="Library character"
          body="Aggregate analysis of the archive: mood/dance/valence averages describe the library's overall vibe, extremes are the outliers worth reaching for, and recently-added is the freshest material."
        />
      </h3>
      <div class="archive-cols">
        <MoodProfileSection mood={mood} analyzed={analyzed} />
        <RecentlyAddedSection ingest={ingest} />
      </div>
    </div>
  );
}
