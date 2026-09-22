// surfaced-card.test.tsx — co-located pins for the surfaced-link workflow
// card (test-placement #246: the subject's test sits beside it). Covers
// the Sep 19 card (clickable URLs + checkbox) and the Sep 21 round
// (pagination, per-row set provenance chips, the parvati sets strip,
// clickable stat/share-bar affordances).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import render from "preact-render-to-string";
import { SurfacedLinksCard } from "./surfaced-card";

const tabsSrc = readFileSync(join(import.meta.dir, "getdat-tabs.tsx"), "utf8");
const statsSrc = readFileSync(
  join(import.meta.dir, "../../ui/stats.tsx"),
  "utf8",
);
const sharedSrc = readFileSync(
  join(import.meta.dir, "../shared/index.tsx"),
  "utf8",
);
const fleetCss = readFileSync(
  join(import.meta.dir, "../../styles/fleet-tabs.css"),
  "utf8",
);

const surfacedRow = {
  video_id: "123",
  title: "Shelter",
  artist: "Porter Robinson",
  url: "https://example.com/buy",
  links: [{ kind: "purchase_url", url: "https://example.com/buy" }],
  done: false,
  done_at: null,
  source: "soundcloud:mmw-2026",
};

describe("surfaced-link cohort in the web UI (#256 parity)", () => {
  test("SurfacedLinksCard renders clickable URLs, checkbox and the CLI pointer", () => {
    const html = render(
      <SurfacedLinksCard rows={[surfacedRow]} context="ledger" />,
    );
    expect(html).toContain("Shelter");
    expect(html).toContain("Porter Robinson");
    // URL-first: the bare link, rendered as a real anchor
    expect(html).toContain('href="https://example.com/buy"');
    expect(html).toContain("example.com/buy");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("megadj surfaced-note");
  });

  test("the two contexts frame the same rows differently (one component)", () => {
    const ledger = render(
      <SurfacedLinksCard rows={[surfacedRow]} context="ledger" />,
    );
    const backlog = render(
      <SurfacedLinksCard rows={[surfacedRow]} context="backlog" />,
    );
    expect(ledger).toContain("go through them instead of ripping");
    expect(backlog).toContain("yours to click");
  });

  test("backlog context exposes the batch finalize (fulltags ingest) flow", () => {
    const backlog = render(
      <SurfacedLinksCard
        rows={[{ ...surfacedRow, done: true, done_at: "2026-09-19T22:00:00Z" }]}
        context="backlog"
      />,
    );
    expect(backlog).toContain("surfaced-batch");
    expect(backlog).toContain("Music/Downloads");
    // an UNDONE row renders without the batch row (nothing to finalize)
    const open = render(
      <SurfacedLinksCard rows={[surfacedRow]} context="backlog" />,
    );
    expect(open).not.toContain("surfaced-batch");
  });

  test("both GetDat tabs key off ingest.surfaced (the producer-filled wire)", () => {
    expect(tabsSrc).toContain("ingest.surfaced");
    // pipeline renders it as ledger context, backlog as the work item
    expect(tabsSrc).toContain('context="ledger"');
    expect(tabsSrc).toContain('context="backlog"');
  });

  test("pipeline share-bar has a surfaced seg wired to the info color", () => {
    expect(tabsSrc).toContain('cls: "surfaced"');
    expect(fleetCss).toContain(".arch-seg.surfaced");
    expect(fleetCss).toContain(".arch-legend i.surfaced");
  });

  test("rows carry set provenance chips + full pagination (70 rows reachable)", () => {
    const html = render(
      <SurfacedLinksCard
        rows={Array.from({ length: 70 }, (_, i) => ({
          ...surfacedRow,
          video_id: `id-${i}`,
          source: "soundcloud:mmw-2026",
        }))}
        context="ledger"
      />,
    );
    // per-row set chip
    expect(html).toContain("surfaced-src");
    expect(html).toContain("mmw-2026");
    // pagination: page 1 of 3, not a silent cap
    expect(html).toContain("page 1 / 3");
    expect(html).toContain("70 rows");
  });

  test("the sets strip renders per-set progress from the ledger census", () => {
    const html = render(
      <SurfacedLinksCard
        rows={[surfacedRow]}
        context="backlog"
        sets={[
          {
            slug: "summer-2025",
            total: 96,
            downloaded: 7,
            gone: 45,
            surfaced: 36,
            pending: 0,
          },
        ]}
      />,
    );
    expect(html).toContain("playlists being gone through");
    expect(html).toContain("summer-2025");
    expect(html).toContain("7</i> in archive");
    expect(html).toContain("36</i> links open");
    expect(html).toContain("open set");
    expect(html).toContain(
      "https://soundcloud.com/parvati-rajesh/sets/summer-2025",
    );
  });

  test("stat cards + share-bar segs are clickable (jump affordance)", () => {
    expect(statsSrc).toContain("onClick?: (() => void) | undefined");
    expect(sharedSrc).toContain("onClick?: () => void;");
    expect(fleetCss).toContain(".stat.clickable");
    expect(fleetCss).toContain(".arch-seg.clickable");
  });
});

describe("canvas primary-button tokens (retired raw greens stay retired)", () => {
  test("canvas.css reads the token block", () => {
    const canvasCss = readFileSync(
      join(import.meta.dir, "../../styles/canvas.css"),
      "utf8",
    );
    const tokensCss = readFileSync(
      join(import.meta.dir, "../../styles/tokens.css"),
      "utf8",
    );
    expect(tokensCss).toContain("--accent-btn-bg");
    expect(canvasCss).toContain("var(--accent-btn-bg)");
    expect(canvasCss).not.toContain("#0f2b1e");
    expect(canvasCss).not.toContain("#256b49");
  });
});
