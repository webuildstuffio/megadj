// App.tsx — shell: topbar (brand, search, interlock) + drive rail + canvas.
// The old modal drawer is gone: selecting a drive swaps the main canvas and
// the URL hash (#/drives/:id/:tab), so back/forward and deep links work.
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type {
  DriveCardData,
  InterlockState,
  Job,
  OverallHealth,
  PortInfo,
  SearchResult,
} from "../shared/types";
import { DriveRail } from "./DriveRail";
import { DrivePage } from "./DrivePage";
import { FleetPage } from "./FleetPage";
import { GetDatPage } from "./GetDatPage";
import { FullTagsPage } from "./FullTagsPage";
import { PRODUCT_TABS, PRODUCTS } from "./ProductPage";
import { JobsDock } from "./JobsDock";
import { Toaster, api, toast } from "./toast";
import { Icon } from "./icons";
import { navigate, navigateProduct, useRoute } from "./router";
import { errMessage } from "../shared/fmt";
import { Onboard } from "./Onboard";

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
    Map<string, { overall?: OverallHealth; pass_rate?: number }>
  >(new Map());
  const searchRef = useRef<HTMLInputElement | null>(null);
  /** coalesces SSE `job` bursts into ≤1 jobs refresh per second (see below) */
  const jobRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      api<
        Record<
          string,
          { overall?: OverallHealth; checks: { status: string }[] }
        >
      >("/api/reports", { quiet: true }),
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
          .sort(
            (a, b) =>
              (b.started_at ?? b.created_at) - (a.started_at ?? a.created_at),
          ),
      );
    } catch (e) {
      console.error("jobs refresh failed", e);
      toast(`jobs unavailable: ${errMessage(e)}`, "err");
    }
  }, []);

  useEffect(() => {
    refresh().catch((e: unknown) => {
      console.error("drive list refresh failed", e);
      toast(`drive list unavailable: ${errMessage(e)}`, "err");
    });
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
        } else {
          console.error("interlock SSE payload failed shape check", data);
        }
      } catch (e) {
        console.error("interlock SSE event was not valid JSON", e);
      }
    });
    es.addEventListener("job", () => {
      // the server emits `job` up to ~4/s per running job (progress ticks +
      // log lines); a fetch each would hammer the server + SQLite. Coalesce
      // bursts into one refresh per second (the trailing call wins).
      if (jobRefreshTimer.current) return;
      jobRefreshTimer.current = setTimeout(() => {
        jobRefreshTimer.current = null;
        refreshJobs();
      }, 1000);
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
        const s = await api<InterlockState>("/api/interlock", { quiet: true });
        setInterlock(s);
      } catch {
        // interlock poll is advisory (the SSE stream + server gate are the
        // enforcement); transient fetch failures stay silent by design.
      }
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
      if (jobRefreshTimer.current) clearTimeout(jobRefreshTimer.current);
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
  const mounted = drives.filter((d) => d.mounted).length;
  const ghosts = drives.length - mounted;

  // The header is two rows. Row 1 (suite bar): megadj brand, global search,
  // interlock — everything that spans the whole suite. Row 2 (nav strip):
  // the three products + the active one's scope tabs. Fleet is a scope of
  // CrateDeck, not a fourth product: on the Fleet route the strip shows
  // Drives | Fleet (Fleet lit) followed by Fleet's own content tabs.
  const scopeTabs =
    route.product === "fleet"
      ? [...PRODUCT_TABS.drives, ...PRODUCT_TABS.fleet]
      : PRODUCT_TABS[route.product];
  const scopeOn =
    route.product === "drives"
      ? route.fleet
        ? "fleet"
        : "" // shelf, or a specific drive — the shelf tab stays lit
      : route.tab;

  return (
    <div class="app" data-prod={route.product}>
      <header class="topbar">
        <div
          class="brand"
          onClick={() => navigate(null)}
          title="megadj — one toolkit for the DJ library"
        >
          <span class="brand-mark" />
          <h1>megadj</h1>
        </div>
        <span
          class="top-meta"
          title="How many known drives are mounted now vs remembered-but-unplugged ('ghosts')."
        >
          <b>{mounted}</b> mounted · <b>{ghosts}</b> ghost
          {ghosts === 1 ? "" : "s"}
        </span>
        <div class="spacer" />
        <span
          class={`lockchip ${locked ? "on" : "off"}`}
          title={
            locked
              ? `rekordbox is running (pid ${interlock.pid}) — the interlock refuses ALL drive jobs because rekordbox locks the same databases. Quit rekordbox to unlock.`
              : "rekordbox is not running — the interlock allows drive jobs."
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
            title="Search every drive's playlists, folders and tracks — ⌘K focuses, Enter opens the top hit, Esc clears"
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
                      <span>{m.entries?.toLocaleString() ?? "—"}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </header>
      <nav class="navstrip" aria-label="Products">
        {PRODUCTS.map((p) => (
          <button
            type="button"
            key={p.id}
            // Fleet is CrateDeck's scope — the CrateDeck tab stays lit there
            class={`product-tab ${
              route.product === p.id ||
              (p.id === "drives" && route.product === "fleet")
                ? "on"
                : ""
            }`}
            data-prod={p.id}
            onClick={() =>
              route.product !== p.id &&
              (p.id === "drives" ? navigate(null) : navigateProduct(p.id))
            }
            title={p.title}
          >
            <Icon name={p.icon} size={13} /> {p.label}
          </button>
        ))}
        <span class="navstrip-sep" aria-hidden />
        {scopeTabs.map((t) => {
          // on-state: the fleet scope tab stays lit across all fleet content
          // tabs (coverage/redundancy/…) so CrateDeck's scope never dims
          const on =
            t.id === "fleet" && route.product === "fleet"
              ? true
              : scopeOn === t.id;
          const onClick = () => {
            if (route.product === "drives") {
              // CrateDeck scopes: shelf ↔ fleet
              if (t.id === "fleet") navigateProduct("fleet");
              else if (route.fleet) navigate(null);
            } else if (route.product === "fleet") {
              // "fleet" scope row → back to the shelf; others → content tab
              if (t.id === "fleet") navigate(null);
              else if (route.tab !== t.id) navigateProduct("fleet", t.id);
            } else if (route.tab !== t.id) {
              navigateProduct(route.product, t.id);
            }
          };
          return (
            <button
              type="button"
              key={`${route.product}:${t.id || "shelf"}`}
              class={`scope-tab ${on ? "on" : ""}`}
              data-prod={route.product}
              onClick={onClick}
              title={t.title}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

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
          ) : route.product === "fulltags" ? (
            <FullTagsPage key="fulltags" tab={route.tab} />
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
            Plug in a DJ USB drive. It appears on the rail and stays after
            unmounting.
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
      <Onboard />
    </div>
  );
}
