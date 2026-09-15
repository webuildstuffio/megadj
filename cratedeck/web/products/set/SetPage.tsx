// SetPage.tsx — the Set product canvas (#/set).
//
// The set builder graduated from a FullTags tab to its OWN product: the
// nav strip's fourth button, same as CrateDeck/GetDat/FullTags. One
// canvas, one flow (build → review → export), so the product has a
// single tab row and the panel fills it.
import { SetBuildPanel } from "../fulltags/SetBuildPanel";
import { PRODUCT_TABS, ProductIntro } from "../shared";

const TABS = PRODUCT_TABS.set;

export function SetPage(props: { tab: string }) {
  const tab = TABS.find((t) => t.id === props.tab)?.id ?? TABS[0]!.id;
  return (
    <div class="canvas set">
      <ProductIntro
        product="set"
        sub="Turn the whole analyzed shelf into an ordered, mixable draft — tempo-gated, key-compatible, shaped by an energy arc. It proposes; nothing writes behind your back."
      />
      {tab === "build" && <SetBuildPanel />}
    </div>
  );
}
