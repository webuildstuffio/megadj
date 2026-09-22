// playlists-crate.tsx — the crate cluster of PlaylistsTab (#89/#90 item 2
// extraction): the playlist → tracks index, the expandable crate rows
// (PlList), the in-crate track table with BPM/key/runtime sort, Camelot
// hover-glow, the energy-arc sparkline, and the shared inline highlight.
// PlaylistsTab keeps tab state (filter/sort/group) and hands the crate
// everything it renders.
import { useMemo, useState } from "preact/hooks";
import type { PlaylistInfo } from "../../../shared/types";
import {
  camelotOf,
  keyRelation,
  keySortToken,
  type CamelotPos,
} from "../../../shared/camelot";
import { fmtDur } from "../../../../shared/leaf/fmt";
import { Icon } from "../../ui/icons";
import { copyList } from "../../ui/data";
import { Sparkline } from "../../ui/charts";
import { fuzzyMatch } from "../../ui/fuzzy";

export interface PlTrack {
  title: string;
  artist: string | null;
  bpm: number | null;
  key: string | null;
  duration_ms: number | null;
}

/** stable row key (rekordbox allows the same playlist name in two folders) */
export const plKey = (pl: PlaylistInfo): string =>
  `${pl.parent ?? ""}/${pl.name}`;

/** index over the snapshot's raw rows: playlist name → ordered tracks with
 *  DJ metadata. Built once per snapshot; expansion is then O(1). Push, not
 *  spread — the spread version was O(n²) and the real archive carries
 *  22,906 entry rows. Accepts the structural slice it needs (SnapshotData
 *  satisfies it; exactOptionalPropertyTypes keeps the props `| undefined`). */
export function buildTrackIndex(
  snap: {
    tracks?:
      | {
          path: string;
          title: string | null;
          artist: string | null;
          bpm: number | null;
          key: string | null;
          duration_ms: number | null;
        }[]
      | null
      | undefined;
    playlist_entries?:
      { playlist_name: string; track_path: string }[] | null | undefined;
  } | null,
): Map<string, PlTrack[]> {
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

// Camelot parsing + key-relation glow come from the SHARED parser
// (shared/camelot.ts). PlaylistsTab used to carry its own camelot() that
// only read the "8A" notation form — a library whose TKEYs are open-key
// strings ("Am") glowed ZERO compatible keys. The SSOT accepts both forms.

/** highlight every occurrence of q (case-insensitive) inside text */
export function Hi(props: { text: string; q: string }) {
  const { text, q } = props;
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q);
  if (i === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
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

/** the crate's energy arc across original order — the shared Sparkline */
function BpmSpark({ bpms }: { bpms: number[] }) {
  if (bpms.length < 3) return null;
  const min = Math.min(...bpms);
  const max = Math.max(...bpms);
  return (
    <Sparkline
      values={bpms}
      title={`Energy arc across crate order (${Math.round(min)}–${Math.round(max)} BPM)`}
    />
  );
}

type CrateSortCol = "bpm" | "key" | "time";
interface CrateSort {
  k: CrateSortCol;
  dir: 1 | -1;
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
  const [hoverKey, setHoverKey] = useState<CamelotPos | null>(null);

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
          : keySortToken(t.key);
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
            onMouseEnter={() => setHoverKey(camelotOf(t.key))}
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
                hoverKey
                  ? keyRelation(t.key, hoverKey) === "same"
                    ? " k-same"
                    : keyRelation(t.key, hoverKey) === "compat"
                      ? " k-compat"
                      : ""
                  : ""
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

export function PlList({
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
        const nameHit = fuzzyMatch(pl.name, q);
        const parentHit = fuzzyMatch(pl.parent ?? "", q);
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
