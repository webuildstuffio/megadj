import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import render from "preact-render-to-string";
import { MegasetPanel } from "../products/fulltags/MegasetPanel";
import { MegasetArcChart } from "../products/fulltags/MegasetArcChart";
import { MegasetResult } from "../products/fulltags/MegasetResult";
import {
  MegasetLoading,
  ReproLine,
  ExcludedBreakdown,
} from "../products/fulltags/MegasetStatus";
import {
  MEGASET_PRESET_DEFS,
  groupMegasetExcluded,
  type MegasetPayload,
} from "../../shared/types";
import { TrackPickSearch } from "../products/fulltags/TrackPickSearch";
import { SearchBar } from "../ui/data";

const noop = () => undefined;
const source = readFileSync(
  join(import.meta.dir, "../products/fulltags/MegasetPanel.tsx"),
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
const megasetPageSource = readFileSync(
  join(import.meta.dir, "../products/megaset/MegasetPage.tsx"),
  "utf8",
);
const routerSource = readFileSync(
  join(import.meta.dir, "../app/router.ts"),
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
    const html = render(<MegasetPanel />);
    expect(html).toContain('aria-label="MegaSet builder evidence"');
    expect(html).toContain("Entire downloaded archive DB");
    expect(html).toContain("FullTags");
    expect(html).toContain("beat/mood ledgers first");
    expect(html).toContain("Rekordbox master BPM/key");
    expect(html).toContain("file key tags");
    expect(html).toContain("±6% tempo");
    expect(html).toContain("Writes no tags or playlists");
  });

  test("MegaSet is its own top-level product, equal to CrateDeck/GetDat/FullTags", () => {
    // product SSOT: MegaSet is a Product union member, a nav-strip row
    // with its own lede + launcher card, and its own canvas route
    // (#/megaset; legacy #/set + #/fulltags/set still resolve)
    expect(routerSource).toContain(
      '"drives" | "fleet" | "getdat" | "fulltags" | "megaset"',
    );
    expect(sharedSource).toContain('id: "megaset"');
    expect(sharedSource).toContain('label: "MegaSet"');
    expect(sharedSource).toContain("the library gets played");
    expect(sharedSource).toContain(
      "The payoff. MegaSet turns every measurement",
    );
    // the canvas switch renders MegasetPage on the megaset route, and the
    // page actually mounts the panel
    expect(appSource).toContain('route.product === "megaset"');
    expect(megasetPageSource).toContain("<MegasetPanel />");
    // legacy deep links keep working: #/fulltags/set redirects to the product
    expect(routerSource).toMatch(/fulltags[\s\S]{0,200}product: "megaset"/);
    // FullTags no longer owns the set tab or imports the panel
    expect(pageSource).not.toContain('{tab === "set" && <MegasetPanel />}');
    expect(similarSource).not.toContain("import { MegasetPanel }");
  });

  test("preset buttons expose radio semantics and lock during a build", () => {
    const html = render(<MegasetPanel />);
    // the step-1 hint carries the product's voice — the room, first to last
    expect(html).toContain("Energy journey");
    expect(html).toContain("how the room should feel from first track to last");
    expect(html).toContain("MegaSet length");
    expect(html).toContain("Sequencer");
    expect(html.match(/megaset-preset-option/g)).toHaveLength(3);
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-labelledby="megaset-preset-label"');
    expect(html).toContain("Low");
    expect(html).toContain("Maximum");
    expect(html).toContain('class="megaset-preset-arc"');
    expect(html).toContain("Selected");
    expect(source).toContain("disabled={build.loading}");
    expect(source).toContain("busy={build.loading}");
  });

  test("settings changes invalidate an old proposal and promote the one CTA", () => {
    const html = render(<MegasetPanel />);
    expect(html).toContain("Build a set from your entire shelf");
    expect(html).toContain("MegaSet length");
    expect(html).toContain('aria-label="MegaSet builder settings"');
    expect(html).toContain('type="submit"');
    expect(html).toContain('class="btn primary megaset-build"');
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

  test("the advanced drawer exposes the pool cap and the engine's real numbers", () => {
    const html = render(<MegasetPanel />);
    expect(html).toContain("Advanced");
    expect(html).toContain("pool cap · scoring weights");
    expect(html).toContain('aria-label="Candidate pool cap, 1 to 1000');
    expect(html).toContain("empty = all");
    // the constants are quoted from the SHARED registry (derive, never twin)
    expect(html).toContain("beyond ±6% a track is unmixable");
    expect(html).toContain("tempo 0.45 · key 0.3 · arc fit 0.25");
    expect(html).toContain("1–15 min per track");
    expect(html).toContain("width 8");
    // plain-language sequencer help + determinism guarantee
    expect(html).toContain("same settings → the same chain");
    expect(source).toContain("clampMegasetPool(parsed)");
    expect(source).toContain('q.set("limit", String(poolLimit))');
  });

  test("the loading explainer shows the staged phases with an elapsed timer", () => {
    const html = render(<MegasetLoading startedAt={Date.now() - 7000} />);
    expect(html).toContain("Building your set…");
    expect(html).toContain("7s");
    expect(html).toContain("reading the archive database");
    expect(html).toContain("checking files on the shelf");
    expect(html).toContain("sequencing the chain");
    expect(html).toContain("Read-only: nothing is written");
    expect(html).toContain("15–30 seconds");
    // source wires the timer to a real start timestamp
    expect(source).toContain("startedAt: Date.now()");
    expect(source).toContain("build.startedAt !== null");
  });

  test("the excluded list groups by reason with examples and keeps the raw audit", () => {
    const excluded = [
      { videoId: "1", title: "A", reason: "set budget filled" },
      { videoId: "2", title: "B", reason: "set budget filled" },
      { videoId: "3", title: null, reason: "set budget filled" },
      {
        videoId: "4",
        title: "D",
        reason:
          "no compatible transition (key clash, tempo outside ±6%, or beyond the set's drift budget)",
      },
      {
        videoId: "5",
        title: "E",
        reason:
          "no compatible transition (key clash, tempo outside ±6%, or beyond the set's drift budget)",
      },
    ] as MegasetPayload["excluded"];
    const data: MegasetPayload = {
      ...baseData,
      pool: 300,
      excluded_total: 5,
      excluded,
      // B13: the buckets come from the WIRE now (derived engine-side
      // from the FULL excluded list) — the component never re-buckets
      excluded_groups: groupMegasetExcluded(excluded),
    };
    const html = render(<ExcludedBreakdown data={data} />);
    // grouped buckets, biggest first, with example titles
    expect(html).toContain("3 tracks");
    expect(html).toContain("e.g. A, B, 3");
    expect(html).toContain("2 tracks");
    expect(html).toContain("e.g. D, E");
    // raw per-track audit stays reachable
    expect(html).toContain("every excluded track, one per line");
    // and the truncation note when the wire preview is capped
    const capped = render(
      <ExcludedBreakdown
        data={{
          ...data,
          excluded: data.excluded.slice(0, 4),
          excluded_total: 260,
        }}
      />,
    );
    expect(capped).toContain("save the JSON draft for the full list");
  });

  test("the repro line reconstructs the exact CLI invocation of the current settings", () => {
    const html = render(
      <ReproLine
        data={{ ...baseData, preset: "warmup", minutes: 45 }}
        searchChoice="beam"
        poolLimit={250}
        openerId="yt-abc"
      />,
    );
    expect(html).toContain("same build from the terminal:");
    expect(html).toContain(
      "megadj megaset --preset warmup --minutes 45 --search beam --limit 250 --opener yt-abc",
    );
    // auto/absent knobs stay out of the line
    const htmlMinimal = render(
      <ReproLine
        data={{ ...baseData, preset: "peak", minutes: 60 }}
        searchChoice="auto"
        poolLimit={null}
        openerId={null}
      />,
    );
    expect(htmlMinimal).toContain("megadj megaset --preset peak --minutes 60");
    expect(htmlMinimal).not.toContain("--search");
    expect(htmlMinimal).not.toContain("--limit");
  });

  test("the export carries every A/B knob so it reproduces the chain on screen", () => {
    expect(source).toContain('q.set("search", searchChoice)');
    expect(source).toContain('q.set("limit", String(poolLimit))');
    expect(source).toContain('if (opener) q.set("opener", opener.video_id)');
  });

  test("the arc chart plots energy against the preset envelope over real time", () => {
    const steps = [
      {
        videoId: "a",
        title: "Opener",
        artist: "DJ",
        bpm: 120,
        key: "8A",
        arousal: 3,
        atMin: 5,
        transition: null,
      },
      {
        videoId: "b",
        title: "Riser",
        artist: "DJ",
        bpm: 126,
        key: "8B",
        arousal: 6,
        atMin: 12,
        transition: 0.8,
      },
      {
        videoId: "c",
        title: "Peak",
        artist: "DJ",
        bpm: 130,
        key: "5A",
        arousal: 8.5,
        atMin: 30,
        transition: 0.7,
      },
    ];
    const html = render(
      <MegasetArcChart
        steps={steps}
        preset={MEGASET_PRESET_DEFS[1]!}
        keyGlide="8A → 5A"
      />,
    );
    expect(html).toContain('class="megaset-arcchart"');
    expect(html).toContain('class="arc-envelope"');
    expect(html).toContain('class="arc-arousal"');
    expect(html).toContain('class="arc-bpm"');
    // per-step hover targets carry the evidence
    expect((html.match(/arc-hit/g) ?? []).length).toBe(3);
    expect(html).toContain("#3 DJ — Peak");
    expect(html).toContain("30 min · 130 BPM · 5A · energy Maximum (8.5/9)");
    expect(html).toContain("transition 0.70");
    // caption: legend + glide + totals
    expect(html).toContain("Peak time target");
    expect(html).toContain("key glide 8A → 5A");
    expect(html).toContain("3 tracks · 30 min");
    // aria summary carries the journey + bpm range
    expect(html).toContain('role="img"');
    expect(html).toContain("120–130 BPM below");
  });

  test("whole-library builds outlive the generic API deadline", () => {
    expect(source).toContain("timeoutMs: 90_000");
  });

  test("common set lengths are one-click presets with an editable custom value", () => {
    const html = render(<MegasetPanel />);
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
    expect(source).toContain("/api/archive/megaset?");
    expect(source).toContain("Export .m3u8 for Rekordbox");
    expect(source).toContain("Import the .m3u8");
    expect(source).not.toContain("--apply");
  });

  /** Shared fixture: a healthy complete build (also the offline tests'
   *  base — they mutate the census numbers onto this shape). */
  const baseData: MegasetPayload = {
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
    excluded_groups: [],
    excluded_total: 0,
    source_total: 3664,
    pool: 3563,
    missing_files: 93,
    metadata_only: 0,
    duplicate_files: 8,
    relocated_files: 12,
    rekordbox_key_hits: 3362,
    rekordbox_bpm_hits: 3015,
    key_reads: 201,
    key_read_failures: 0,
    freshness: { beatsAt: null, moodAt: null },
    search: "greedy",
  };

  test("the result separates the human verdict from source evidence", () => {
    const html = render(<MegasetResult data={baseData} />);

    expect(html).toContain("Ready to review");
    expect(html).toContain("62.4-minute Warm-up set draft");
    expect(html).toContain('aria-label="MegaSet draft summary"');
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
      <MegasetResult data={{ ...baseData, search: "beam" }} />,
    );
    expect(htmlBeam).toContain("deep beam search");
  });

  test("an unmounted shelf gets an environment verdict, not a library scolding", () => {
    // the live failure signature: 3,664 DB rows, 8 sampler presets
    // mounted, everything else missing → the shelf volume is away
    const offlineData: MegasetPayload = {
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
    const html = render(<MegasetResult data={offlineData} />);

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
    const smallPool: MegasetPayload = {
      ...baseData,
      complete: false,
      actualMinutes: 22,
      shortfallMinutes: 38,
      source_total: 100,
      pool: 30,
      missing_files: 12,
    };
    const htmlSmall = render(<MegasetResult data={smallPool} />);
    expect(htmlSmall).toContain("More compatible tracks needed");
    expect(htmlSmall).toContain("22-minute Warm-up partial draft");
  });

  test("B1 (#104): a shelf-offline build that used mirror tempo is a PLAN, honestly labeled", () => {
    // the audit's live case, AFTER B1: the shelf is asleep but 3,500
    // rows carry measured tempo → the pool survives and the chain builds.
    // The verdict must say mirror-metadata draft, not "ready to review".
    const mirrorBuilt: MegasetPayload = {
      ...baseData,
      complete: true,
      pool: 3508,
      missing_files: 148,
      metadata_only: 3500,
    };
    const html = render(<MegasetResult data={mirrorBuilt} />);
    expect(html).toContain("Mirror-metadata draft — shelf offline");
    expect(html).toContain("scored from measured Rekordbox/FullTags tempo");
    expect(html).toContain("a PLAN, not a playable playlist");
    expect(html).toContain("3,500"); // the metadata-only count is visible
    // the mounted-pool metric no longer overstates: 3508 − 3500 = 8
    expect(html).toContain("8");
    expect(html).toContain("mounted files in the pool");
    // the tone is warn, not ok — a mirror draft is never presented as a
    // fully mounted build
    expect(html).toContain("megaset-result warn");
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
