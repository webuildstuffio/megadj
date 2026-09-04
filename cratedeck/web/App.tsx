import { useEffect, useState } from "preact/hooks";
import type {
  DriveCardData,
  InterlockState,
  Job,
  PortInfo,
  SearchResult,
} from "../shared/types";
import { DriveCard } from "./DriveCard";
import { DriveDrawer } from "./DriveDrawer";

export function App() {
  const [drives, setDrives] = useState<DriveCardData[]>([]);
  const [interlock, setInterlock] = useState<InterlockState>({
    rekordbox_running: false,
    pid: null,
  });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [ports, setPorts] = useState<PortInfo[]>([]);

  const refresh = async () => {
    const [d, p] = await Promise.all([
      fetch("/api/drives").then((r) => r.json()),
      fetch("/api/ports").then((r) => r.json()),
    ]);
    setDrives(d);
    setPorts(p);
  };

  useEffect(() => {
    refresh();
    const es = new EventSource("/api/events");
    es.addEventListener("drives", () => refresh());
    es.addEventListener("interlock", (e) =>
      setInterlock(JSON.parse((e as MessageEvent).data)),
    );
    es.addEventListener("job", async () => {
      const active = await fetch("/api/jobs?active=1").then((r) => r.json());
      setJobs(active);
    });
    const interlockPoll = setInterval(async () => {
      const s = await fetch("/api/interlock").then((r) => r.json());
      setInterlock(s);
    }, 3000);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      es.close();
      clearInterval(interlockPoll);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // debounce search
  useEffect(() => {
    if (!query) {
      setResults(null);
      return;
    }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(query)}`).then(
        (x) => x.json(),
      );
      setResults(r);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // refresh drives when a job finishes so cards update without a manual reload
  useEffect(() => {
    const active = jobs.some(
      (j) => j.status === "running" || j.status === "queued",
    );
    if (!active) refresh();
  }, [jobs]);

  const open = drives.find((d) => d.id === openId) ?? null;
  const mounted = drives.filter((d) => d.mounted);
  const ghosts = drives.filter((d) => !d.mounted);

  return (
    <div class="app">
      {open && <div class="backdrop" onClick={() => setOpenId(null)} />}
      <div class="topbar">
        <h1>CrateDeck</h1>
        <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
          {mounted.length} mounted · {ghosts.length} ghost
          {ghosts.length === 1 ? "" : "s"}
        </span>
        <div class="spacer" />
        <div class="search" style={{ position: "relative" }}>
          <input
            placeholder="Search playlists, folders, drives…  (⌘K)"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            id="global-search"
          />
          {results && (
            <div class="search-results">
              {results.length === 0 && (
                <div class="sr-drive" style={{ color: "var(--muted)" }}>
                  No matches in any crate.
                </div>
              )}
              {results.map((r) => (
                <div
                  key={r.drive_id}
                  class="sr-drive"
                  onClick={() => {
                    setOpenId(r.drive_id);
                    setQuery("");
                  }}
                >
                  <div class="hd">
                    <span class={"dot " + (r.mounted ? "on" : "off")} />
                    {r.drive_name}
                    {!r.mounted && (
                      <span style={{ color: "var(--muted)", fontSize: 11 }}>
                        · ghost
                      </span>
                    )}
                  </div>
                  {r.matches.map((m) => (
                    <div class="sr-match" key={m.type + ":" + m.name}>
                      <span>{m.name}</span>
                      <span>{m.entries ?? ""}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {interlock.rekordbox_running ? (
        <div class="banner">
          rekordbox is running (pid {interlock.pid}) — all drive operations
          locked. Hands off until it quits.
        </div>
      ) : (
        <div class="banner ok">
          All clear — rekordbox not running, drives writable by jobs.
        </div>
      )}

      {ports.length > 0 && (
        <div class="portstrip">
          {ports.map((p) => (
            <span class="port" key={p.port_key}>
              <span class={"dot " + (p.mounted ? "on" : "off")} />
              <b>{p.drive_name}</b>
              {!p.mounted && <span class="port-last">last</span>}
            </span>
          ))}
        </div>
      )}

      <h3 class="sect">Crate shelf</h3>
      <div class="shelf">
        {drives.map((d) => (
          <DriveCard key={d.id} drive={d} onOpen={() => setOpenId(d.id)} />
        ))}
        {drives.length === 0 && (
          <div style={{ color: "var(--muted)" }}>
            No drives known yet — plug one in, it will appear here and stay
            forever.
          </div>
        )}
      </div>

      {open && (
        <DriveDrawer
          drive={open}
          interlock={interlock}
          onClose={() => setOpenId(null)}
        />
      )}

      {jobs.filter((j) => j.status === "running" || j.status === "queued")
        .length > 0 && (
        <div class="jobtray">
          {jobs
            .filter((j) => j.status === "running" || j.status === "queued")
            .map((j) => (
              <span class="jobchip" key={j.id}>
                <span class="spin">◌</span> {j.kind} ·{" "}
                {drives.find((d) => d.id === j.drive_id)?.nickname ??
                  drives.find((d) => d.id === j.drive_id)?.name}
                {j.status === "running" && (
                  <span class="progressbar">
                    <i style={{ width: `${Math.round(j.progress * 100)}%` }} />
                  </span>
                )}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
