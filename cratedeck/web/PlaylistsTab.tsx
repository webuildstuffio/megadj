// PlaylistsTab.tsx — playlists as a real browser: client-side filter,
// sort by entries/name, folder grouping toggle, and per-playlist entry bars
// scaled against the biggest playlist.
import { useMemo, useState } from "preact/hooks";
import type { PlaylistInfo, SnapshotData } from "../shared/types";
import { Icon } from "./icons";

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

  return (
    <div>
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
          >
            Busiest
          </button>
          <button
            type="button"
            class={sort === "name" ? "on" : ""}
            onClick={() => setSort("name")}
          >
            A–Z
          </button>
        </div>
        <div class="seg">
          <button
            type="button"
            class={group ? "on" : ""}
            onClick={() => setGroup(!group)}
          >
            Group folders
          </button>
        </div>
        <span class="note" style={{ margin: 0 }}>
          {all.length} playlists · {totalEntries.toLocaleString()} entries
        </span>
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
