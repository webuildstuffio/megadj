// products-shared-split.test.tsx — pins the #89/#90 page-skeleton split
// of products/shared.tsx: the three extracted families (product-meta,
// scan-apply, beat-sync) keep rendering identically, and the split
// modules stay the canonical homes (a family copied BACK into
// shared.tsx is the regression this catches). family-level imports go
// through shared.tsx (the consumer seam); helpers knip keeps unexported
// import from their owning module.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "preact-render-to-string";
import { ArchiveAbsentGate, Meter, collectBreakers } from "../products/shared";
import { gridDeltaPct, mkBreaker, beatSyncCopy } from "../products/beat-sync";
import { ProductIntro } from "../products/product-meta";
import { ScanApplyActions } from "../products/scan-apply";

const read = (p: string): string =>
  readFileSync(join(import.meta.dir, "..", p), "utf8");
const sharedSource = read("products/shared.tsx");
const productMetaSource = read("products/product-meta.tsx");

describe("products/shared split (#89 item 2)", () => {
  test("shared.tsx is the re-export seam, not a second copy of the families", () => {
    // the re-exports exist…
    expect(sharedSource).toContain('from "./product-meta"');
    expect(sharedSource).toContain('from "./scan-apply"');
    expect(sharedSource).toContain('from "./beat-sync"');
    // …and the families are NOT re-inlined (a copy back = drift twin).
    expect(sharedSource).not.toContain("export const PRODUCTS");
    expect(sharedSource).not.toContain("export function useScanApply");
    expect(sharedSource).not.toContain("export function BeatSyncBreakersCard");
    // the SSOT table text still reads through the seam
    expect(productMetaSource).toContain('id: "megaset"');
    expect(productMetaSource).toContain("the library gets played");
    expect(productMetaSource).toContain("the drives stay honest");
  });

  test("ProductIntro renders the phase chip + product voice", () => {
    const html = render(
      <ProductIntro
        product="getdat"
        sub="the download pipeline — archive what's playable"
      />,
    );
    expect(html).toContain("pintro");
    expect(html).toContain("GetDat");
    expect(html).toContain("the archive gets filled");
  });

  test("ScanApplyActions busy-aware pair renders both buttons", () => {
    const html = render(
      <ScanApplyActions
        busy={null}
        applyDisabled={false}
        scanTitle="scan"
        applyTitle="apply"
        applyLabel={() => "Apply fixes"}
        onScan={() => {}}
        onApply={() => {}}
      />,
    );
    expect(html).toContain("Scan shelf");
    expect(html).toContain("Apply fixes");
  });

  test("breaker cluster math + copy survive the move", () => {
    expect(gridDeltaPct(120, 125)).toBe(4);
    expect(gridDeltaPct(120, 0)).toBe(0);
    const b = mkBreaker(
      {
        video_id: "v1",
        title: "T",
        ledgerBpm: 120,
        rbBpm: 125,
        driftMs: 30,
      },
      "drift",
    );
    expect(b.cls).toBe("drift");
    expect(b.deltaPct).toBe(4);
    expect(b.videoId).toBe("v1");
    expect(collectBreakers(null)).toEqual([]);
    expect(
      collectBreakers({ available: false, octave: [], drift: [], off: [] }),
    ).toEqual([]);
    const rows = collectBreakers({
      available: true,
      octave: [
        { video_id: "a", title: "A", ledgerBpm: 60, rbBpm: 120, driftMs: 0 },
      ],
      drift: [
        {
          video_id: "v1",
          title: "T",
          ledgerBpm: 120,
          rbBpm: 125,
          driftMs: 30,
        },
      ],
      off: [],
    });
    // severity order: octave first, then drift
    expect(rows.map((r) => r.cls)).toEqual(["octave", "drift"]);
    expect(beatSyncCopy(rows)[0]).toContain("(OCTAVE)");
    expect(beatSyncCopy(rows)[1]).toContain("drift 30 ms");
  });

  test("remaining shared primitives still render (ArchiveAbsentGate, Meter)", () => {
    expect(render(<ArchiveAbsentGate />)).toContain("archive DB absent");
    const html = render(<Meter done={3} total={4} label="analyzed" />);
    expect(html).toContain("75%");
    expect(html).toContain("analyzed");
  });
});
