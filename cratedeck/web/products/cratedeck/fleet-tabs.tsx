// fleet-tabs.tsx — the FleetPage content tabs, extracted from
// FleetPage.tsx (#89/#90 page-monolith split): coverage (redundancy map +
// at-risk work queue), redundancy (per-playlist survival audit), and diff
// (drive-vs-drive added/removed/changed). FleetPage keeps the tab routing;
// each tab owns its fetch + verdict + table rendering.
import { useCallback, useState } from "preact/hooks";
import type {
  CoverageResult,
  RedundancyResult,
  TrackLocationsResponse,
} from "../../../shared/types";
import { errMessage } from "../../../../src/shared/leaf/fmt";
import { api, toast } from "../../ui/toast";
import { Icon } from "../../ui/icons";
import { useFetched } from "../../ui/useFetched";
import {
  StatCard,
  CountStat,
  DataTable,
  SearchBar,
  copyList,
  ListHead,
} from "../../ui/data";
import { TabIntro } from "../../ui/InfoTip";
import { FixNote } from "../../ui/ListHead";
import { Verdict } from "../shared";

/** One at-risk row as a copy line — shared by the ListHead summary and the
 *  table's copyLines (jscpd-flagged twin; copy must match what's shown). */
const atRiskLine = (r: {
  identity: { path: string; title: string | null; artist: string | null };
  copies: number;
  drives: string[];
}): string =>
  `${r.identity.title ?? r.identity.path}${r.identity.artist ? ` — ${r.identity.artist}` : ""} (${r.copies} cop${r.copies === 1 ? "y" : "ies"}: ${r.drives.join(", ")})`;

// TrackHit is DERIVED from the wire SSOT (shared/types.ts) —
// TrackLocationsResponse is what GET /api/fleet/track actually returns
// (a local duplicate drifted once; the Sep 7 lesson).
type TrackHit = TrackLocationsResponse;

// ---- coverage ---------------------------------------------------------------

export function CoverageTab() {
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
        <Verdict
          cls={verdict.cls === "ok" ? "ok" : "warn"}
          text={verdict.text}
          meta={`${data.totals.unique_tracks.toLocaleString()} unique tracks · ${data.drives.length} drive${data.drives.length === 1 ? "" : "s"} scanned`}
        />
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
        <CountStat
          n={atRisk}
          l="single-drive tracks — gone if that drive dies"
          icon="warn"
          title="Tracks on fewer drives than the copy floor. Each one is one dead stick away from gone — the at-risk list below is the work queue."
        />
        <StatCard
          v={`${data.drives.length}`}
          l="drives with a track inventory"
          icon="usb"
        />
      </div>

      <SearchBar
        value={query}
        onInput={setQuery}
        onSearch={lookup}
        buttonLabel="Where is it?"
        placeholder="Find a track across every crate (title, artist, or path)…"
        busy={searching}
      />
      {hit && (
        <div class="pl-tools">
          <button
            type="button"
            class="btn ghostbtn"
            onClick={() => setHit(null)}
            title="Clear the lookup result"
          >
            <Icon name="x" size={13} /> Clear
          </button>
        </div>
      )}

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
            hint={`Tracks living on fewer than ${data.min_copies} drives — one dead stick away from gone. The fix is the ordinary mirror run: it converges master → mirror. Copy the list to hand it to an agent. Click a column to sort.`}
            lines={data.at_risk.map(atRiskLine)}
          />
          <DataTable
            columns={[
              {
                key: "track",
                head: "track",
                grow: 1,
                cell: (r) => (
                  <>
                    <b>{r.identity.title ?? r.identity.path}</b>
                    {r.identity.artist && (
                      <span class="covartist"> — {r.identity.artist}</span>
                    )}
                  </>
                ),
                sortValue: (r) =>
                  (r.identity.title ?? r.identity.path).toLowerCase(),
              },
              {
                key: "copies",
                head: "copies",
                align: "center",
                min: 64,
                grow: 0,
                cell: (r) => (
                  <span class={r.copies <= 1 ? "bad" : ""}>{r.copies}</span>
                ),
                sortValue: (r) => r.copies,
              },
              {
                key: "drives",
                head: "on drives",
                grow: 1.2,
                cell: (r) => <span class="dt-sub">{r.drives.join(", ")}</span>,
                sortValue: (r) => r.drives.join(", "),
              },
            ]}
            rows={data.at_risk}
            cap={200}
            ariaLabel="At-risk tracks"
            copyName="At-risk tracks"
            copyLines={(rows) => rows.map(atRiskLine)}
          />
          <FixNote>
            run <code>Mirror</code> (topbar or <code>deckctl run mirror</code>)
            — it copies the master's new music to the mirror
          </FixNote>
        </>
      )}
    </div>
  );
}

export function RedundancyTab() {
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
  const sorted = [...data.playlists].toSorted(
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
      <Verdict
        cls={data.overall === "pass" ? "ok" : "warn"}
        icon={data.overall === "pass" ? "check" : "warn"}
        text={data.summary}
        meta={
          gapCount > 0 ? (
            <>
              {gapCount} gap track{gapCount === 1 ? "" : "s"} across{" "}
              {data.playlists.filter((p) => p.verdict !== "pass").length}{" "}
              playlist
              {data.playlists.filter((p) => p.verdict !== "pass").length === 1
                ? ""
                : "s"}
            </>
          ) : undefined
        }
      />

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
