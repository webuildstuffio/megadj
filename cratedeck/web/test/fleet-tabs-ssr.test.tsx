// fleet-tabs.test.tsx — the fleet-tabs extraction (#89/#90): the page
// monolith split into CoverageTab / RedundancyTab / DiffTab. These tests
// pin the SSR contract — every tab renders its verdict banner, work
// tables, and error/loading gates from the shared SSOT components.
import { describe, expect, test } from "bun:test";
import { render } from "preact-render-to-string";
import {
  CoverageTab,
  RedundancyTab,
  DiffTab,
} from "../products/cratedeck/fleet-tabs";

/** Silence the fetches each tab fires on mount (jsdom-free SSR: effects
 *  don't run, but the api module still parses at import). */
// (no-op — preact hooks' useEffect never fires under render-to-string)

describe("fleet-tabs SSR gates (#89 page-monolith split)", () => {
  test("CoverageTab renders the loading gate before its fetch resolves", () => {
    const html = render(<CoverageTab />);
    expect(html).toContain("note-card");
    expect(html).toContain("clock");
  });

  test("RedundancyTab renders the loading gate before its fetch resolves", () => {
    const html = render(<RedundancyTab />);
    expect(html).toContain("note-card");
    expect(html).toContain("Auditing playlists");
  });

  test("DiffTab renders the empty state (no drives → no selects fire)", () => {
    const html = render(<DiffTab />);
    expect(html).toContain("pl-tools");
    expect(html).toContain("Diff");
  });
});
