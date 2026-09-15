import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import render from "preact-render-to-string";
import { SetBuildPanel } from "../products/fulltags/SetBuildPanel";
import { SetBuilderResult } from "../products/fulltags/SetBuilderResult";
import { TrackPickSearch } from "../products/fulltags/TrackPickSearch";
import { SearchBar } from "../ui/data";
import type { SetBuildPayload } from "../../shared/types";

const noop = () => undefined;
const source = readFileSync(
  join(import.meta.dir, "../products/fulltags/SetBuildPanel.tsx"),
  "utf8",
);
const similarSource = readFileSync(
  join(import.meta.dir, "../products/fulltags/SimilarTab.tsx"),
  "utf8",
);
const pageSource = readFileSync(
  join(import.meta.dir, "../products/fulltags/FullTagsPage.tsx"),
  "utf8",
);
const sharedSource = readFileSync(
  join(import.meta.dir, "../products/shared.tsx"),
  "utf8",
);
const appSource = readFileSync(join(import.meta.dir, "../app/App.tsx"), "utf8");
const helpCss = readFileSync(
  join(import.meta.dir, "../styles/help.css"),
  "utf8",
);
const shellCss = readFileSync(
  join(import.meta.dir, "../styles/shell.css"),
  "utf8",
);

describe("FullTags Similar and Set Builder UX", () => {
  test("the search input and clear button have accessible names", () => {
    const html = render(
      <SearchBar
        value="acid"
        onInput={noop}
        placeholder="Search the archive"
      />,
    );
    expect(html).toContain('aria-label="Search the archive"');
    expect(html).toContain('aria-label="Clear search"');
  });

  test("the persistent archive search is named beyond its placeholder", () => {
    expect(appSource).toMatch(
      /id="global-search"[\s\S]{0,160}aria-label="Search every drive's playlists, folders and tracks"/,
    );
  });

  test("track picking explains short, loading, and failed searches", () => {
    const picker = (query: string, hitsStatus: "ok" | "loading" | "error") =>
      render(
        <TrackPickSearch
          query={query}
          onQuery={noop}
          hits={null}
          hitsStatus={hitsStatus}
          placeholder="Pick a track"
          onPick={noop}
        />,
      );

    expect(picker("a", "ok")).toContain("Type 2 or more characters");
    expect(picker("acid", "loading")).toContain('role="status"');
    expect(picker("acid", "loading")).toContain("Searching the archive");
    expect(picker("acid", "error")).toContain('role="alert"');
    expect(picker("acid", "error")).toContain("Search failed");
  });

  test("set builder names its evidence, checks, and write behavior", () => {
    const html = render(<SetBuildPanel />);
    expect(html).toContain('aria-label="Set builder evidence"');
    expect(html).toContain("Entire downloaded archive DB");
    expect(html).toContain("FullTags");
    expect(html).toContain("beat/mood ledgers first");
    expect(html).toContain("Rekordbox master BPM/key");
    expect(html).toContain("file key tags");
    expect(html).toContain("±6% tempo");
    expect(html).toContain("Writes no tags or playlists");
  });

  test("the set builder is its own top-level tab, out of Similar", () => {
    // tab strip SSOT: a dedicated "set" row between Mood and Similar
    expect(sharedSource).toMatch(
      /id: "mood"[\s\S]{0,240}id: "set"[\s\S]{0,240}id: "similar"/,
    );
    expect(sharedSource).toContain("MegaSet: build an ordered mix proposal");
    // the page canvas switches on it and SimilarTab no longer embeds it
    expect(pageSource).toContain('{tab === "set" && <SetBuildPanel />}');
    expect(similarSource).not.toContain("import { SetBuildPanel }");
  });

  test("preset buttons expose radio semantics and lock during a build", () => {
    const html = render(<SetBuildPanel />);
    expect(html).toContain("1</span> Choose the energy journey");
    expect(html.match(/setbuild-preset-option/g)).toHaveLength(3);
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-labelledby="setbuild-preset-label"');
    expect(html).toContain("Low");
    expect(html).toContain("Maximum");
    expect(html).toContain('class="setbuild-preset-arc"');
    expect(html).toContain("Selected");
    expect(source).toContain("disabled={build.loading}");
    expect(source).toContain("busy={build.loading}");
  });

  test("settings changes invalidate an old proposal and promote the one CTA", () => {
    const html = render(<SetBuildPanel />);
    expect(html).toContain("Build a set from your entire shelf");
    expect(html).toContain("2</span> Choose the set length");
    expect(html).toContain('aria-label="Set builder settings"');
    expect(html).toContain('type="submit"');
    expect(html).toContain('class="btn primary setbuild-build"');
    expect(html).toContain("Build 60-minute Peak time set");
    expect(html).toContain("How FullTags scores this proposal");
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain("Choose opening track");
    expect(html).toContain("optional · otherwise auto-picked");
    expect(source).toContain("invalidateProposal");
    expect(source).toContain('build.stale ? "Update"');
    expect(source).toContain("if (!build.loading) void run()");
    expect(source).toContain("Proposal settings changed");
  });

  test("minutes stay editable before normalizing to the supported range", () => {
    expect(source).toContain('useState("60")');
    expect(source).toContain("setMinutesInput(next)");
    expect(source).toContain("onBlur={() => setMinutesInput(String(minutes))}");
  });

  test("whole-library builds outlive the generic API deadline", () => {
    expect(source).toContain("timeoutMs: 90_000");
  });

  test("common set lengths are one-click presets with an editable custom value", () => {
    const html = render(<SetBuildPanel />);
    expect(html).toContain('aria-label="Common set lengths"');
    for (const minutes of [30, 60, 90, 120]) {
      expect(html).toContain(`>${minutes} min</button>`);
    }
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Custom set length in minutes');
  });

  test("short proposals are unmistakably partial and report the measured gap", () => {
    expect(source).toContain("build.data.complete");
    expect(source).toContain("build.data.actualMinutes");
    expect(source).toContain("build.data.shortfallMinutes");
    expect(source).toContain('role="alert"');
    expect(source).toContain("Partial draft");
    expect(source).toContain("minutes short");
  });

  test("post-build actions save locally and export through the read-only playlist endpoint", () => {
    expect(source).toContain("saveDraft");
    expect(source).toContain("Save JSON draft");
    expect(source).toContain('q.set("format", "m3u8")');
    expect(source).toContain("/api/archive/setbuild?");
    expect(source).toContain("Export .m3u8 for Rekordbox");
    expect(source).toContain("Import the .m3u8");
    expect(source).not.toContain("--apply");
  });

  /** Shared fixture: a healthy complete build (also the offline tests'
   *  base — they mutate the census numbers onto this shape). */
  const baseData: SetBuildPayload = {
    available: true,
    preset: "warmup",
    minutes: 60,
    actualMinutes: 62.4,
    shortfallMinutes: 0,
    complete: true,
    steps: [
      {
        videoId: "track-1",
        title: "Opening Track",
        artist: "DJ Test",
        bpm: 124,
        key: "8A",
        arousal: 4,
        atMin: 5.2,
        transition: null,
      },
    ],
    excluded: [],
    source_total: 3664,
    pool: 3563,
    missing_files: 93,
    duplicate_files: 8,
    relocated_files: 12,
    rekordbox_key_hits: 3362,
    rekordbox_bpm_hits: 3015,
    key_reads: 201,
    key_read_failures: 0,
    excluded_total: 0,
    freshness: { beatsAt: null, moodAt: null },
    search: "greedy",
  };

  test("the result separates the human verdict from source evidence", () => {
    const html = render(<SetBuilderResult data={baseData} />);

    expect(html).toContain("Ready to review");
    expect(html).toContain("62.4-minute Warm-up set draft");
    expect(html).toContain('aria-label="Set draft summary"');
    expect(html).toContain("What FullTags checked");
    expect(html).toContain("3,664 rows");
    expect(html).toContain("3,015 BPM · 3,362 keys");
    expect(html).toContain("201 key reads");
    expect(html).toContain("93 missing skipped");
    expect(html).toContain("read-only · nothing written");
    expect(html).toContain("standard greedy search");
    expect(html).not.toContain("small pool");
    expect(html).not.toContain("large pool");

    const htmlBeam = render(
      <SetBuilderResult data={{ ...baseData, search: "beam" }} />,
    );
    expect(htmlBeam).toContain("deep beam search");
  });

  test("an unmounted shelf gets an environment verdict, not a library scolding", () => {
    // the live failure signature: 3,664 DB rows, 8 sampler presets
    // mounted, everything else missing → the shelf volume is away
    const offlineData: SetBuildPayload = {
      ...baseData,
      complete: false,
      actualMinutes: 0,
      shortfallMinutes: 60,
      steps: [],
      source_total: 3664,
      pool: 8,
      missing_files: 3656,
      relocated_files: 0,
    };
    const html = render(<SetBuilderResult data={offlineData} />);

    expect(html).toContain("Shelf not mounted");
    expect(html).toContain("Connect the shelf volume, then build again");
    expect(html).toContain("the shelf drive is offline");
    expect(html).toContain("Nothing is lost; the library ledger is intact");
    expect(html).toContain("shelf offline — no mounted files considered");
    // the misleading old framing is gone for this state
    expect(html).not.toContain("More compatible tracks needed");
    expect(html).not.toContain("Partial draft");

    // the panel suppresses the partial-draft alarm for this state (the
    // guard is in source; the rendered form has no data yet)
    expect(source).toContain("!isShelfOffline(build.data, build.data)");

    // a genuinely small analyzed pool KEEPS the honest partial wording
    const smallPool: SetBuildPayload = {
      ...baseData,
      complete: false,
      actualMinutes: 22,
      shortfallMinutes: 38,
      source_total: 100,
      pool: 30,
      missing_files: 12,
    };
    const htmlSmall = render(<SetBuilderResult data={smallPool} />);
    expect(htmlSmall).toContain("More compatible tracks needed");
    expect(htmlSmall).toContain("22-minute Warm-up partial draft");
  });

  test("FullTags stays usable on a phone before the archive rail", () => {
    expect(helpCss).toContain('.app[data-prod="fulltags"] .rail');
    expect(helpCss).toMatch(
      /\.app\[data-prod="fulltags"\] \.rail\s*\{\s*display: none;/,
    );
    expect(shellCss).toMatch(
      /@media \(max-width: 720px\)[\s\S]*\.topbar \.search,[\s\S]*display: none;/,
    );
  });
});
