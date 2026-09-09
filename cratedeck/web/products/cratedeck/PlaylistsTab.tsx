// PlaylistsTab.tsx — playlists as a real crate browser: client-side filter,
// sort by entries/name, folder grouping toggle, and per-playlist entry bars
// scaled against the biggest playlist.
//
// Crate-browser pass (Sep 8, PM): rows are no longer dead ends. A playlist
// expands into its actual tracks — title, artist, BPM, key, runtime — joined
// from the snapshot's playlist_entries × tracks. Each crate is copyable
// (set-planning / agent handoff).
//
// Booth pass (Sep 8, night): the tab now thinks like a DJ planning a set —
// - multiple crates open at once (compare Peak Time against Warmup)
// - the filter digs into track titles/artists, auto-opens the crate holding
//   the hit, and highlights the match inline ("where did I file that remix"
//   is answered without reading a single row)
// - crate columns sort by BPM / key / runtime — plan the energy arc; copy
//   reflects what you see
// - hover any track: compatible keys glow (Camelot same-number relative
//   major/minor, ±1 same letter) — harmonic mixing fuel from data we
//   already ship
// - per-crate BPM sparkline: the energy arc across crate order, at a glance
// - "/" focuses the filter, Escape clears it
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { PlaylistInfo, SnapshotData } from "../../../shared/types";
import { fmtDur } from "../../../shared/fmt";
import { Icon } from "../../ui/icons";
import { InfoTip, TabIntro } from "../../ui/InfoTip";
import { copyList } from "../../ui/ListHead";

type SortKey = "entries" | "name";
type CrateSortCol = "bpm" | "key" | "time";
interface CrateSort {
  k: CrateSortCol;
  dir: 1 | -1;
}

interface PlTrack {
  title: string;
  artist: string | null;
  bpm: number | null;
  key: string | null;
  duration_ms: number | null;
}

/** stable row key (rekordbox allows the same playlist name in two folders) */
const plKey = (pl: PlaylistInfo): string => `${pl.parent ?? ""}/${pl.name}`;

/** index over the snapshot's raw rows: playlist name → ordered tracks with
 *  DJ metadata. Built once per snapshot; expansion is then O(1). Push, not
 *  spread — the spread version was O(n²) and the real archive carries
 *  22,906 entry rows. */
function buildTrackIndex(snap: SnapshotData | null): Map<string, PlTrack[]> {
  const m = new Map<string, PlTrack[]>();
  if (!snap) return m;
  const byPath = new Map((snap.tracks ?? []).map((t) => [t.path, t]));
  for (const e of snap.playlist_entries ?? []) {
    let arr = m.get(e.playlist_name);
    if (!arr) {
      arr = [];
      m.set(e.playlist_name, arr);
    }
    const t = byPath.get(e.track_path);
    arr.push({
      title: t?.title ?? e.track_path,
      artist: t?.artist ?? null,
      bpm: t?.bpm ?? null,
      key: t?.key ?? null,
      duration_ms: t?.duration_ms ?? null,
    });
  }
  return m;
}

/** Camelot/Open Key parse: "8A" → [8, 0]. Unparseable keys → null. */
function camelot(k: string | null): [number, number] | null {
  if (!k) return null;
  const m = /^(\d{1,2})\s*([ABab])$/.exec(k.trim());
  return m ? [parseInt(m[1]!, 10), m[2]!.toLowerCase() === "a" ? 0 : 1] : null;
}

/** zero-padded sort token so "10B" sorts after "8B" lexicographically */
function keyToken(k: string | null): string | null {
  const c = camelot(k);
  return c ? `${String(c[0]).padStart(2, "0")}${c[1]}` : null;
}

/** how a track's key relates to the hovered one — the harmonic-mixing rule:
 *  same Camelot number (relative major/minor) or ±1 number, same letter.
 *  Returns "" (no class) when either key is missing/unknown. */
function keyRelation(
  k: string | null,
  hover: [number, number],
): "" | "k-same" | "k-compat" {
  const c = camelot(k);
  if (!c) return "";
  if (c[0] === hover[0] && c[1] === hover[1]) return "k-same";
  if (
    c[0] === hover[0] ||
    (Math.abs(c[0] - hover[0]) === 1 && c[1] === hover[1])
  )
    return "k-compat";
  return "";
}

/** highlight every occurrence of q (case-insensitive) inside text */
function Hi(props: { text: string; q: string }) {
  const { text, q } = props;
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export function PlaylistsTab({ snap }: { snap: SnapshotData | null }) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("entries");
  const [group, setGroup] = useState(false);
  const [userOpen, setUserOpen] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement | null>(null);

  const tracksByPl = useMemo(() => buildTrackIndex(snap), [snap]);

  // "/" jumps to the filter (standard palette semantics; typing contexts skip)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const toggleOpen = (key: string) =>
    setUserOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const all = useMemo(
    () => (snap?.playlists ?? []).slice().sort((a, b) => b.entries - a.entries),
    [snap],
  );
  const max = all[0]?.entries ?? 1;

  const q = filter.trim().toLowerCase();
  const fActive = q.length > 0;

  const shown = useMemo(() => {
    const rows = fActive
      ? all.filter(
          (pl) =>
            pl.name.toLowerCase().includes(q) ||
            (pl.parent ?? "").toLowerCase().includes(q) ||
            (tracksByPl.get(pl.name) ?? []).some(
              (t) =>
                t.title.toLowerCase().includes(q) ||
                (t.artist ?? "").toLowerCase().includes(q),
            ),
        )
      : all;
    return rows
      .slice()
      .sort((a, b) =>
        sort === "entries"
          ? b.entries - a.entries
          : a.name.localeCompare(b.name),
      );
  }, [all, fActive, q, sort, tracksByPl]);

  // how many in-crate tracks the filter hits — the readout line
  const trackHits = useMemo(() => {
    if (!fActive) return 0;
    return shown.reduce(
      (s, pl) =>
        s +
        (tracksByPl.get(pl.name) ?? []).filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            (t.artist ?? "").toLowerCase().includes(q),
        ).length,
      0,
    );
  }, [shown, fActive, q, tracksByPl]);

  const groups = useMemo(() => {
    if (!group) return null;
    const m = new Map<string, PlaylistInfo[]>();
    for (const pl of shown) {
      const k = pl.parent ?? "root playlists";
      (m.get(k) ?? m.set(k, []).get(k)!).push(pl);
    }
    return [...m.entries()].sort((a, b) =>
      a[0] === "root playlists"
        ? -1
        : b[0] === "root playlists"
          ? 1
          : a[0].localeCompare(b[0]),
    );
  }, [shown, group]);

  if (!snap)
    return (
      <div class="note-card">
        <Icon name="disc" size={20} />
        No snapshot yet — run a scan when mounted.
      </div>
    );

  const totalEntries = all.reduce((s, p) => s + p.entries, 0);
  const folders = new Set(all.map((p) => p.parent).filter(Boolean));
  const biggest = all[0];
  const deep = (snap.playlist_entries ?? []).length > 0;
  const copyInventory = () =>
    copyList(
      "Playlist inventory",
      all.map(
        (p) =>
          `${p.name}${p.parent ? ` [${p.parent}]` : ""} — ${p.entries} entries`,
      ),
    );

  return (
    <div>
      <TabIntro
        what="Every playlist on this stick, exactly as rekordbox exported it."
        how="Click a playlist to open the crate — sort columns by BPM, key or runtime to plan the energy arc. The filter digs into track titles and artists, auto-opens the crate holding the hit and highlights it inline. Press / to jump to the filter, Escape to clear. Copy exports the whole inventory."
        next="Cross-drive playlist safety (would a playlist survive one drive dying?) lives in Fleet → Redundancy."
      />
      <div class="arch-verdict ok">
        <Icon name="disc" size={15} />
        <span>
          {all.length} playlist{all.length === 1 ? "" : "s"} ·{" "}
          {totalEntries.toLocaleString()} entr
          {totalEntries === 1 ? "y" : "ies"}
          {biggest && biggest.entries > 0 && (
            <>
              {" "}
              · biggest crate <b>{biggest.name}</b> ({biggest.entries})
            </>
          )}
          {folders.size > 0 && (
            <>
              {" "}
              · {folders.size} folder{folders.size === 1 ? "" : "s"}
            </>
          )}
        </span>
        <span class="arch-verdict-meta">
          <InfoTip
            title="Playlist inventory"
            body="Copy exports every playlist with folder + entry count — for agents rebuilding lists on a fresh stick, auditing crates, or feeding a set-planning tool."
            align="right"
          />
          <button
            type="button"
            class="btn sm ghostbtn"
            title="Copy the full playlist inventory — paste to an agent or notes"
            onClick={copyInventory}
          >
            <Icon name="copy" size={12} /> Copy
          </button>
        </span>
      </div>
      <div class="pl-tools">
        <div class="plsearch">
          <Icon name="search" size={13} />
          <input
            ref={inputRef}
            placeholder={
              deep ? "Filter playlists or tracks…" : "Filter playlists…"
            }
            value={filter}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setFilter("");
              }
            }}
            onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
          />
          {filter && (
            <button
              type="button"
              class="plsearch-clear"
              title="Clear filter (Escape)"
              onClick={() => setFilter("")}
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
        <div class="seg">
          <button
            type="button"
            class={sort === "entries" ? "on" : ""}
            onClick={() => setSort("entries")}
            title="Sort by number of entries, busiest first"
          >
            Busiest
          </button>
          <button
            type="button"
            class={sort === "name" ? "on" : ""}
            onClick={() => setSort("name")}
            title="Sort alphabetically"
          >
            A–Z
          </button>
        </div>
        <div class="seg">
          <button
            type="button"
            class={group ? "on" : ""}
            onClick={() => setGroup(!group)}
            title={group ? "Flatten to one list" : "Group playlists by folder"}
          >
            Group folders
          </button>
        </div>
        {filter && (
          <span class="pl-results">
            {shown.length} of {all.length}
            {trackHits > 0 &&
              ` · ${trackHits} track hit${trackHits === 1 ? "" : "s"}`}
          </span>
        )}
      </div>

      {shown.length === 0 && (
        <div class="note-card">
          <Icon name="search" size={20} />
          No playlists match “{filter}”.
        </div>
      )}

      {groups ? (
        groups.map(([folder, pls]) => (
          <div key={folder}>
            <div class="plgroup">
              <Icon name="folder" size={12} /> {folder}
              <span class="plgroup-n">{pls.length}</span>
            </div>
            <PlList
              pls={pls}
              max={max}
              total={totalEntries}
              tracks={tracksByPl}
              userOpen={userOpen}
              onToggle={toggleOpen}
              deep={deep}
              q={q}
              fActive={fActive}
            />
          </div>
        ))
      ) : (
        <PlList
          pls={shown}
          max={max}
          total={totalEntries}
          tracks={tracksByPl}
          userOpen={userOpen}
          onToggle={toggleOpen}
          deep={deep}
          q={q}
          fActive={fActive}
        />
      )}
    </div>
  );
}

function PlList({
  pls,
  max,
  total,
  tracks,
  userOpen,
  onToggle,
  deep,
  q,
  fActive,
}: {
  pls: PlaylistInfo[];
  max: number;
  total: number;
  tracks: Map<string, PlTrack[]>;
  userOpen: Set<string>;
  onToggle: (key: string) => void;
  deep: boolean;
  q: string;
  fActive: boolean;
}) {
  return (
    <div class="pllist">
      {pls.map((pl) => {
        const key = plKey(pl);
        const nameHit = pl.name.toLowerCase().includes(q);
        const parentHit = (pl.parent ?? "").toLowerCase().includes(q);
        // search that only matches INSIDE the crate auto-opens it — the
        // "where did I file that remix" case; ≥2 chars keeps broad queries
        // from fanning every crate open at once
        const autoOpen = fActive && q.length >= 2 && !nameHit && !parentHit;
        const isOpen = userOpen.has(key) || autoOpen;
        const rows = tracks.get(pl.name) ?? [];
        const runtime = rows.reduce((s, t) => s + (t.duration_ms ?? 0), 0);
        return (
          <div class={`plwrap ${isOpen ? "open" : ""}`} key={key}>
            <button
              type="button"
              class="plrow"
              onClick={() => onToggle(key)}
              title={deep ? "Click to open this crate" : undefined}
              aria-expanded={isOpen}
            >
              <span class="plchev">
                <Icon name={isOpen ? "chevD" : "chevronR"} size={13} />
              </span>
              <span class="plname">
                {pl.parent && (
                  <span class="parent">
                    <Hi text={pl.parent} q={parentHit ? q : ""} /> /{" "}
                  </span>
                )}
                <Hi text={pl.name} q={nameHit ? q : ""} />
              </span>
              <span
                class="plbar"
                title={`${pl.entries} entries · ${Math.round((pl.entries / (total || 1)) * 100)}% of the library`}
              >
                <i
                  style={{
                    width: `${Math.max(3, (pl.entries / (max || 1)) * 100)}%`,
                  }}
                />
              </span>
              <span class="n">{pl.entries.toLocaleString()}</span>
            </button>
            {isOpen && (
              <PlTracks name={pl.name} rows={rows} runtime={runtime} q={q} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** human runtime from ms: "1h 23m" / "47m 12s" / "5m" / "42s" */
function fmtHuman(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return r ? `${m}m ${r}s` : `${m}m`;
  return `${s}s`;
}

/** the crate's energy arc across original order — a glanceable polyline */
function BpmSpark({ bpms }: { bpms: number[] }) {
  if (bpms.length < 3) return null;
  const min = Math.min(...bpms);
  const max = Math.max(...bpms);
  const span = max - min || 1;
  const W = 110;
  const H = 16;
  const pts = bpms
    .map(
      (b, i) =>
        `${((i / (bpms.length - 1)) * (W - 4) + 2).toFixed(1)},${(
          H -
          2 -
          ((b - min) / span) * (H - 4)
        ).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      class="bpmspark"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden
      title={`Energy arc across crate order (${Math.round(min)}–${Math.round(max)} BPM)`}
    >
      <polyline points={pts} />
    </svg>
  );
}

function PlTracks({
  name,
  rows,
  runtime,
  q,
}: {
  name: string;
  rows: PlTrack[];
  runtime: number;
  q: string;
}) {
  const [sort, setSort] = useState<CrateSort | null>(null);
  const [hoverKey, setHoverKey] = useState<[number, number] | null>(null);

  const total = rows.length;
  const bpms = rows.map((t) => t.bpm).filter((b): b is number => b !== null);
  const bpMin = bpms.length ? Math.round(Math.min(...bpms)) : null;
  const bpMax = bpms.length ? Math.round(Math.max(...bpms)) : null;

  /** crate order preserved as pos; sort keeps nulls last and is stable */
  const view = useMemo(() => {
    const idx = rows.map((t, i) => ({ t, i }));
    if (!sort) return idx;
    const val = (t: PlTrack): number | string | null =>
      sort.k === "bpm"
        ? t.bpm
        : sort.k === "time"
          ? t.duration_ms
          : keyToken(t.key);
    const nonNull = idx.filter((w) => val(w.t) !== null);
    const nulls = idx.filter((w) => val(w.t) === null);
    nonNull.sort((x, y) => {
      const vx = val(x.t) as number | string;
      const vy = val(y.t) as number | string;
      const c = (vx < vy ? -1 : vx > vy ? 1 : 0) * sort.dir;
      return c !== 0 ? c : x.i - y.i;
    });
    return [...nonNull, ...nulls];
  }, [rows, sort]);

  const toggleSort = (k: CrateSortCol) =>
    setSort((prev) =>
      prev && prev.k === k
        ? { k, dir: (prev.dir * -1) as 1 | -1 }
        : { k, dir: k === "key" ? 1 : -1 },
    );

  if (total === 0)
    return (
      <div class="pltracks">
        <div class="pltracks-empty">
          <Icon name="disc" size={16} />
          No track rows in this snapshot — a full Scan collects them.
        </div>
      </div>
    );

  return (
    <div class="pltracks">
      <div class="pltracks-meta">
        <span>
          <b>{total}</b> track{total === 1 ? "" : "s"}
        </span>
        {runtime > 0 && (
          <span>
            <b>{fmtHuman(runtime)}</b> total
          </span>
        )}
        <BpmSpark bpms={bpms} />
        {bpMin !== null && (
          <span>
            BPM{" "}
            <b>
              {bpMin}–{bpMax}
            </b>
          </span>
        )}
        <span class="pltracks-actions">
          <button
            type="button"
            class="btn sm ghostbtn"
            title={`Copy all ${total} tracks from ${name}${sort ? " (current sort)" : ""} — paste to an agent, a set plan, or notes`}
            onClick={() =>
              copyList(
                name,
                view.map(({ t }) => {
                  const meta: string[] = [];
                  if (t.bpm !== null) meta.push(`${Math.round(t.bpm)} BPM`);
                  if (t.key) meta.push(t.key);
                  if (t.duration_ms) meta.push(fmtDur(t.duration_ms / 1000));
                  const head = `${t.artist ?? "?"} — ${t.title}`;
                  return meta.length ? `${head} [${meta.join(" · ")}]` : head;
                }),
              )
            }
          >
            <Icon name="copy" size={12} /> Copy tracks
          </button>
        </span>
      </div>
      <div class="pltrack-head">
        <button
          type="button"
          class={`plh-btn ${sort ? "" : "sorted"}`}
          onClick={() => setSort(null)}
          title={
            sort
              ? "Reset to crate order"
              : "Crate order (as saved in rekordbox)"
          }
          disabled={!sort}
        >
          #
        </button>
        <span>track</span>
        <button
          type="button"
          class={`plh-btn ${sort?.k === "bpm" ? "sorted" : ""}`}
          onClick={() => toggleSort("bpm")}
          title="Sort by BPM — plan the energy arc"
        >
          bpm
          {sort?.k === "bpm" && (
            <Icon name={sort.dir === 1 ? "chevU" : "chevD"} size={10} />
          )}
        </button>
        <button
          type="button"
          class={`plh-btn ${sort?.k === "key" ? "sorted" : ""}`}
          onClick={() => toggleSort("key")}
          title="Sort by key (Camelot). Hover any track — compatible keys glow: same number (relative major/minor) or ±1 same letter."
        >
          key
          {sort?.k === "key" && (
            <Icon name={sort.dir === 1 ? "chevU" : "chevD"} size={10} />
          )}
        </button>
        <button
          type="button"
          class={`plh-btn ${sort?.k === "time" ? "sorted" : ""}`}
          onClick={() => toggleSort("time")}
          title="Sort by runtime"
        >
          time
          {sort?.k === "time" && (
            <Icon name={sort.dir === 1 ? "chevU" : "chevD"} size={10} />
          )}
        </button>
      </div>
      <div class="pltrackrows" onMouseLeave={() => setHoverKey(null)}>
        {view.map(({ t, i }) => (
          <div
            class="pltrack"
            key={`${i}/${t.title}`}
            onMouseEnter={() => setHoverKey(camelot(t.key))}
          >
            <span class="pltrack-i">{i + 1}</span>
            <span class="pltrack-name">
              {t.artist && (
                <span class="parent">
                  <Hi text={t.artist} q={q} /> —{" "}
                </span>
              )}
              <Hi text={t.title} q={q} />
            </span>
            <span class="pltrack-n">{t.bpm ? Math.round(t.bpm) : "—"}</span>
            <span
              class={`pltrack-k${
                hoverKey ? ` ${keyRelation(t.key, hoverKey)}` : ""
              }`}
            >
              {t.key ?? "—"}
            </span>
            <span class="pltrack-n">
              {t.duration_ms ? fmtDur(t.duration_ms / 1000) : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
