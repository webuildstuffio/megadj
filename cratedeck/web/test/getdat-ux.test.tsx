// getdat-ux.test.tsx — pins for the Sep 19 polish pass:
//   1. FetchedGate renders a SPINNING loading gate and a bad-toned error
//      (the shared fetch-state vocabulary — a bare muted line read as a
//      hang and errors didn't read as errors).
//   2. The #256 surfaced-link cohort is visible in the web UI: the
//      SurfacedLinksCard renders on Pipeline + Backlog, keyed off
//      ingestStatus().surfaced (the wire the producer fills), and the
//      pipeline share-bar gains its seg.
//   3. Canvas.css consumes the primary-button token block — the raw-green
//      hexes must stay retired (tokens.css header rule).
//   4. The #260 processing funnel (EnrichmentFunnel): the pipeline tab
//      decomposes downloaded vs finished — no-genre meter, raw batch
//      folders with one-click intake, and the genre-pass jump. The
//      surfaced batch button navigates to the Intake tab (job-based).
// The surfaced-card pins moved to products/getdat/surfaced-card.test.tsx
// (test-placement #246: co-located beside the extracted subject).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import render from "preact-render-to-string";
import { FetchedGate } from "../ui/useFetched";
import { EnrichmentFunnel } from "../products/getdat/getdat-tabs";

describe("FetchedGate shared states (Sep 19 polish)", () => {
  test("loading spins — motion implies work, static text implied a hang", () => {
    const html = render(
      <FetchedGate page={{ status: "loading" }} loading="loading library…" />,
    );
    expect(html).toContain("loading library…");
    expect(html).toContain('class="spin"');
    expect(html).toContain("lucide-rotate-cw");
  });

  test("errors carry the bad tone + a real error glyph", () => {
    const html = render(
      <FetchedGate
        page={{ status: "error", message: "archive offline" }}
        loading="x"
      />,
    );
    expect(html).toContain("archive offline");
    expect(html).toContain("note bad");
    expect(html).toContain("lucide-circle-x");
  });
});

// refresh() must actually re-run the loader: the tick state has to be in
// the effect's dep array. (Found live Sep 19: setTick existed but the
// effect keyed only on the caller's deps — refresh bumped state that
// nothing read, so the pending-queue card never updated after a skip.)
describe("useFetched refresh (post-mutation reload)", () => {
  const src = readFileSync(
    join(import.meta.dir, "../ui/useFetched.tsx"),
    "utf8",
  );

  test("refresh's tick is an effect dep (the loader really re-runs)", () => {
    expect(src).toContain("setTick");
    expect(src).toMatch(/\[\.\.\.deps,\s*tick\]/);
  });

  test("refresh is exposed on the ok branch", () => {
    expect(src).toContain("refresh: () => setTick((t) => t + 1)");
  });
});

// ---- #260 processing funnel -------------------------------------------------

const funnelStages = {
  noGenre: 1200,
  genreVoted: 480,
  rawBatches: [
    { folder: "/music/DJ-Imports/2026-09-19-b", files: 12 },
    { folder: "/music/DJ-Imports/2026-09-19-a", files: 4 },
  ],
};

/** The tabs module source — read once, shared by the funnel pins (a
 *  per-test local would re-read + shadow this one). */
const funnelTabsSrc = readFileSync(
  join(import.meta.dir, "../products/getdat/getdat-tabs.tsx"),
  "utf8",
);

describe("EnrichmentFunnel (#260 downloaded ≠ finished)", () => {
  test("renders the genre-voted meter against the unprocessed remainder", () => {
    const html = render(<EnrichmentFunnel stages={funnelStages} />);
    expect(html).toContain("Processing funnel");
    expect(html).toContain("480"); // genre-voted
    expect(html).toContain("1,200"); // no-genre
    expect(html).toContain("ft-meter-fill");
  });

  test("every raw batch folder is a one-click intake button", () => {
    const html = render(<EnrichmentFunnel stages={funnelStages} />);
    // labels show the BATCH NAME; the POST body carries the absolute path
    // (the /intake/start allowlist's shape — the Sep 20 contract fix)
    expect(html).toContain("process 2026-09-19-b (12)");
    expect(html).toContain("process 2026-09-19-a (4)");
    expect(html).toContain(
      'title="Run the full intake pipeline on /music/DJ-Imports/2026-09-19-b (12 files)"',
    );
    expect(html).toContain("16 raw in 2 batch folders");
  });

  test("the button POSTs the absolute folder, not the label", () => {
    // source pin: the POST body uses props.folder verbatim (absolute);
    // only the visible label is shortened to the batch name.
    expect(funnelTabsSrc).toContain("{ folder: props.folder }");
    expect(funnelTabsSrc).toContain(
      'props.folder.split("/").filter(Boolean).pop()',
    );
  });

  test("the genre-pass fix routes to the FullTags Run tab", () => {
    const html = render(<EnrichmentFunnel stages={funnelStages} />);
    expect(html).toContain("run the genre pass");
    expect(funnelTabsSrc).toContain('navigateProduct("fulltags", "run")');
  });

  test("an empty raw-batches list renders no intake buttons", () => {
    const html = render(
      <EnrichmentFunnel stages={{ ...funnelStages, rawBatches: [] }} />,
    );
    expect(html).not.toContain("process 2026-");
    expect(html).toContain("Processing funnel");
  });

  test("the surfaced batch button navigates to the Intake tab (job-based)", () => {
    // the old blocking call had a 600s client deadline — the job route
    // returns at once and the user watches the run on the Intake tab
    expect(funnelTabsSrc).not.toContain("600_000");
    expect(funnelTabsSrc).toContain('navigateProduct("getdat", "intake")');
  });
});
