// App.tsx — the megadj shell: suite bar (brand, search, interlock) + nav
// strip (four products + scope tabs) + drive rail + canvas. The old modal
// drawer is gone: selecting a drive swaps the main canvas and the URL hash
// (#/drives/:id/:tab), so back/forward and deep links work.
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type {
  DriveCardData,
  InterlockState,
  Job,
  PortInfo,
  ReportSummary,
  SearchResult,
} from "../../shared/types";
import { DriveRail } from "../products/cratedeck/DriveRail";
import { DrivePage } from "../products/cratedeck/DrivePage";
import { FleetPage } from "../products/cratedeck/FleetPage";
import { GetDatPage } from "../products/getdat/GetDatPage";
import { FullTagsPage } from "../products/fulltags/FullTagsPage";
import { MegasetPage } from "../products/megaset/MegasetPage";
import { JobsDock } from "../ui/JobsDock";
import { Toaster, api, toast } from "../ui/toast";
import { navigate, useRoute } from "../app/router";
import { errMessage } from "../../../src/shared/leaf/fmt";
import { Palette } from "../ui/Palette";
import { bindGlobalKeys } from "../ui/keys";
import { useJobEvents } from "./useJobEvents";
import { AppHeader, AppNav, Welcome } from "./AppChrome";

export function App() {
  const route = useRoute();
  const [drives, setDrives] = useState<DriveCardData[]>([]);
  const [interlock, setInterlock] = useState<InterlockState>({
    rekordbox_running: false,
    pid: null,
  });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [reports, setReports] = useState<Map<string, ReportSummary>>(new Map());
  const searchRef = useRef<HTMLInputElement | null>(null);
  /** last fetch in which each job id actually CHANGED shape (progress /
   *  status / message / eta). JobsDock's stall warning keys off this — a
   *  re-fetch returning an identical row must NOT reset the clock, or the
   *  warning could never fire. */
  const jobShapeAt = useRef<Map<string, { sig: string; at: number }>>(
    new Map(),
  );

  const refresh = useCallback(async () => {
    const [d, p, rep] = await Promise.all([
      api<DriveCardData[]>("/api/drives", { quiet: true }),
      api<PortInfo[]>("/api/ports", { quiet: true }),
      api<Record<string, ReportSummary>>("/api/reports", { quiet: true }),
    ]);
    setDrives(d);
    setPorts(p);
    setReports(new Map(Object.entries(rep)));
  }, []);

  // jobs: load once on boot (the old code never did — the dock stayed empty
  // until the first SSE event) and whenever the server announces changes.
  const refreshJobs = useCallback(async () => {
    const [active, all] = await Promise.all([
      api<Job[]>("/api/jobs?active=1", { quiet: true }),
      api<Job[]>("/api/jobs", { quiet: true }),
    ]);
    // merge: active rows win over stale history rows with the same id
    const byId = new Map<string, Job>(all.map((j) => [j.id, j]));
    for (const j of active) byId.set(j.id, j);
    const now = Date.now();
    setJobs(
      [...byId.values()]
        .map((j) => {
          // `_received` = when this row last CHANGED (client-side, shared
          // types). Signature covers every field the dock renders; an
          // identical re-fetch must not reset the staleness clock.
          const sig = `${j.status}|${j.progress}|${j.phase}|${j.message}|${j.eta_seconds}|${j.error}`;
          const prev = jobShapeAt.current.get(j.id);
          const at = prev && prev.sig === sig ? prev.at : now;
          jobShapeAt.current.set(j.id, { sig, at });
          return { ...j, _received: at };
        })
        .toSorted(
          (a, b) =>
            (b.started_at ?? b.created_at) - (a.started_at ?? a.created_at),
        ),
    );
  }, []);

  const refreshInterlock = useCallback(
    () => api<InterlockState>("/api/interlock", { quiet: true }),
    [],
  );
  const reportDrivesError = useCallback((error: unknown) => {
    console.error("drive list refresh failed", error);
    toast(`drive list unavailable: ${errMessage(error)}`, "err");
  }, []);
  const reportJobsError = useCallback((error: unknown) => {
    toast(`jobs unavailable: ${errMessage(error)}`, "err");
  }, []);

  useJobEvents({
    refreshDrives: refresh,
    refreshJobs,
    refreshInterlock,
    reportDrivesError,
    reportJobsError,
    setInterlock,
  });

  useEffect(() => {
    // keyboard map lives in ui/keys.ts (tinykeys) — ⌘K opens the command
    // palette, the header search keeps its own Escape-to-blur below.
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        document.activeElement === searchRef.current
      ) {
        (document.activeElement as HTMLElement).blur();
      }
    };
    window.addEventListener("keydown", onKey);
    const unbindKeys = bindGlobalKeys({
      openPalette: () => setPaletteOpen(true),
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      unbindKeys();
    };
  }, []);

  // debounce search; empty query closes the dropdown
  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api<SearchResult[]>(
          `/api/search?q=${encodeURIComponent(query.trim())}`,
          { quiet: true },
        );
        setResults(r);
      } catch (e) {
        console.error("search failed", e);
        toast("search failed — server unreachable", "err");
      }
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  // refresh drive cards when the last job finishes so badges update live
  useEffect(() => {
    const wasActive = jobs.some(
      (j) => j.status === "running" || j.status === "queued",
    );
    if (jobs.length && !wasActive)
      refresh().catch((error: unknown) => {
        // every other refresh() caller routes through useJobEvents'
        // try/catch → throttled toast; this late effect was the one bare
        // caller — an unhandled rejection instead of the family contract
        console.error("drive list refresh failed", error);
        toast(`drive list unavailable: ${errMessage(error)}`, "err");
      });
  }, [jobs, refresh]);

  useEffect(() => {
    const h = () => {
      if (
        !document
          .getElementById("global-search")
          ?.contains(document.activeElement)
      )
        setQuery("");
    };
    window.addEventListener("click", h);
    return () => window.removeEventListener("click", h);
  }, []);

  // tab title mirrors the route: with many deep-linkable tabs open at once,
  // identical titles make browser history/tab switchers unusable. Route
  // words only (no per-drive fetches) — cheap and instant. Brand line is
  // "megadj" (the suite); CrateDeck is the drives/fleet product.
  useEffect(() => {
    const tab = route.tab.charAt(0).toUpperCase() + route.tab.slice(1);
    const scope =
      route.product === "fleet"
        ? `Fleet · ${tab}`
        : route.product === "getdat"
          ? `GetDat · ${tab}`
          : route.product === "fulltags"
            ? `FullTags · ${tab}`
            : route.driveId
              ? `${decodeURIComponent(route.driveId)} · ${tab}`
              : "CrateDeck · DJ USB library";
    document.title = `${scope} — megadj`;
  }, [route.driveId, route.product, route.tab]);

  const openDrive = (id: string, tab?: string) => {
    setQuery("");
    setResults(null);
    navigate(id, tab);
  };

  const locked = interlock.rekordbox_running;
  const globalSearchInput = (
    <input
      ref={searchRef}
      id="global-search"
      name="global-search"
      aria-label="Search every drive's playlists, folders and tracks"
      placeholder="Search playlists, folders…"
      title="Search every drive's playlists, folders and tracks — Enter opens the top hit, Esc clears. ⌘K opens the command palette (navigate anywhere)."
      value={query}
      onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
      onKeyDown={(event) => {
        const first = results?.[0];
        if (event.key === "Enter" && first) openDrive(first.drive_id);
      }}
    />
  );

  return (
    <div class="app" data-prod={route.product}>
      <AppHeader
        drives={drives}
        interlock={interlock}
        query={query}
        results={results}
        searchRef={searchRef}
        searchInput={globalSearchInput}
        setQuery={setQuery}
        openDrive={openDrive}
        openPalette={() => setPaletteOpen(true)}
      />
      <AppNav route={route} />

      <div class="frame">
        <DriveRail
          drives={drives}
          reports={reports}
          selectedId={route.driveId}
          onSelect={(id) => openDrive(id)}
          ports={ports}
        />
        <main
          class="canvas-wrap"
          style={{ flex: 1, minWidth: 0, display: "flex" }}
        >
          {route.product === "fleet" ? (
            <FleetPage key="fleet" tab={route.tab} />
          ) : route.product === "getdat" ? (
            <GetDatPage key="getdat" tab={route.tab} />
          ) : route.product === "megaset" ? (
            <MegasetPage key="megaset" tab={route.tab} />
          ) : route.product === "fulltags" ? (
            <FullTagsPage key="fulltags" tab={route.tab} />
          ) : route.product === "drives" && route.driveId ? (
            <DrivePage
              key={route.driveId}
              driveId={route.driveId}
              tab={route.tab}
              interlock={interlock}
            />
          ) : (
            <Welcome drives={drives} locked={locked} onPick={openDrive} />
          )}
        </main>
      </div>

      <JobsDock
        jobs={jobs}
        drives={drives}
        focusDrive={(id) => openDrive(id)}
      />
      <Toaster />
      {paletteOpen && (
        <Palette drives={drives} onClose={() => setPaletteOpen(false)} />
      )}
    </div>
  );
}

/** Suite-wide status, search, and USB-link warning chrome. */
