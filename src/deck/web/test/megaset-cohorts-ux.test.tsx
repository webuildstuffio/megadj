// megaset-cohorts-ux.test.tsx — rev-51: the megaset product's Cohorts
// tab renders the shared plan wire honestly. Pins:
//   - the tab mounts in PRODUCT_TABS (header nav + page tabs stay twins)
//   - MegasetCohorts renders per-family warmup/peak cards with the
//     shortfall visible (a short arm is never dressed up as complete)
//   - the all_complete verdict + outside-scope note ride the DOM
//   - the empty-cohort-list error path surfaces the route's 400 message
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import render from "preact-render-to-string";
import { MegasetCohorts } from "../products/megaset/MegasetCohorts";
import { PRODUCT_TABS } from "../products/shared/product-meta";
import type { CohortPlanWire } from "../products/megaset/cohorts-view";

const plan: CohortPlanWire = {
  command: "megaset-cohorts",
  minutes: 30,
  families: ["edm", "techno"],
  cohorts: [
    {
      family: "edm",
      warmup: {
        preset: "warmup",
        actualMinutes: 30,
        requestedMinutes: 30,
        complete: true,
        shortfallMinutes: 0,
        steps: 14,
        avgTransition: 1.1,
        minTransition: 0.9,
        sameArtistPairs: 0,
        genreFiltered: 683,
        pool: 700,
      },
      peak: {
        preset: "peak",
        actualMinutes: 28,
        requestedMinutes: 30,
        complete: false,
        shortfallMinutes: 2,
        steps: 12,
        avgTransition: 1.2,
        minTransition: 1.0,
        sameArtistPairs: 2,
        genreFiltered: 683,
        pool: 700,
      },
    },
    {
      family: "techno",
      warmup: {
        preset: "warmup",
        actualMinutes: 4,
        requestedMinutes: 30,
        complete: false,
        shortfallMinutes: 26,
        steps: 2,
        avgTransition: null,
        minTransition: null,
        sameArtistPairs: 0,
        genreFiltered: 3,
        pool: 3,
      },
      peak: {
        preset: "peak",
        actualMinutes: 4,
        requestedMinutes: 30,
        complete: false,
        shortfallMinutes: 26,
        steps: 2,
        avgTransition: null,
        minTransition: null,
        sameArtistPairs: 0,
        genreFiltered: 3,
        pool: 3,
      },
    },
  ],
  all_complete: false,
  outside_scope: {
    blank_genre_note:
      "tracks with no genre tag are outside every cohort's scope by design",
  },
  elapsed_ms: 812,
};

const planner = (
  over: Partial<Parameters<typeof MegasetCohorts>[0]["planner"]> = {},
) =>
  ({
    state: {
      data: null,
      loading: false,
      error: null,
      requestedMinutes: 60,
    },
    familiesInput: "",
    setFamiliesInput: () => undefined,
    minutesInput: "60",
    setMinutesInput: () => undefined,
    minutes: 60,
    request: () => undefined,
    ...over,
  }) as Parameters<typeof MegasetCohorts>[0]["planner"];

describe("#295/rev-51 Cohorts tab", () => {
  test("the tab is registered in PRODUCT_TABS (nav + page switch together)", () => {
    expect(PRODUCT_TABS.megaset.map((t) => t.id)).toContain("cohorts");
    // and the page file switches on it
    const page = readFileSync(
      join(import.meta.dir, "../products/megaset/MegasetPage.tsx"),
      "utf8",
    );
    expect(page).toContain('tab === "cohorts"');
  });

  test("renders per-family arms with shortfall + diversity visible", () => {
    const html = render(
      <MegasetCohorts
        planner={planner({
          state: {
            data: plan,
            loading: false,
            error: null,
            requestedMinutes: 30,
          },
        })}
      />,
    );
    // both families render
    expect(html).toContain("edm");
    expect(html).toContain("techno");
    // the short peak is labeled with its shortfall, not hidden
    expect(html).toContain("short 2m");
    // the B6 diversity card rides the arm
    expect(html).toContain("same-artist pair");
    // the honest verdict (not "all complete")
    expect(html).toContain("fell short");
  });

  test("outside-scope note is rendered (the honest-gap rule is visible)", () => {
    const html = render(
      <MegasetCohorts
        planner={planner({
          state: {
            data: plan,
            loading: false,
            error: null,
            requestedMinutes: 30,
          },
        })}
      />,
    );
    // the apostrophe is HTML-escaped in the rendered details body
    expect(html).toContain("tracks with no genre tag are outside every cohort");
  });

  test("the error path surfaces the route's message (unknown family etc.)", () => {
    const html = render(
      <MegasetCohorts
        planner={planner({
          state: {
            data: null,
            loading: false,
            error: "unknown genre family: bootleg-house — known: edm, …",
            requestedMinutes: 60,
          },
        })}
      />,
    );
    expect(html).toContain("bootleg-house");
    expect(html).toContain("known:");
  });

  test("idle state shows the planner controls, not a fake result", () => {
    const html = render(<MegasetCohorts planner={planner()} />);
    expect(html).toContain("Plan cohorts");
    expect(html).toContain("families");
  });
});
