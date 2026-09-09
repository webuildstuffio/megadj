// hash router — zero deps. Every surface is a top-level route with an
// optional tab: #/drives/:id/:tab (drive canvas), #/fleet/:tab (fleet
// superpowers), #/getdat/:tab (download pipeline) and #/fulltags/:tab
// (enrichment engine) — one route per product, matching the topbar. The
// rail and canvas both read/write the same hash, so deep-linking and
// browser back/forward work for free.
import { useEffect, useState } from "preact/hooks";

export type Product = "drives" | "fleet" | "getdat" | "fulltags";

export interface Route {
  /** which top-level product is on the canvas */
  product: Product;
  driveId: string | null;
  fleet: boolean; // convenience alias: product === "fleet"
  tab: string;
}

const DEFAULT_TABS: Record<Product, string> = {
  drives: "overview",
  fleet: "coverage",
  // GetDat's first question: "is the download pipeline healthy?"
  getdat: "pipeline",
  // FullTags' first question: "what does the library sound like?"
  fulltags: "beatgrids",
};

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "fleet")
    return {
      product: "fleet",
      driveId: null,
      fleet: true,
      tab: parts[1] || DEFAULT_TABS.fleet,
    };
  if (parts[0] === "getdat")
    return {
      product: "getdat",
      driveId: null,
      fleet: false,
      tab: parts[1] || DEFAULT_TABS.getdat,
    };
  if (parts[0] === "fulltags")
    return {
      product: "fulltags",
      driveId: null,
      fleet: false,
      tab: parts[1] || DEFAULT_TABS.fulltags,
    };
  if (parts[0] === "drives" && parts[1])
    return {
      product: "drives",
      driveId: decodeURIComponent(parts[1]),
      fleet: false,
      tab: parts[2] || DEFAULT_TABS.drives,
    };
  return {
    product: "drives",
    driveId: null,
    fleet: false,
    tab: DEFAULT_TABS.drives,
  };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const h = () => setRoute(parse());
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  return route;
}

/** Generic product navigator: `go("fleet", "diff")` → #/fleet/diff.
 *  `drives` has its own drive-shaped navigator below (navigate) — this one
 *  is only re-exported under its product-chrome name (knip: no unused
 *  aliases). */
function go(product: Product, tab?: string): void {
  const next =
    product === "drives" ? "#/" : `#/${product}${tab ? `/${tab}` : ""}`;
  if (location.hash !== next) location.hash = next;
}

export function navigate(driveId: string | null, tab?: string): void {
  const next = driveId
    ? `#/drives/${encodeURIComponent(driveId)}${tab ? `/${tab}` : ""}`
    : "#/";
  if (location.hash !== next) location.hash = next;
}

/** Product chrome alias for go() — same function, friendlier name. Not a
 *  separate export: knip flags duplicate exports and it would drift. */
export { go as navigateProduct };
