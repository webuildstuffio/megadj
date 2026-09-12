import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import render from "preact-render-to-string";
import { SimilarTab, TrackPickSearch } from "../products/fulltags/SimilarTab";
import { SearchBar } from "../ui/data";

const noop = () => undefined;
const source = readFileSync(
  join(import.meta.dir, "../products/fulltags/SimilarTab.tsx"),
  "utf8",
);
const appSource = readFileSync(join(import.meta.dir, "../app/App.tsx"), "utf8");

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
    const html = render(<SimilarTab />);
    expect(html).toContain('aria-label="Set builder evidence"');
    expect(html).toContain("Entire downloaded archive DB");
    expect(html).toContain("Beats ledger BPM");
    expect(html).toContain("file key tags");
    expect(html).toContain("Mood ledger energy");
    expect(html).toContain("±6% tempo");
    expect(html).toContain("Writes no tags or playlists");
  });

  test("preset buttons expose radio semantics and lock during a build", () => {
    const html = render(<SimilarTab />);
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
    const html = render(<SimilarTab />);
    expect(html).toContain("Build a mix from your whole archive");
    expect(html).toContain("2</span> Set the length and build");
    expect(html).toContain('class="btn primary setbuild-build"');
    expect(html).toContain("Build 60-minute Peak time set");
    expect(html).toContain("How FullTags scores this proposal");
    expect(html).toContain('aria-busy="false"');
    expect(source).toContain("invalidateProposal");
    expect(source).toContain('build.stale ? "Update"');
    expect(source).toContain("Proposal settings changed");
  });

  test("minutes stay editable before normalizing to the supported range", () => {
    expect(source).toContain('useState("60")');
    expect(source).toContain("setMinutesInput(next)");
    expect(source).toContain("onBlur={() => setMinutesInput(String(minutes))}");
  });
});
