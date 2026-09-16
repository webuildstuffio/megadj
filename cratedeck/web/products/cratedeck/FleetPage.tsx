// FleetPage.tsx — the fleet superpowers canvas (ideas.md §B6/B7/B8):
//   coverage   — which stick has this track? + the at-risk (1-copy) list
//   redundancy — per-playlist audit: every track on ≥N drives?
//   diff       — drive-vs-drive added/removed/changed
// (#89/#90 page-monolith split): the three content tabs live in
// fleet-tabs.tsx; this file is the routing shell — tab nav switches on
// the SAME PRODUCT_TABS rows the header nav renders, so a tab can't
// exist on one surface only.
import { PreflightTab } from "./PreflightTab";
import { BoothSettings } from "./BoothSettings";
import { PrepTab } from "./PrepTab";
import { ArchiveTab } from "./ArchiveTab";
import { CoverageTab, RedundancyTab, DiffTab } from "./fleet-tabs";
import { PRODUCT_TABS, ProductIntro } from "../shared";

// the fleet content tabs live in the product SSOT (ProductPage
// PRODUCT_TABS) — the header nav strip and this canvas switch on the SAME
// rows, so a tab can't exist on one surface only.
const TABS = PRODUCT_TABS.fleet;

export function FleetPage(props: { tab: string }) {
  const tab = TABS.find((t) => t.id === props.tab)?.id ?? TABS[0]!.id;

  return (
    <div class="canvas fleet">
      <ProductIntro
        product="fleet"
        sub="The master + mirror question, answered: which stick has this track, is every playlist safe if one drive dies, what changed between two drives, and are we ready for tonight."
      />
      {tab === "coverage" && <CoverageTab />}
      {tab === "redundancy" && <RedundancyTab />}
      {tab === "diff" && <DiffTab />}
      {tab === "preflight" && <PreflightTab />}
      {tab === "booth" && <BoothSettings />}
      {tab === "archive" && <ArchiveTab />}
      {tab === "prep" && <PrepTab />}
    </div>
  );
}
