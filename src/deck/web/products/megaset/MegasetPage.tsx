// MegasetPage.tsx — the Set product canvas (#/set).
//
// The set builder graduated from a FullTags tab to its OWN product: the
// nav strip's fourth button, same as CrateDeck/GetDat/FullTags. One
// canvas, one flow (build → review → export), so the product has a
// single tab row and the panel fills it.
import { MegasetPanel } from "../fulltags/MegasetPanel";
import { PRODUCT_TABS, ProductIntro } from "../shared";

const TABS = PRODUCT_TABS.megaset;

export function MegasetPage(props: { tab: string }) {
  const tab = TABS.find((t) => t.id === props.tab)?.id ?? TABS[0]!.id;
  return (
    <div class="canvas megaset">
      <ProductIntro
        product="megaset"
        sub="Shape how the room should feel from first track to last, pick a length, and the whole analyzed shelf comes back as an ordered, mixable draft — tempo-gated, key-compatible. It proposes; nothing writes behind your back."
      />
      {tab === "build" && <MegasetPanel />}
    </div>
  );
}
