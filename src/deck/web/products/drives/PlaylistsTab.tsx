// PlaylistsTab.tsx — playlists as a real crate browser: client-side filter,
// sort by entries/name, folder grouping toggle, and per-playlist entry bars
// scaled against the biggest playlist. Tab state (filter/sort/group +
// open-crate bookkeeping) lives here; the crate rendering itself — track
// index, expandable rows, in-crate table with BPM/key/runtime sort and the
// Camelot hover-glow — lives in playlists-crate.tsx (#89/#90 item 2).
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
import { Verdict } from "../shared";
import { Icon } from "../../ui/icons";
import { InfoTip, TabIntro } from "../../ui/InfoTip";
import { copyList } from "../../ui/data";
import { fuzzyFilter, fuzzyMatch } from "../../ui/fuzzy";
import { buildTrackIndex, PlList } from "./playlists-crate";

type SortKey = "entries" | "name";

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

  const all = useMemo(() => {
    // rekordbox can carry two rows with the same name AND parent (this library
    // ships two root-level "YTMusic Liked") — as list rows they are byte-for-
    // byte identical (the track index is keyed by name), and as React keys
    // they collide: same key = lost/misrouted crate toggles. Keep the first.
    const seen = new Set<string>();
    return [...(snap?.playlists ?? [])]
      .toSorted((a, b) => b.entries - a.entries)
      .filter((pl) => {
        const k = `${pl.parent ?? ""}/${pl.name}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  }, [snap]);
  const max = all[0]?.entries ?? 1;

  const q = filter.trim().toLowerCase();
  const fActive = q.length > 0;

  const shown = useMemo(() => {
    // fuzzy (fuse.js): "dustin" finds "Dustin Zahn", transposed keys hit —
    // the old includes()-only filter silently missed every typo
    const rows = fActive
      ? fuzzyFilter(all, q, ["name", "parent"]).filter((pl) =>
          (tracksByPl.get(pl.name) ?? []).some(
            (t) => fuzzyMatch(t.title, q) || fuzzyMatch(t.artist ?? "", q),
          ),
        )
      : all;
    return [...rows].toSorted((a, b) =>
      sort === "entries" ? b.entries - a.entries : a.name.localeCompare(b.name),
    );
  }, [all, fActive, q, sort, tracksByPl]);

  // how many in-crate tracks the filter hits — the readout line
  const trackHits = useMemo(() => {
    if (!fActive) return 0;
    return shown.reduce(
      (s, pl) =>
        s +
        (tracksByPl.get(pl.name) ?? []).filter(
          (t) => fuzzyMatch(t.title, q) || fuzzyMatch(t.artist ?? "", q),
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
    return [...m.entries()].toSorted((a, b) =>
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
      <Verdict
        cls="ok"
        icon="disc"
        text={
          <>
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
          </>
        }
        meta={
          <>
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
          </>
        }
      />
      <div class="pl-tools">
        <div class="plsearch">
          <Icon name="search" size={13} />
          <input
            ref={inputRef}
            type="search"
            name="playlist-filter"
            aria-label="Filter playlists or tracks"
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
