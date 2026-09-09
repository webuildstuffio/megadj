// FleetPage.tsx — the fleet superpowers canvas (ideas.md §B6/B7/B8):
//   coverage   — which stick has this track? + the at-risk (1-copy) list
//   redundancy — per-playlist audit: every track on ≥N drives?
//   diff       — drive-vs-drive added/removed/changed
// All server-rendered from fleet tables; this page is pure presentation.
//
// UX pass (Sep 8, same treatment as ArchiveTab): every tab now answers the
// three questions in order — (1) a verdict banner a human reads first,
// (2) the work, with real data rendered and every list copyable (the fix
// is an agent running deckctl/megadj — handing the list over is the CTA),
// (3) context. Preflight and Prep were already verdict-first/copyable by
// design; this pass covers the other three.
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type {
  CoverageResult,
  RedundancyResult,
  FleetDiff,
} from "../shared/types";
import { errMessage, fmtBytes } from "../shared/fmt";
import { api, toast } from "./toast";
import { Icon } from "./icons";
import { useFetched } from "./useFetched";
import { StatCard } from "./DrivePanels";
import { PreflightTab } from "./PreflightTab";
import { PrepTab } from "./PrepTab";
import { ArchiveTab } from "./ArchiveTab";
import { TabIntro } from "./InfoTip";
import { ListHead, FixNote, copyList } from "./ListHead";
import { ProductHead } from "./ProductPage";

const TABS = [
  {
    id: "coverage",
    label: "Coverage",
    icon: "grid",
    title: "Which stick has this track — and the at-risk single-copy list",
  },
  {
    id: "redundancy",
    label: "Redundancy",
    icon: "shield",
    title:
      "Per-playlist audit: is every track on enough drives to survive one dying?",
  },
  {
    id: "diff",
    label: "Diff",
    icon: "sort",
    title: "Two drives side by side: added, removed, changed",
  },
  {
    id: "preflight",
    label: "Preflight",
    icon: "bolt",
    title: "Gig-night gate: is every drive ready to play right now?",
  },
  {
    id: "archive",
    label: "Archive",
    icon: "doc",
    title: "The local archive: ingest queue, analysis state, integrity",
  },
  {
    id: "prep",
    label: "Prep",
    icon: "doc",
    title: "Weekly prep digest — everything worth knowing, one page",
  },
] as const;

type DriveRef = { id: string; name: string; mounted?: boolean };

interface TrackHit {
  identity: {
    path: string;
    title: string | null;
    artist: string | null;
  } | null;
  drives: DriveRef[];
}

export function FleetPage(props: { tab: string }) {
  const tab = TABS.find((t) => t.id === props.tab)?.id ?? TABS[0].id;

  return (
    <div class="canvas fleet">
      <ProductHead product="fleet" tab={tab} tabs={[...TABS]} />

      {tab === "coverage" && <CoverageTab />}
      {tab === "redundancy" && <RedundancyTab />}
      {tab === "diff" && <DiffTab />}
      {tab === "preflight" && <PreflightTab />}
      {tab === "archive" && <ArchiveTab />}
      {tab === "prep" && <PrepTab />}
    </div>
  );
}

// ---- coverage ---------------------------------------------------------------

function CoverageTab() {
  const page = useFetched<CoverageResult>(() => api("/api/fleet/coverage"), []);
  const data = page.status === "ok" ? page.data : null;
  const err = page.status === "error" ? page.message : null;
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState<TrackHit | null>(null);
  const [searching, setSearching] = useState(false);
  const [lookupErr, setLookupErr] = useState<string | null>(null);

  const lookup = useCallback(async (q: string) => {
    setSearching(true);
    setLookupErr(null);
    try {
      const r = await api<TrackHit>(
        `/api/fleet/track?q=${encodeURIComponent(q)}`,
      );
      setHit(r);
      if (!r.drives.length) toast("Not found on any scanned drive", "info");
    } catch (e) {
      // inline error state — the generic toast fades, this stays until the
      // next lookup clears it
      setLookupErr(errMessage(e));
    } finally {
      setSearching(false);
    }
  }, []);

  if (err) {
    return (
      <div class="note bad">
        <Icon name="warn" size={14} /> {err}
      </div>
    );
  }
  if (!data) {
    return (
      <div class="note-card">
        <Icon name="clock" size={20} /> Loading fleet inventory…
      </div>
    );
  }

  const shown = data.at_risk.slice(0, 200);
  // ---- the verdict: one line a human reads before anything else ---------
  const atRisk = data.at_risk.length;
  const verdict =
    data.drives.length === 0
      ? null // the no-data branch renders its own guidance below
      : atRisk === 0
        ? {
            cls: "ok",
            text: `Fleet is redundant — every track lives on ≥${data.min_copies} drives.`,
          }
        : {
            cls: "warn",
            text: `${atRisk.toLocaleString()} track${atRisk === 1 ? "" : "s"} would vanish if a drive died — run Mirror to converge.`,
          };

  return (
    <div>
      <TabIntro
        what="The redundancy map: what exists where, and what a dead drive would take with it."
        how="The verdict banner is the one-line answer. The at-risk list is every track below the copy floor (default 2) — copy it and hand it to an agent, or just run Mirror. Search any track to see exactly which sticks carry it."
        next="The fix for at-risk tracks is ordinary: run Mirror so the master's copy lands on the mirror."
      />

      {verdict && (
        <div class={`arch-verdict ${verdict.cls}`}>
          <Icon name={verdict.cls === "ok" ? "check" : "warn"} size={15} />
          <span>{verdict.text}</span>
          <span class="arch-verdict-meta">
            {data.totals.unique_tracks.toLocaleString()} unique tracks ·{" "}
            {data.drives.length} drive{data.drives.length === 1 ? "" : "s"}{" "}
            scanned
          </span>
        </div>
      )}

      <div class="statgrid">
        <StatCard
          v={data.totals.unique_tracks.toLocaleString()}
          l="unique tracks across the fleet"
          icon="disc"
        />
        <StatCard
          v={data.totals.fully_redundant.toLocaleString()}
          l={`on ≥${data.min_copies} drives (safe)`}
          icon="check"
        />
        <div class={`stat ${atRisk ? "bad" : ""}`}>
          <div class="v">
            <Icon name="warn" size={13} /> {atRisk.toLocaleString()}
          </div>
          <div class="l">single-drive tracks — gone if that drive dies</div>
        </div>
        <StatCard
          v={`${data.drives.length}`}
          l="drives with a track inventory"
          icon="usb"
        />
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
          title="Search every known drive for this track"
        >
          <Icon name="search" size={14} /> Where is it?
        </button>
        {hit && (
          <button
            type="button"
            class="btn ghostbtn"
            onClick={() => setHit(null)}
            title="Clear the lookup result"
          >
            <Icon name="x" size={13} /> Clear
          </button>
        )}
      </div>

      {lookupErr && (
        <div class="note bad">
          <Icon name="warn" size={14} /> Track lookup failed: {lookupErr}
        </div>
      )}

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
      ) : atRisk === 0 ? (
        <div class="note ok">
          <Icon name="check" size={14} /> Every track lives on ≥
          {data.min_copies} drives. This is the whole point of the mirror.
        </div>
      ) : (
        <>
          <ListHead
            icon="warn"
            title="At-risk tracks"
            n={atRisk}
            hint={`Tracks living on fewer than ${data.min_copies} drives — one dead stick away from gone. The fix is the ordinary mirror run: it converges master → mirror. Copy the list to hand it to an agent.`}
            lines={data.at_risk.map(
              (r) =>
                `${r.identity.title ?? r.identity.path}${r.identity.artist ? ` — ${r.identity.artist}` : ""} (${r.copies} cop${r.copies === 1 ? "y" : "ies"}: ${r.drives.join(", ")})`,
            )}
          />
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
            {atRisk > shown.length && (
              <div class="fleet-note">
                showing {shown.length} of {atRisk} — Copy has the full list
              </div>
            )}
          </div>
          <FixNote>
            run <code>Mirror</code> (topbar or <code>deckctl run mirror</code>)
            — it copies the master's new music to the mirror
          </FixNote>
        </>
      )}
    </div>
  );
}

// ---- redundancy -------------------------------------------------------------

function RedundancyTab() {
  const page = useFetched<RedundancyResult>(
    () => api("/api/fleet/redundancy"),
    [],
  );
  const data = page.status === "ok" ? page.data : null;
  const err = page.status === "error" ? page.message : null;
  const [open, setOpen] = useState<string | null>(null);

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
  // risky-first: at-risk playlists on top, unknowns pinned last — the order
  // IS the work queue (the first render was server order, whichever that was)
  const order = { fail: 0, warn: 1, pass: 2, unknown: 3 };
  const sorted = [...data.playlists].sort(
    (a, b) => order[a.verdict] - order[b.verdict],
  );
  const gapCount = data.playlists.reduce(
    (s, p) => s + p.tracks.filter((t) => t.copies < 2).length,
    0,
  );

  return (
    <div>
      <TabIntro
        what="Per-playlist survival audit: if one drive died tonight, which playlists come up short?"
        how="Playlists are sorted risky-first: at-risk on top, thin below, safe buried. Click one to see the exact gap tracks; Copy hands the gap list to an agent. The floor is the copy minimum — usually master + mirror."
        next="The fix is always the same: run Mirror and the gaps close as the master converges."
      />
      <div
        class={`arch-verdict ${data.overall === "pass" ? "ok" : data.overall === "unknown" ? "" : "warn"}`}
      >
        <Icon name={data.overall === "pass" ? "check" : "warn"} size={15} />
        <span>{data.summary}</span>
        {gapCount > 0 && (
          <span class="arch-verdict-meta">
            {gapCount} gap track{gapCount === 1 ? "" : "s"} across{" "}
            {data.playlists.filter((p) => p.verdict !== "pass").length} playlist
            {data.playlists.filter((p) => p.verdict !== "pass").length === 1
              ? ""
              : "s"}
          </span>
        )}
      </div>

      {data.playlists.length === 0 && (
        <div class="note-card">
          <Icon name="disc" size={20} />
          No playlist data yet — run a full Scan on a mounted drive.
        </div>
      )}

      <div class="checks">
        {sorted.map((p) => {
          const isOpen = open === p.playlist;
          const gaps = p.tracks.filter((t) => t.copies < 2);
          return (
            <div class={`check ${p.verdict}`} key={p.playlist}>
              <span
                class="check-ico"
                role="button"
                tabIndex={0}
                onClick={() => setOpen(isOpen ? null : p.playlist)}
                onKeyDown={(e: KeyboardEvent) => {
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
                    <>
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
                      <button
                        type="button"
                        class="btn sm ghostbtn"
                        title={`Copy these ${gaps.length} gap tracks — paste to an agent to work the list`}
                        onClick={() =>
                          copyList(
                            `${p.playlist} gaps`,
                            gaps.map(
                              (t) =>
                                `${t.identity.title ?? t.identity.path}${t.identity.artist ? ` — ${t.identity.artist}` : ""} (${t.copies}: ${t.drives.join(", ") || "nowhere"})`,
                            ),
                          )
                        }
                      >
                        <Icon name="copy" size={12} /> Copy gaps
                      </button>
                    </>
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

      {gapCount > 0 && (
        <FixNote>
          run <code>Mirror</code> — every gap here is a track the mirror is
          missing from the master
        </FixNote>
      )}
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
  const [diffErr, setDiffErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api<{ id: string; nickname: string | null; name: string }[]>("/api/drives")
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
      .catch((e: unknown) => {
        console.error("fleet drive list failed", e);
        toast(`drive list unavailable: ${errMessage(e)}`, "err");
      });
  }, [aId, bId]);

  const run = useCallback(async () => {
    if (!aId || !bId || aId === bId) {
      toast("Pick two different drives", "info");
      return;
    }
    setBusy(true);
    setDiffErr(null);
    try {
      setResult(
        await api<FleetDiff>(
          `/api/fleet/diff?a=${encodeURIComponent(aId)}&b=${encodeURIComponent(bId)}`,
        ),
      );
    } catch (e) {
      // keep the previous result visible but mark it stale — a diff that
      // failed must never read as current
      setDiffErr(errMessage(e));
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
      <TabIntro
        what="Two drives, side by side, track by track."
        how="Pick a source and a target: 'added' = tracks the target has that the source lacks, 'missing' = the reverse, 'changed' = same path, different bytes (only visible when a file manifest exists). Filter box narrows all three lists live."
        next="A healthy master→mirror diff reads: added on mirror ≈ your recent imports, missing on mirror = 0, changed = 0."
      />
      <div class="pl-tools">
        <select
          value={aId}
          onInput={(e) => setA((e.target as HTMLSelectElement).value)}
        >
          {drives.map((d) => (
            <option value={d.id} key={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <span class="diff-arrow">→</span>
        <select
          value={bId}
          onInput={(e) => setB((e.target as HTMLSelectElement).value)}
        >
          {drives.map((d) => (
            <option value={d.id} key={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          class="btn primary"
          disabled={busy}
          onClick={run}
          title="Compare the two selected drives track-by-track"
        >
          <Icon name="sort" size={14} /> {busy ? "Diffing…" : "Diff"}
        </button>
      </div>

      {diffErr && (
        <div class="note bad">
          <Icon name="warn" size={14} /> Diff failed: {diffErr}
          {result && (
            <span> — the tables below are the PREVIOUS run, not current.</span>
          )}
        </div>
      )}

      {!result && !diffErr && (
        <div class="note-card">
          <Icon name="sort" size={20} />
          Pick two drives and diff their inventories — added / removed / changed
          (byte-level when a file manifest exists).
        </div>
      )}

      {result && filtered && (
        <>
          {(() => {
            // ---- the verdict: interpret the three numbers -----------------
            // A healthy master→mirror diff reads: removed=0, changed=0;
            // added ≈ recent imports. Anything else gets a plain sentence.
            const missing = result.removed.length;
            const changed = result.changed.length;
            const added = result.added.length;
            const a = result.a;
            const b = result.b;
            const aIsMaster = /master/i.test(a);
            const healthyDirection =
              aIsMaster || (added > 0 && missing === 0 && changed === 0);
            const verdict =
              missing === 0 && changed === 0
                ? {
                    cls: "ok",
                    text:
                      added === 0
                        ? `${b} matches ${a} exactly — perfect parity.`
                        : `${b} is ahead of ${a} by ${added} track${added === 1 ? "" : "s"}${healthyDirection ? "" : " — check which side should be ahead"}, nothing missing, nothing changed.`,
                  }
                : {
                    cls: "warn",
                    text: `${b} is missing ${missing} track${missing === 1 ? "" : "s"}${changed > 0 ? ` and ${changed} differ in bytes` : ""} — run Mirror to converge.`,
                  };
            return (
              <div class={`arch-verdict ${verdict.cls}`}>
                <Icon
                  name={verdict.cls === "ok" ? "check" : "warn"}
                  size={15}
                />
                <span>{verdict.text}</span>
                <span class="arch-verdict-meta">
                  {added} added · {missing} missing · {changed} changed
                </span>
              </div>
            );
          })()}
          <div class="pl-tools">
            <input
              placeholder="Filter results…"
              value={filter}
              onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
            />
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
            fix={
              <>
                these are on <code>{result.a}</code> but not{" "}
                <code>{result.b}</code> — <code>Mirror</code> closes the gap
              </>
            }
          />
          <DiffSection
            title="different bytes"
            rows={filtered.changed}
            empty="none — every shared file byte-identical"
            fix={
              <>
                same path, different size — re-copy the file, or investigate
                which copy is the good one before overwriting
              </>
            }
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
  fix?: ComponentChildren;
}) {
  const icon = props.rows.length ? "disc" : "check";
  return (
    <div>
      <ListHead
        icon={icon}
        title={props.title}
        n={props.rows.length}
        hint="Track-level diff between the two drives. Copy hands the list to an agent — e.g. 'copy these to the other stick' or 'check why these differ'."
        lines={
          props.rows.length > 0
            ? props.rows.map(
                (r) =>
                  `${r.title ?? r.path}${r.artist ? ` — ${r.artist}` : ""}${props.renderExtra ? ` (${props.renderExtra(r)})` : ""}`,
              )
            : undefined
        }
      />
      {!props.rows.length ? (
        <div class="fleet-note">{props.empty}</div>
      ) : (
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
              showing 300 of {props.rows.length} — Copy has the full list
            </div>
          )}
        </div>
      )}
      {props.fix && props.rows.length > 0 && <FixNote>{props.fix}</FixNote>}
    </div>
  );
}
