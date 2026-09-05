// App.tsx — shell: topbar (brand, search, interlock) + drive rail + canvas.
// The old modal drawer is gone: selecting a drive swaps the main canvas and
// the URL hash (#/drives/:id/:tab), so back/forward and deep links work.
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type {
  DriveCardData,
  InterlockState,
  Job,
  PortInfo,
  SearchResult,
} from "../shared/types";
import { DriveRail } from "./DriveRail";
import { DrivePage } from "./DrivePage";
import { FleetPage } from "./FleetPage";
import { JobsDock } from "./JobsDock";
import { Toaster } from "./toast";
import { Icon } from "./icons";
import { navigate, navigateFleet, useRoute } from "./router";

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
  const [reports, setReports] = useState<
    Map<string, { overall?: string; pass_rate?: number }>
  >(new Map());
  const searchRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    const [d, p, rep] = await Promise.all([
      fetch("/api/drives").then((r) => r.json() as Promise<DriveCardData[]>),
      fetch("/api/ports").then((r) => r.json() as Promise<PortInfo[]>),
      fetch("/api/reports")
        .then(
          (r) =>
            r.json() as Promise<
              Record<string, { overall?: string; checks: { status: string }[] }>
            >,
        )
        .catch(
          () =>
            ({}) as Record<
              string,
              { overall?: string; checks: { status: string }[] }
            >,
        ),
    ]);
    setDrives(d);
    setPorts(p);
    setReports(new Map(Object.entries(rep)));
  }, []);

  // jobs: load once on boot (the old code never did — the dock stayed empty
  // until the first SSE event) and whenever the server announces changes.
  const refreshJobs = useCallback(async () => {
    try {
      const [active, all] = await Promise.all([
        fetch("/api/jobs?active=1").then((r) => r.json() as Promise<Job[]>),
        fetch("/api/jobs").then((r) => r.json() as Promise<Job[]>),
      ]);
      // merge: active rows win over stale history rows with the same id
      const byId = new Map<string, Job>(all.map((j) => [j.id, j]));
      for (const j of active) byId.set(j.id, j);
      setJobs(
        [...byId.values()].sort(
          (a, b) =>
            (b.started_at ?? b.created_at) - (a.started_at ?? a.created_at),
        ),
      );
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    refreshJobs();
    const es = new EventSource("/api/events");
    es.addEventListener("drives", () => refresh());
    es.addEventListener("interlock", (ev) => {
      try {
        const data: unknown = JSON.parse(
          (ev as MessageEvent<string>).data ?? "null",
        );
        if (
          data &&
          typeof data === "object" &&
          typeof (data as { rekordbox_running?: unknown }).rekordbox_running ===
            "boolean"
        ) {
          setInterlock(data as InterlockState);
        }
      } catch {}
    });
    es.addEventListener("job", () => {
      refreshJobs();
      window.dispatchEvent(new CustomEvent("cratedeck:job"));
    });
    // SSE can silently die (proxy idle timeout, sleep/wake). EventSource
    // auto-reconnects, but any job event that fired while dead is gone —
    // so re-sync on every reconnect.
    es.addEventListener("open", () => {
      refreshJobs();
    });
    const interlockPoll = setInterval(async () => {
      try {
        const s = await fetch("/api/interlock").then(
          (r) => r.json() as Promise<InterlockState>,
        );
        setInterlock(s);
      } catch {}
    }, 3000);
    // rail safety net: SSE drives events only fire on mount/unmount/first-seen,
    // so renames (and similar in-place changes) would never refresh the rail.
    const drivesPoll = setInterval(refresh, 10_000);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (e.key === "Escape" && document.activeElement === searchRef.current) {
        (document.activeElement as HTMLElement).blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      es.close();
      clearInterval(interlockPoll);
      clearInterval(drivesPoll);
      window.removeEventListener("keydown", onKey);
    };
  }, [refresh, refreshJobs]);

  // debounce search; empty query closes the dropdown
  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}`,
        ).then((x) => x.json() as Promise<SearchResult[]>);
        setResults(r);
      } catch {}
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  // refresh drive cards when the last job finishes so badges update live
  useEffect(() => {
    const wasActive = jobs.some(
      (j) => j.status === "running" || j.status === "queued",
    );
    if (jobs.length && !wasActive) refresh();
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

  const openDrive = (id: string, tab?: string) => {
    setQuery("");
    setResults(null);
    navigate(id, tab);
  };

  const locked = interlock.rekordbox_running;
  const mounted = drives.filter((d) => d.mounted).length;
  const ghosts = drives.length - mounted;

  return (
    <div class="app">
      <header class="topbar">
        <div class="brand" onClick={() => navigate(null)} title="CrateDeck">
          <span class="brand-mark" />
          <h1>CrateDeck</h1>
        </div>
        <span class="top-meta">
          <b>{mounted}</b> mounted · <b>{ghosts}</b> ghost
          {ghosts === 1 ? "" : "s"}
        </span>
        <div class="spacer" />
        <button
          type="button"
          class={`fleetchip ${route.fleet ? "on" : ""}`}
          onClick={() => navigateFleet("coverage")}
          title="Fleet: coverage matrix, redundancy audit, drive diffs"
        >
          <Icon name="grid" size={13} /> Fleet
        </button>
        <span
          class={`lockchip ${locked ? "on" : "off"}`}
          title={
            locked
              ? "rekordbox is running — all drive jobs are refused"
              : "rekordbox not running — jobs allowed"
          }
        >
          <span class="lockdot" />
          {locked ? `rekordbox · pid ${interlock.pid}` : "ready"}
        </span>
        <div class="search">
          <span class="search-ico">
            <Icon name="search" size={15} />
          </span>
          <input
            ref={searchRef}
            id="global-search"
            placeholder="Search playlists, folders…"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              const first = results?.[0];
              if (e.key === "Enter" && first) openDrive(first.drive_id);
            }}
          />
          {query && (
            <button
              type="button"
              class="search-clear"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <Icon name="x" size={13} />
            </button>
          )}
          {results && (
            <div class="search-results">
              {results.length === 0 && (
                <div class="sr-empty">No matches in any crate.</div>
              )}
              {results.map((r) => (
                <div
                  key={r.drive_id}
                  class="sr-drive"
                  onClick={() => openDrive(r.drive_id)}
                >
                  <div class="hd">
                    <span class={"dot " + (r.mounted ? "on" : "off")} />
                    {r.drive_name}
                    {!r.mounted && <span class="ghost-tag">ghost</span>}
                  </div>
                  {r.matches.map((m) => (
                    <div class="sr-match" key={m.type + ":" + m.name}>
                      <span>
                        <span class="sr-type">{m.type}</span> {m.name}
                      </span>
                      <span>{m.entries ?? ""}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </header>

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
          {route.fleet ? (
            <FleetPage key="fleet" tab={route.tab} />
          ) : route.driveId ? (
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
    </div>
  );
}

function Welcome(props: {
  drives: DriveCardData[];
  locked: boolean;
  onPick: (id: string) => void;
}) {
  const failing = props.drives.filter((d) =>
    d.badges.some((b) => b.tone === "bad"),
  );
  return (
    <div class="canvas">
      <div class="welcome">
        <div class="bigicon">
          <Icon name="disc" size={44} />
        </div>
        <h2>Your crate shelf</h2>
        {props.drives.length === 0 ? (
          <p>
            Plug in a DJ USB drive — it appears on the rail and stays forever,
            even after unmounting.
          </p>
        ) : (
          <p>
            Pick a drive from the rail to see its health verdict, playlists,
            benchmarks and history. Everything stays deep-linkable.
          </p>
        )}
        {failing.length > 0 && (
          <div class="note bad" style={{ justifyContent: "center" }}>
            <Icon name="warn" size={14} />
            {failing.length} drive{failing.length > 1 ? "s" : ""} flagged —
            start with {failing[0]!.nickname ?? failing[0]!.name}.
            <button
              type="button"
              class="btn sm"
              onClick={() => props.onPick(failing[0]!.id)}
            >
              Open
            </button>
          </div>
        )}
        {props.locked && (
          <div class="note bad" style={{ justifyContent: "center" }}>
            <Icon name="warn" size={14} /> rekordbox is running — jobs are
            locked until it quits.
          </div>
        )}
      </div>
    </div>
  );
}
