// hash router — zero deps. #/drives/:id/:tab drives the two-pane layout;
// #/fleet/:tab drives the fleet superpowers (coverage/redundancy/diff).
// The rail and canvas both read/write the same hash, so deep-linking and
// browser back/forward work for free.
import { useEffect, useState } from "preact/hooks";

export interface Route {
  driveId: string | null;
  fleet: boolean;
  tab: string;
}

const DEFAULT_TAB = "overview";

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "fleet")
    return { driveId: null, fleet: true, tab: parts[1] || "coverage" };
  if (parts[0] === "drives" && parts[1])
    return {
      driveId: decodeURIComponent(parts[1]),
      fleet: false,
      tab: parts[2] || DEFAULT_TAB,
    };
  return { driveId: null, fleet: false, tab: DEFAULT_TAB };
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

export function navigate(driveId: string | null, tab?: string): void {
  const next = driveId
    ? `#/drives/${encodeURIComponent(driveId)}${tab ? `/${tab}` : ""}`
    : "#/";
  if (location.hash !== next) location.hash = next;
}

export function navigateTab(tab: string): void {
  const cur = parse();
  if (cur.fleet) navigateFleet(tab);
  else navigate(cur.driveId, tab);
}

export function navigateFleet(tab: string): void {
  const next = `#/fleet/${tab}`;
  if (location.hash !== next) location.hash = next;
}
