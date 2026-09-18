// FullTagsPage.tsx — the FullTags product canvas (#/fulltags/:tab).
//
// FullTags is megadj's in-repo enrichment engine (fulltags/): tags, art,
// keys, BPM/beatgrids, mood, structure cues — analysis lives in DB
// ledgers (`beats`/`mood`/`cues`) until a write-gate passes; file stamps
// carry the passed fields. This surface renders what the engine knows:
//   Beatgrids — the beats ledger + the independent grid cross-check
//   Mood      — the mood ledger's vibe map (dance/valence/arousal/party)
//   Similar   — embedding-nearest sounds-like
//   Cues      — the 8-bar phrase-cue ledger
//   Tags      — the tag mirror: genres/years/art/energy (ground truth: files)
// (Set moved out: it's its own product now — #/set, SetPage.tsx.)
//
// (#90 page-monolith split): the content tabs live in fulltags-tabs.tsx
// (beatgrids/mood/cues), TagCompareTab.tsx (tags), and SimilarTab.tsx
// (similar); this file is the routing shell — tab nav switches on the
// SAME PRODUCT_TABS rows the header nav renders, so a tab can't exist on
// one surface only.
//
// READ-ONLY (§4-A1): analysis writes stay `megadj beats|mood|cues` CLI;
// batch BPM/genre tag writes are BLOCKED by the roadmap gates — shown.
import { PRODUCT_TABS, ProductIntro } from "../shared";
import { BeatgridsTab, MoodTab, CuesTab } from "./fulltags-tabs";
import { SimilarTab } from "./SimilarTab";
import { GenreWhyTab } from "./GenreWhyTab";
import { GenreRunTab } from "./GenreRunTab";
import { TagCompareTab } from "./TagCompareTab";

const TABS = PRODUCT_TABS.fulltags;

export function FullTagsPage(props: { tab: string }) {
  const tab = TABS.find((t) => t.id === props.tab)?.id ?? TABS[0]!.id;
  return (
    <div class="canvas fleet fulltags">
      <ProductIntro
        product="fulltags"
        sub="Analysis runs live in DB ledgers (beats, mood, cues); tags only get written when a measured gate passes. Browse what's known per track and what's still blocked."
      />
      {tab === "beatgrids" && <BeatgridsTab />}
      {tab === "run" && <GenreRunTab />}
      {tab === "mood" && <MoodTab />}
      {tab === "similar" && <SimilarTab />}
      {tab === "genre-why" && <GenreWhyTab />}
      {tab === "cues" && <CuesTab />}
      {tab === "tags" && <TagCompareTab />}
    </div>
  );
}
