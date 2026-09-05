// FleetPage.tsx — the fleet superpowers canvas (ideas.md §B6/B7/B8):
//   coverage   — which stick has this track? + the at-risk (1-copy) list
//   redundancy — per-playlist audit: every track on ≥N drives?
//   diff       — drive-vs-drive added/removed/changed
// All server-rendered from fleet tables; this page is pure presentation.
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type {
  CoverageResult,
  RedundancyResult,
  FleetDiff,
} from "../shared/types";
import { fmtBytes } from "../shared/fmt";
import { api, toast } from "./toast";
import { Icon } from "./icons";
import { navigateFleet } from "./router";

const TABS = [
  { id: "coverage", label: "Coverage", icon: "grid" },
  { id: "redundancy", label: "Redundancy", icon: "shield" },
  { id: "diff", label: "Diff", icon: "sort" },
] as const;

type DriveRef = { id: string; name: string; mounted?: boolean };

interface TrackHit {
  identity: { path: string; title: string | null; artist: string | null } | null;
  drives: DriveRef[];
}

export function FleetPage(props: { tab: string }) {
  const tab = (
    TABS.some((t) => t.id === props.tab) ? props.tab : "coverage"
  ) as (typeof TABS)[number]["id"];

  return (
    <div class="canvas fleet">
      <div class="fleet-head">
        <h2>
          <Icon name="grid" size={18} /> Fleet
        </h2>
        <span class="fleet-sub">
          every drive, cross-checked — who has what, and what dies with a
          drive
        </span>
        <div class="spacer" />
        <div class="tabs inline">
          {TABS.map((t) => (
            <button
              type="button"
              key={t.id}
              class={tab === t.id ? "on" : ""}
              onClick={() => navigateFleet(t.id)}
            >
              <Icon name={t.icon} size={14} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "coverage" && <CoverageTab />}
      {tab === "redundancy" && <RedundancyTab />}
      {tab === "diff" && <DiffTab />}
    </div>
  );
}

// ---- coverage ---------------------------------------------------------------

function CoverageTab() {
  const [data, setData] = useState<CoverageResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState<TrackHit | null>(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<CoverageResult>("/api/fleet/coverage"));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const lookup = useCallback(
    async (q: string) => {
      setSearching(true);
      try {
        const r = await api<TrackHit>(
          `/api/fleet/track?q=${encodeURIComponent(q)}`,
        );
        setHit(r);
        if (!r.drives.length) toast("Not found on any scanned drive", "info");
      } catch {
      } finally {
        setSearching(false);
      }
    },
    [],
  );

  if (err)
    return (
      <div class="note bad">
        <Icon name="warn" size={14} /> {err}
      </div>
    );
  if (!data)
    return (
      <div class="note-card">
        <Icon name="clock" size={20} /> Loading fleet inventory…
      </div>
    );

  const shown = data.at_risk.slice(0, 200);

  return (
    <div>
      <div class="statgrid">
        <div class="stat">
          <div class="v">
            <Icon name="disc" size={13} /> {data.totals.unique_tracks.toLocaleString()}
          </div>
          <div class="l">unique tracks across the fleet</div>
        </div>
        <div class="stat">
          <div class="v">
            <Icon name="check" size={13} /> {data.totals.fully_redundant.toLocaleString()}
          </div>
          <div class="l">on ≥{data.min_copies} drives (safe)</div>
        </div>
        <div class={`stat ${data.at_risk.length ? "bad" : ""}`}>
          <div class="v">
            <Icon name="warn" size={13} /> {data.at_risk.length.toLocaleString()}
          </div>
          <div class="l">
            single-drive tracks — gone if that drive dies
          </div>
        </div>
        <div class="stat">
          <div class="v">
            <Icon name="usb" size={13} /> {data.drives.length}
          </div>
          <div class="l">drives with a track inventory</div>
        </div>
      </div>

      <div class="pl-tools">
        <input
          placeholder="Find a track across every crate (title, artist, or path)…"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim()) lookup(query.trim());
          }}
        />
        <button
          type="button"
          class="btn"
          disabled={!query.trim() || searching}
          onClick={() => lookup(query.trim())}
        >
          <Icon name="search" size={14} /> Where is it?
        </button>
        {hit && (
          <button
            type="button"
            class="btn ghostbtn"
            onClick={() => setHit(null)}
          >
            <Icon name="x" size={13} /> Clear
          </button>
        )}
      </div>

      {hit && (
        <div class={`note ${hit.drives.length > 1 ? "ok" : "bad"}`}>
          <Icon name={hit.drives.length > 1 ? "check" : "warn"} size={14} />
          <span>
            <b>{hit.identity?.title ?? hit.identity?.path}</b>
            {hit.identity?.artist ? ` — ${hit.identity.artist}` : ""}: on{" "}
            {hit.drives.length} drive{hit.drives.length === 1 ? "" : "s"} (
            {hit.drives.map((d) => d.name).join(", ")})
          </span>
        </div>
      )}

      {data.drives.length === 0 ? (
        <div class="note-card">
          <Icon name="scan" size={20} />
          No track inventories yet — run a Scan on a mounted rekordbox drive,
          then come back.
        </div>
      ) : (
        <>
          <h3 class="sect">
            <Icon name="warn" /> At-risk tracks
            <span class="sect-n">{data.at_risk.length}</span>
          </h3>
          <div class="fleet-note">
            On fewer than {data.min_copies} drives. The fix is the ordinary
            mirror: sync the master's new music to the mirror.
          </div>
          {shown.length === 0 ? (
            <div class="note ok">
              <Icon name="check" size={14} /> Every track lives on ≥
              {data.min_copies} drives. This is the whole point of the mirror.
            </div>
          ) : (
            <div class="covtable">
              <div class="covrow head">
                <span>track</span>
                <span>copies</span>
                <span>on drives</span>
              </div>
              {shown.map((r) => (
                <div class="covrow" key={r.identity.path}>
                  <span class="covpath" title={r.identity.path}>
                    <b>{r.identity.title ?? r.identity.path}</b>
                    {r.identity.artist && (
                      <span class="covartist"> — {r.identity.artist}</span>
                    )}
                  </span>
                  <span class={`n ${r.copies <= 1 ? "bad" : ""}`}>
                    {r.copies}
                  </span>
                  <span class="covdrives">{r.drives.join(", ")}</span>
                </div>
              ))}
              {data.at_risk.length > shown.length && (
                <div class="fleet-note">
                  showing {shown.length} of {data.at_risk.length} — export the
                  dossier or use deckctl for the full list
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- redundancy -------------------------------------------------------------

function RedundancyTab() {
  const [data, setData] = useState<RedundancyResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api<RedundancyResult>("/api/fleet/redundancy")
      .then(setData)
      .catch((e) => setErr((e as Error).message));
  }, []);

  if (err)
    return (
      <div class="note bad">
        <Icon name="warn" size={14} /> {err}
      </div>
    );
  if (!data)
    return (
      <div class="note-card">
        <Icon name="clock" size={20} /> Auditing playlists…
      </div>
    );

  const icon = { pass: "check", warn: "warn", fail: "warn", unknown: "dot" };

  return (
    <div>
      <div class={`note ${data.overall === "pass" ? "ok" : data.overall === "unknown" ? "" : "bad"}`}>
        <Icon name={data.overall === "pass" ? "check" : "warn"} size={14} />
        {data.summary}
      </div>

      {data.playlists.length === 0 && (
        <div class="note-card">
          <Icon name="disc" size={20} />
          No playlist data yet — run a full Scan on a mounted drive.
        </div>
      )}

      <div class="checks">
        {data.playlists.map((p) => {
          const isOpen = open === p.playlist;
          const gaps = p.tracks.filter((t) => t.copies < 2);
          return (
            <div class={`check ${p.verdict}`} key={p.playlist}>
              <span
                class="check-ico"
                role="button"
                tabIndex={0}
                onClick={() => setOpen(isOpen ? null : p.playlist)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setOpen(isOpen ? null : p.playlist);
                }}
              >
                <Icon name={icon[p.verdict]} size={12} />
              </span>
              <span class="check-body">
                <button
                  type="button"
                  class="pl-link"
                  onClick={() => setOpen(isOpen ? null : p.playlist)}
                >
                  <b>{p.playlist}</b>
                </button>
                <span class="check-detail">
                  {p.detail} · {p.protected_tracks}/{p.unique_tracks} protected
                </span>
                {isOpen &&
                  (gaps.length === 0 ? (
                    <span class="check-detail ok-text">
                      every track redundant — nothing to fix
                    </span>
                  ) : (
                    <span class="gaplist">
                      {gaps.slice(0, 100).map((t) => (
                        <span class="gaprow" key={t.identity.path}>
                          <Icon
                            name={t.copies <= 1 ? "warn" : "dot"}
                            size={11}
                          />
                          <b>{t.identity.title ?? t.identity.path}</b>
                          {t.identity.artist && (
                            <span class="covartist">
                              {" "}
                              — {t.identity.artist}
                            </span>
                          )}
                          <span class="covdrives">
                            on {t.drives.join(", ") || "no scanned drive"}
                          </span>
                        </span>
                      ))}
                      {gaps.length > 100 && (
                        <span class="gaprow">
                          …and {gaps.length - 100} more
                        </span>
                      )}
                    </span>
                  ))}
              </span>
              <span class={`pill mini ${p.verdict}`}>
                {p.verdict === "pass"
                  ? "safe"
                  : p.verdict === "fail"
                    ? "at risk"
                    : p.verdict === "warn"
                      ? "thin"
                      : "?"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- diff -------------------------------------------------------------------

function DiffTab() {
  const [drives, setDrives] = useState<DriveRef[]>([]);
  const [aId, setA] = useState("");
  const [bId, setB] = useState("");
  const [result, setResult] = useState<FleetDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api<{ id: string; nickname: string | null; name: string }[]>(
      "/api/drives",
    )
      .then((ds) => {
        const refs = ds.map((d) => ({
          id: d.id,
          name: d.nickname ?? d.name,
        }));
        setDrives(refs);
        if (refs.length >= 2 && !aId && !bId) {
          setA(refs[0]!.id);
          setB(refs[1]!.id);
        }
      })
      .catch(() => {});
  }, [aId, bId]);

  const run = useCallback(async () => {
    if (!aId || !bId || aId === bId) {
      toast("Pick two different drives", "info");
      return;
    }
    setBusy(true);
    try {
      setResult(
        await api<FleetDiff>(
          `/api/fleet/diff?a=${encodeURIComponent(aId)}&b=${encodeURIComponent(bId)}`,
        ),
      );
    } catch {
    } finally {
      setBusy(false);
    }
  }, [aId, bId]);

  const q = filter.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!result) return null;
    const f = (rows: FleetDiff["added"]) =>
      q
        ? rows.filter(
            (r) =>
              r.path.toLowerCase().includes(q) ||
              (r.title ?? "").toLowerCase().includes(q) ||
              (r.artist ?? "").toLowerCase().includes(q),
          )
        : rows;
    return {
      added: f(result.added),
      removed: f(result.removed),
      changed: f(result.changed),
    };
  }, [result, q]);

  return (
    <div>
      <div class="pl-tools">
        <select value={aId} onInput={(e) => setA((e.target as HTMLSelectElement).value)}>
          {drives.map((d) => (
            <option value={d.id} key={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <span class="diff-arrow">→</span>
        <select value={bId} onInput={(e) => setB((e.target as HTMLSelectElement).value)}>
          {drives.map((d) => (
            <option value={d.id} key={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <button type="button" class="btn primary" disabled={busy} onClick={run}>
          <Icon name="sort" size={14} /> {busy ? "Diffing…" : "Diff"}
        </button>
      </div>

      {!result && (
        <div class="note-card">
          <Icon name="sort" size={20} />
          Pick two drives and diff their inventories — added / removed /
          changed (byte-level when a file manifest exists).
        </div>
      )}

      {result && filtered && (
        <>
          <div class="statgrid">
            <div class="stat">
              <div class="v">
                <Icon name="check" size={13} /> {result.added.length}
              </div>
              <div class="l">added on {result.b}</div>
            </div>
            <div class="stat">
              <div class="v">
                <Icon name="x" size={13} /> {result.removed.length}
              </div>
              <div class="l">missing on {result.b}</div>
            </div>
            <div class="stat">
              <div class="v">
                <Icon name="warn" size={13} /> {result.changed.length}
              </div>
              <div class="l">changed bytes</div>
            </div>
          </div>
          <div class="pl-tools">
            <input
              placeholder="Filter results…"
              value={filter}
              onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
            />
            <span class="note" style={{ margin: 0 }}>
              {result.a} → {result.b}: {result.summary}
            </span>
          </div>
          <DiffSection
            title={`only on ${result.b}`}
            rows={filtered.added}
            empty="none — b has nothing a lacks"
          />
          <DiffSection
            title={`missing on ${result.b}`}
            rows={filtered.removed}
            empty="none — nothing dropped"
          />
          <DiffSection
            title="different bytes"
            rows={filtered.changed}
            empty="none — every shared file byte-identical"
            renderExtra={(r) =>
              r.bytes_a !== undefined && r.bytes_b !== undefined
                ? `${fmtBytes(r.bytes_a)} → ${fmtBytes(r.bytes_b)}`
                : ""
            }
          />
        </>
      )}
    </div>
  );
}

function DiffSection(props: {
  title: string;
  rows: FleetDiff["added"];
  empty: string;
  renderExtra?: (r: FleetDiff["added"][number]) => string;
}) {
  if (!props.rows.length)
    return (
      <div>
        <h3 class="sect">
          <Icon name="check" /> {props.title}
          <span class="sect-n">0</span>
        </h3>
        <div class="fleet-note">{props.empty}</div>
      </div>
    );
  return (
    <div>
      <h3 class="sect">
        <Icon name="disc" /> {props.title}
        <span class="sect-n">{props.rows.length}</span>
      </h3>
      <div class="covtable">
        {props.rows.slice(0, 300).map((r) => (
          <div class="covrow" key={r.kind + r.path}>
            <span class="covpath" title={r.path}>
              <b>{r.title ?? r.path}</b>
              {r.artist && <span class="covartist"> — {r.artist}</span>}
            </span>
            <span class="covdrives">{props.renderExtra?.(r) ?? ""}</span>
          </div>
        ))}
        {props.rows.length > 300 && (
          <div class="fleet-note">
            showing 300 of {props.rows.length}
          </div>
        )}
      </div>
    </div>
  );
}
