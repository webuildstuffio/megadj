// PlaylistsTab.tsx — playlists as a real browser: client-side filter,
// sort by entries/name, folder grouping toggle, and per-playlist entry bars
// scaled against the biggest playlist.
//
// UX pass (Sep 8): the tab leads with a one-line read of the library shape
// (playlists, entries, the biggest crate) and the list is copyable —
// handing the crate inventory to an agent ("rebuild these on a new stick")
// is one paste.
import { useMemo, useState } from "preact/hooks";
import type { PlaylistInfo, SnapshotData } from "../shared/types";
import { Icon } from "./icons";
import { InfoTip, TabIntro } from "./InfoTip";
import { copyList } from "./ListHead";

type SortKey = "entries" | "name";

export function PlaylistsTab({ snap }: { snap: SnapshotData | null }) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("entries");
  const [group, setGroup] = useState(false);

  const all = useMemo(
    () => (snap?.playlists ?? []).slice().sort((a, b) => b.entries - a.entries),
    [snap],
  );
  const max = all[0]?.entries ?? 1;

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const rows = f
      ? all.filter(
          (pl) =>
            pl.name.toLowerCase().includes(f) ||
            (pl.parent ?? "").toLowerCase().includes(f),
        )
      : all;
    const sorted = rows
      .slice()
      .sort((a, b) =>
        sort === "entries"
          ? b.entries - a.entries
          : a.name.localeCompare(b.name),
      );
    return sorted;
  }, [all, filter, sort]);

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
        how="The banner reads the library shape in one line. Bars scale against the biggest playlist so outliers jump out. Filter box matches playlist and folder names; 'Group folders' mirrors the folder tree rekordbox shows. Copy exports the whole inventory."
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
        <input
          placeholder="Filter playlists…"
          value={filter}
          onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
        />
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
            </div>
            <PlList pls={pls} max={max} />
          </div>
        ))
      ) : (
        <PlList pls={shown} max={max} />
      )}
    </div>
  );
}

function PlList({ pls, max }: { pls: PlaylistInfo[]; max: number }) {
  return (
    <div class="pllist">
      {pls.map((pl) => (
        <div class="plrow" key={pl.parent + "/" + pl.name}>
          <span class="plname">
            {pl.parent && <span class="parent">{pl.parent} / </span>}
            {pl.name}
          </span>
          <span class="plbar" title={`${pl.entries} entries`}>
            <i
              style={{
                width: `${Math.max(3, (pl.entries / (max || 1)) * 100)}%`,
              }}
            />
          </span>
          <span class="n">{pl.entries.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
