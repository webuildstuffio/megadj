// TagCompareTab.tsx — the FullTags "Tags" canvas rebuilt as the
// FullTags ↔ rekordbox ↔ file comparison surface (#/fulltags/tags).
//
// Two views, one seam (§4-A1 read-only):
//   Census      — every playable track's DB mirrors compared (archive
//                 tracks/track_keys/beats vs the rb-adopt mirror), worst
//                 disagreements first. PURE DB — files are never read.
//   Track view  — ONE track, three sources: the live FILE read (ground
//                 truth), the archive mirror, the RB mirror — plus the
//                 full lossless rekordbox payload.
//
// The playlist-viewer vocabulary (expandable rows, inline filter, copy)
// is reused for browsing; the track picker is the shared TrackPickSearch.
import { useState } from "preact/hooks";
import type {
  ArchiveSearchHit,
  ArchiveTagCensus,
  ArchiveTagCensusRow,
  ArchiveTrackTagCompare,
} from "../../../shared/types";
import { api } from "../../ui/toast";
import { Icon } from "../../ui/icons";
import { FetchedGate, useFetched, type Fetched } from "../../ui/useFetched";
import { TabIntro } from "../../ui/InfoTip";
import {
  Card,
  ListHead,
  KVRows,
  KVRow,
  KVKey,
  KVVal,
  DataTable,
} from "../../ui/data";
import { ArchiveAbsentGate, SectionHead, Verdict } from "../shared";
import { TrackPickSearch, type TrackPick } from "./TrackPickSearch";

/** Pill classes per comparison outcome. */
const diffPill = (differ: boolean): string =>
  differ ? "arch-pill warn" : "arch-pill ok";

const show = (v: string | number | null): string =>
  v === null || v === "" ? "—" : String(v);

// ---- census ----------------------------------------------------------------

type CensusFilter = "all" | "diff" | "genre" | "flag";

export function TagCompareTab() {
  const [filter, setFilter] = useState("");
  const [censusFilter, setCensusFilter] = useState<CensusFilter>("diff");
  const [picked, setPicked] = useState<TrackPick | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const census = useFetched<ArchiveTagCensus>(
    () => api<ArchiveTagCensus>("/api/archive/tag-census?limit=500"),
    [],
  );
  // The search endpoint's wire shape is a BARE ARRAY (ArchiveTrack[]) —
  // shared/types re-export; no local twin (the round-4 lesson).
  const search = useFetched<ArchiveSearchHit[] | null>(
    () =>
      filter.trim().length >= 2
        ? api<ArchiveSearchHit[]>(
            `/api/archive/search?q=${encodeURIComponent(filter)}`,
          )
        : Promise.resolve(null),
    [filter],
  );
  const compare = useFetched<ArchiveTrackTagCompare>(
    () =>
      picked
        ? api<ArchiveTrackTagCompare>(
            `/api/archive/tag-compare?id=${encodeURIComponent(picked.video_id)}`,
          )
        : Promise.reject(new Error("no track picked")),
    [picked],
  );

  if (census.status !== "ok")
    return <FetchedGate page={census} loading="comparing the mirrors…" />;
  const c = census.data;
  if (!c.available) return <ArchiveAbsentGate />;
  if (!c.rekordboxMirror)
    return (
      <div>
        <TabIntro
          what="FullTags ↔ rekordbox tag comparison."
          how="Shows what the enrichment engine's DB mirror says versus what the rb-adopt mirror imported from rekordbox — genre, key, BPM, identity — and, per track, the physical file's live tags as the third source."
          next="The rekordbox mirror is empty: run `megadj rb-adopt` once (rekordbox closed) to import the collection census."
        />
        <div class="note-card">
          <Icon name="usb" size={20} />
          No rekordbox mirror yet — <code>megadj rb-adopt</code> fills it (reads
          master.db read-only, links Content IDs to archive tracks).
        </div>
      </div>
    );

  const q = filter.trim().toLowerCase();
  const rows = c.rows.filter((r) => {
    if (q && !`${r.title ?? ""} ${r.artist ?? ""}`.toLowerCase().includes(q))
      return false;
    if (censusFilter === "diff") return r.differs.length > 0;
    if (censusFilter === "genre") return r.differs.includes("genre");
    if (censusFilter === "flag") return r.genreFlag !== null;
    return true;
  });

  const pickRow = (r: ArchiveTagCensusRow) => {
    setOpenRow((cur) => (cur === r.videoId ? null : r.videoId));
  };

  return (
    <div>
      <TabIntro
        what="FullTags ↔ rekordbox ↔ the files: every tag source side by side."
        how="The census compares the two DB mirrors (archive enrichment vs the rb-adopt import of rekordbox's collection) — genre, key, BPM, identity — no file reads, so it's instant. Click any row for the full three-source view of that track: the live file tags (ground truth), the archive mirror, and rekordbox's row, differences precomputed."
        next="Disagreements here are display/scoring input, never auto-rewrites: genres come from real sources, and the disputed-flag pass (genre --flag) already excludes unanimous-consensus contradictions from inference seeding."
      />
      <Verdict
        cls={c.differing > 0 ? "warn" : "ok"}
        icon="tag"
        text={
          <>
            {c.matched.toLocaleString()} tracks in both mirrors ·{" "}
            <b>{c.differing.toLocaleString()}</b> disagree on ≥1 field
            {c.unmatched > 0 && (
              <> · {c.unmatched.toLocaleString()} not in rekordbox</>
            )}
          </>
        }
        meta={c.fieldCounts.slice(0, 4).map((f) => (
          <span class="arch-pill" key={f.field}>
            {f.field} {f.count.toLocaleString()}
          </span>
        ))}
      />

      <SectionHead icon="search" title="Pick a track for the three-source view">
        <span class="sect-n">{picked ? "1" : "0"}</span>
      </SectionHead>
      <TrackPickSearch
        query={filter}
        onQuery={setFilter}
        hits={search.status === "ok" ? search.data : null}
        hitsStatus={search.status}
        placeholder="Search a track to audit its tags (title or artist)…"
        emptyNote={`no tracks match “${filter.trim()}”`}
        onPick={(t) => {
          setPicked(t);
          setOpenRow(null);
        }}
      />
      {picked && <CompareCard compare={compare} picked={picked} />}

      <SectionHead icon="sort" title="Mirror census — disagreements first">
        <span class="sect-n">{rows.length}</span>
      </SectionHead>
      <div class="pl-tools">
        <div class="seg">
          {(
            [
              ["diff", "Disagreements"],
              ["genre", "Genre diffs"],
              ["flag", "Disputed flags"],
              ["all", "All matched"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              class={censusFilter === id ? "on" : ""}
              onClick={() => setCensusFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div class="card">
        <DataTable
          columns={[
            {
              key: "track",
              head: "track",
              grow: 1.8,
              cell: (r) => (
                <button
                  type="button"
                  class="kvrow-btn"
                  style="all: unset; cursor: pointer; display: flex; gap: 4px; align-items: baseline;"
                  onClick={() => pickRow(r)}
                >
                  <Icon
                    name={openRow === r.videoId ? "chevD" : "chevronR"}
                    size={12}
                  />
                  <b>{r.title ?? r.videoId}</b>
                  {r.artist && <span class="dt-sub"> — {r.artist}</span>}
                </button>
              ),
              sortValue: (r) => (r.title ?? r.videoId).toLowerCase(),
            },
            {
              key: "archive_genre",
              head: "FullTags genre",
              min: 110,
              cell: (r) => show(r.archiveGenre),
              sortValue: (r) => r.archiveGenre ?? "",
            },
            {
              key: "rb_genre",
              head: "RB genre",
              min: 110,
              cell: (r) => show(r.rekordboxGenre),
              sortValue: (r) => r.rekordboxGenre ?? "",
            },
            {
              key: "key",
              head: "key",
              min: 70,
              cell: (r) =>
                r.archiveKey === r.rekordboxKey ? (
                  show(r.archiveKey)
                ) : (
                  <span class="arch-pill warn">
                    {show(r.archiveKey)} / {show(r.rekordboxKey)}
                  </span>
                ),
              sortValue: (r) => r.archiveKey ?? "",
            },
            {
              key: "bpm",
              head: "bpm",
              align: "end",
              min: 90,
              cell: (r) =>
                r.archiveBpm !== null && r.rekordboxBpm !== null
                  ? `${Math.round(r.archiveBpm)} / ${Math.round(r.rekordboxBpm)}`
                  : show(r.archiveBpm ?? r.rekordboxBpm),
              sortValue: (r) => r.archiveBpm ?? 0,
            },
            {
              key: "differs",
              head: "diffs",
              min: 70,
              align: "end",
              cell: (r) =>
                r.differs.length > 0 ? (
                  <span class={diffPill(true)}>{r.differs.length}</span>
                ) : (
                  <span class={diffPill(false)}>ok</span>
                ),
              sortValue: (r) => r.differs.length,
            },
            {
              key: "flag",
              head: "flag",
              min: 80,
              cell: (r) =>
                r.genreFlag ? (
                  <span class="arch-pill warn">{r.genreFlag}</span>
                ) : (
                  ""
                ),
              sortValue: (r) => r.genreFlag ?? "",
            },
          ]}
          rows={rows}
          cap={60}
          ariaLabel="Tag mirror census"
          copyName="Tag mirror census"
          copyLines={(rs) =>
            rs.map(
              (r) =>
                `${r.title ?? r.videoId}${r.artist ? ` — ${r.artist}` : ""} · FullTags=${show(r.archiveGenre)} RB=${show(r.rekordboxGenre)} · differs: ${r.differs.join(",") || "none"}${r.genreFlag ? ` · ${r.genreFlag}` : ""}`,
            )
          }
        />
      </div>
      {openRow && <CompareInline videoId={openRow} />}
    </div>
  );
}

/** The expanded census row's compact compare — same card, inline. */
function CompareInline(props: { videoId: string }) {
  const compare = useFetched<ArchiveTrackTagCompare>(
    () =>
      api<ArchiveTrackTagCompare>(
        `/api/archive/tag-compare?id=${encodeURIComponent(props.videoId)}`,
      ),
    [props.videoId],
  );
  return (
    <CompareCard
      compare={compare}
      picked={{ video_id: props.videoId, title: null, artist: null }}
    />
  );
}

/** The three-source comparison card (shared by search-pick + census rows).
 *  Each source row is a small component; the card is just the frame. */
export function CompareCard(props: {
  compare: Fetched<ArchiveTrackTagCompare>;
  picked: TrackPick;
}) {
  const { compare, picked } = props;
  if (compare.status !== "ok")
    return (
      <Card>
        <FetchedGate
          page={compare}
          loading={`reading the file tags for ${picked.title ?? picked.video_id}…`}
        />
      </Card>
    );
  const t = compare.data;
  return (
    <Card>
      <ListHead
        icon="tag"
        title={`Three sources — ${t.title ?? picked.video_id}`}
        n={t.differences.length}
        hint="FILE is ground truth (read live at request time); ARCHIVE is the enrichment mirror (FullTags columns + ledgers); REKORDBOX is the rb-adopt import of master.db's Content row. Fields listed in Differences have ≥2 sources disagreeing."
        lines={
          t.differences.length
            ? t.differences.map(
                (d) =>
                  `${d.field}: file=${show(d.file)} archive=${show(d.archive)} rb=${show(d.rekordbox)}`,
              )
            : ["all sources agree (or only one has a value)"]
        }
      />
      <KVRows>
        <GenreRow t={t} />
        <KeyRow t={t} />
        <BpmRow t={t} />
        <YearLabelRow t={t} />
        <MoodRow t={t} />
        <ArtRow t={t} />
        <CommentRow t={t} />
      </KVRows>
      {t.file === null && (
        <div class="arch-fix">
          file not readable at its archived path — the mirror columns above are
          uncorrected; <code>megadj adopt --shelf</code> repoints moved rows.
        </div>
      )}
      {t.rekordbox && (
        <details class="rb-meta">
          <summary>
            full rekordbox payload ({Object.keys(t.rekordbox.metadata).length}{" "}
            fields)
          </summary>
          <pre class="rb-meta-pre">
            {JSON.stringify(t.rekordbox.metadata, null, 1)}
          </pre>
        </details>
      )}
    </Card>
  );
}

type CompareData = ArchiveTrackTagCompare;

/** genre row — the one source pair with a diff pill (casefolded). */
function GenreRow({ t }: { t: CompareData }) {
  return (
    <KVRow key="genre">
      <KVKey>genre</KVKey>
      <KVVal>
        <span
          class={diffPill(
            t.file?.genre != null &&
              t.pipeline.genre != null &&
              t.file.genre.trim().toLowerCase() !==
                t.pipeline.genre.trim().toLowerCase(),
          )}
        >
          file {show(t.file?.genre ?? null)}
        </span>{" "}
        <span class="arch-pill">{show(t.pipeline.genre)}</span>{" "}
        <span class="arch-pill">{show(t.rekordbox?.genre ?? null)}</span>
      </KVVal>
    </KVRow>
  );
}

/** key row — file / archive / rb. */
function KeyRow({ t }: { t: CompareData }) {
  return (
    <KVRow key="key">
      <KVKey>key</KVKey>
      <KVVal>
        file {show(t.file?.key ?? null)} · archive{" "}
        {show(t.pipeline.key ?? null)} · rb {show(t.rekordbox?.key ?? null)}
      </KVVal>
    </KVRow>
  );
}

/** bpm row — file / folded beats ledger / rb. */
function BpmRow({ t }: { t: CompareData }) {
  return (
    <KVRow key="bpm">
      <KVKey>bpm</KVKey>
      <KVVal>
        file {show(t.file?.bpm ?? null)} · ledger{" "}
        {show(t.pipeline.bpmFolded ?? null)} · rb{" "}
        {show(t.rekordbox?.bpm ?? null)}
      </KVVal>
    </KVRow>
  );
}

/** year/label row — file vs rb (the pipeline ledger carries neither). */
function YearLabelRow({ t }: { t: CompareData }) {
  return (
    <KVRow key="year">
      <KVKey>year / label</KVKey>
      <KVVal>
        file {show(t.file?.year ?? null)} / {show(t.file?.label ?? null)} · rb{" "}
        {show(t.rekordbox?.year ?? null)} / {show(t.rekordbox?.label ?? null)}
      </KVVal>
    </KVRow>
  );
}

/** mood/energy row — E/V/A from the pipeline ledger, file mood raw. */
function MoodRow({ t }: { t: CompareData }) {
  return (
    <KVRow key="mood">
      <KVKey>mood / energy</KVKey>
      <KVVal>
        E{show(t.pipeline.energy ?? t.file?.energy ?? null)}
        {t.pipeline.valence !== null && ` · V${t.pipeline.valence.toFixed(1)}`}
        {t.pipeline.arousal !== null && ` · A${t.pipeline.arousal.toFixed(1)}`}
        {t.file?.mood && <span class="dt-sub"> · TXXX:MOOD {t.file.mood}</span>}
      </KVVal>
    </KVRow>
  );
}

/** artwork row — file embed state only. */
function ArtRow({ t }: { t: CompareData }) {
  return (
    <KVRow key="art">
      <KVKey>artwork</KVKey>
      <KVVal>
        {t.file === null ? (
          "file unreadable"
        ) : t.file.art ? (
          <span class="arch-pill ok">embedded</span>
        ) : (
          <span class="arch-pill warn">missing on file</span>
        )}
      </KVVal>
    </KVRow>
  );
}

/** comment row — file preferred, rb fallback. */
function CommentRow({ t }: { t: CompareData }) {
  return (
    <KVRow key="comment">
      <KVKey>comment</KVKey>
      <KVVal>
        <span class="dt-sub">
          {show(t.file?.comment ?? t.rekordbox?.comment ?? null)}
        </span>
      </KVVal>
    </KVRow>
  );
}
