// GetDatPage.tsx — the GetDat product canvas (#/getdat/:tab).
//
// GetDat is megadj's download + ingest half (docs/FEATURES.md): YouTube
// Music → the local archive. This surface answers, in order:
//   Pipeline — is the download machine healthy? (status buckets + runs)
//   Backlog  — what needs work? (failed/gone retries, LOWQ upgrades)
//   Sources  — where did the music come from, and do sources diverge?
//   Library  — what's actually in the archive? (LibraryTab.tsx, extracted)
//
// (#90 page-monolith split): the content tabs live in getdat-tabs.tsx
// (pipeline/backlog/sources), IntakeTab.tsx, and LibraryTab.tsx; this
// file is the routing shell — tab nav switches on the SAME PRODUCT_TABS
// rows the header nav renders, so a tab can't exist on one surface only.
//
// READ-ONLY (§4-A1): this page describes work, it never writes — every
// card names the megadj command that does the fixing.
import { PRODUCT_TABS, ProductIntro } from "../shared";
import { BacklogTab, PipelineTab, SourcesTab } from "./getdat-tabs";
import { LibraryTab } from "./LibraryTab";
import { IntakeTab } from "./IntakeTab";

// the GetDat tab strip lives in the product SSOT (PRODUCT_TABS) — header
// nav strip and this canvas switch on the SAME rows.
const TABS = PRODUCT_TABS.getdat;

export function GetDatPage(props: { tab: string }) {
  const tab = TABS.find((t) => t.id === props.tab)?.id ?? TABS[0]!.id;
  return (
    <div class="canvas fleet getdat">
      <ProductIntro
        product="getdat"
        sub="Every download decision, recorded: what's in the archive, what failed and can be retried, where music comes from, and what's on disk right now."
      />
      {tab === "pipeline" && <PipelineTab />}
      {tab === "backlog" && <BacklogTab />}
      {tab === "sources" && <SourcesTab />}
      {tab === "intake" && <IntakeTab />}
      {tab === "library" && <LibraryTab />}
    </div>
  );
}
