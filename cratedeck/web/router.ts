// hash router — zero deps. #/drives/:id/:tab drives the two-pane layout;
// the rail and canvas both read/write the same hash, so deep-linking and
// browser back/forward work for free.
import { useEffect, useState } from "preact/hooks";

export interface Route {
  driveId: string | null;
  tab: string;
}

const DEFAULT_TAB = "overview";

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "drives" && parts[1])
    return {
      driveId: decodeURIComponent(parts[1]),
      tab: parts[2] || DEFAULT_TAB,
    };
  return { driveId: null, tab: DEFAULT_TAB };
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
  navigate(parse().driveId, tab);
}
