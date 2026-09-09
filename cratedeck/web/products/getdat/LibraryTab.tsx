// LibraryTab.tsx — GetDat's Library tab, extracted from GetDatPage.tsx
// (file-length guard): what's in the archive — searchable, with the
// enrichment state (genres, years, artwork provenance) and the physical
// profile (sizes, codecs) of the playable files. Read-only over the
// archive DB's own columns; the files are ground truth.
import { useCallback, useState } from "preact/hooks";
import type { ArchiveLibraryOverview } from "../../../shared/types";
import type { ArchiveIngestStatus } from "../../../shared/types";
import { errMessage, fmtBytes, timeAgo } from "../../../shared/fmt";
import { api } from "../../ui/toast";
import { Icon } from "../../ui/icons";
import { FetchedGate, useFetched } from "../../ui/useFetched";
import { TabIntro } from "../../ui/InfoTip";
import {
  ListHead,
  BarList,
  KVRows,
  KVRow,
  KVKey,
  KVVal,
  Truncated,
  DataTable,
} from "../../ui/data";
import { StatCard } from "../../ui/DrivePanels";
import { SectionHead, ShareBar, Verdict, TrackTitle } from "../shared";
import { STATUS_LANG } from "../shared";

type Track = ArchiveIngestStatus["recent_tracks"][number];

/** Art-ladder rung → human phrasing (provenance embedded in the
 *  artwork_status stamp, e.g. "embedded:sc-page-1080"). */
function artLang(status: string | null): string {
  if (!status) return "no art stamp";
  if (status === "queued") return "AI art queue";
  if (!status.startsWith("embedded:")) return status;
  const rung = status.slice("embedded:".length);
  const langs: Record<string, string> = {
    sc: "SoundCloud search",
    "sc-page": "SoundCloud page",
    "sc-page-1080": "SoundCloud page (1080)",
    "sc-pack": "SoundCloud pack",
    itunes: "iTunes",
    deezer: "Deezer",
    caa: "Cover Art Archive",
    soundcloud: "SoundCloud",
    "mp3-twin-zip": "mp3 twin (zip)",
    "ai-generated": "AI-generated",
  };
  return `art: ${langs[rung] ?? rung}`;
}

export function LibraryTab() {
  const page = useFetched<ArchiveLibraryOverview>(
    () => api<ArchiveLibraryOverview>("/api/archive/library"),
    [],
  );
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Track[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);

  const lookup = useCallback(async (query: string) => {
    setSearching(true);
    setSearchErr(null);
    try {
      setHits(
        (await api<Track[]>(
          `/api/archive/search?q=${encodeURIComponent(query)}`,
        )) as Track[],
      );
    } catch (e) {
      setSearchErr(errMessage(e));
    } finally {
      setSearching(false);
    }
  }, []);

  if (page.status !== "ok")
    return <FetchedGate page={page} loading="loading library…" />;
  const lib = page.data;
  if (!lib.available)
    return (
      <div class="note-card">
        <Icon name="folder" size={20} /> archive DB absent — megadj hasn't run
        on this machine yet.
      </div>
    );

  return (
    <div>
      <TabIntro
        what="What's in the archive: size, genres, years, artwork provenance — and a search box."
        how="The stat cards are the physical library (files, bytes, codecs). The genre/year/artwork cards are the enrichment state megadj's ingest + fetch passes maintain. Search hits every artist/title/album/file path."
        next="Tags & analysis per track live on the FullTags product; this tab is the archive itself."
      />
      <Verdict
        cls="ok"
        text={`${lib.tracks.toLocaleString()} playable tracks · ${fmtBytes(lib.sizes.total_bytes)} on disk.`}
        meta={`${lib.years.known} year-stamped · ${lib.energy.stamped} energy-stamped`}
      />

      <div class="statgrid">
        <StatCard
          v={lib.tracks.toLocaleString()}
          l="playable tracks"
          icon="disc"
        />
        <StatCard
          v={fmtBytes(lib.sizes.total_bytes)}
          l="audio on disk"
          icon="folder"
        />
        <StatCard
          v={`${lib.years.known}/${lib.tracks}`}
          l="tracks with a release year"
          icon="clock"
        />
        <StatCard
          v={`${lib.energy.stamped}/${lib.tracks}`}
          l="tracks with an energy stamp"
          icon="bolt"
        />
      </div>

      <div class="archive-cols">
        <div class="card">
          <ListHead
            icon="hash"
            title="Genres"
            n={lib.genres.length}
            hint="Genre distribution across the playable archive — filled by the ingest genre inference + the MB harvest. The fix for a thin-looking map is `megadj fetch` / `megadj enrich`."
            lines={lib.genres.map((g) => `${g.name}: ${g.count}`)}
          />
          <GenreBars rows={lib.genres} />
        </div>
        <div class="card">
          <ListHead
            icon="clock"
            title="Years"
            n={lib.years.known}
            hint="Release-year coverage. The year is THIS file's version (a 2026 edit of a 2003 original stamps 2026). Unknown years are a `tools/fix_years.ts` pass."
            lines={[
              `known: ${lib.years.known}`,
              `unknown: ${lib.years.unknown}`,
              `range: ${lib.years.min ?? "—"} → ${lib.years.max ?? "—"}`,
            ]}
          />
          <KVRows>
            <KVRow>
              <KVKey>known</KVKey>
              <KVVal class="ok-text">{lib.years.known.toLocaleString()}</KVVal>
            </KVRow>
            <KVRow>
              <KVKey>unknown</KVKey>
              <KVVal class={lib.years.unknown ? "bad" : ""}>
                {lib.years.unknown.toLocaleString()}
              </KVVal>
            </KVRow>
            <KVRow>
              <KVKey>range</KVKey>
              <KVVal>
                {lib.years.min ?? "—"} → {lib.years.max ?? "—"}
              </KVVal>
            </KVRow>
          </KVRows>
          <div class="arch-fix">
            fix: <code>tools/fix_years.ts</code> verifies AI-guessed years
          </div>
        </div>
        <div class="card">
          <ListHead
            icon="photo"
            title="Artwork provenance"
            n={lib.tracks}
            hint="Where each track's embedded cover came from — the art ladder's rungs (SoundCloud page at 1080, Deezer, iTunes, Cover Art Archive, AI queue). Every track has art; the rung tells you its quality story."
            lines={[
              `embedded: ${lib.artwork.embedded}`,
              `queued for AI art: ${lib.artwork.queued}`,
            ]}
          />
          <ShareBar
            total={lib.tracks}
            segs={[
              {
                n: lib.artwork.embedded,
                cls: "have",
                label: "embedded cover",
                title: "cover art embedded from a ladder rung",
              },
              {
                n: lib.artwork.queued,
                cls: "waiting",
                label: "AI art queue",
                title: "waiting for generated art",
              },
            ]}
          />
          <div class="arch-fix">
            the ladder runs on <code>megadj fetch</code> — rungs above are its
            wins
          </div>
        </div>
        <div class="card">
          <ListHead
            icon="usb"
            title="Codecs"
            n={lib.codecs.length}
            hint="Container/codec mix of the playable files. pcm_* are WAVs (lossless — ingest converts new WAVs to AIFF for rekordbox art); mp3 are legacy downloads."
            lines={lib.codecs.map((c) => `${c.codec}: ${c.count}`)}
          />
          <ChipListLite
            rows={lib.codecs.map((c) => ({ name: c.codec, count: c.count }))}
          />
        </div>
      </div>

      <SectionHead icon="search" title="Search the archive" />
      <div class="pl-tools">
        <input
          placeholder="artist, title, album, or file path…"
          value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && q.trim().length >= 2) lookup(q.trim());
          }}
        />
        <button
          type="button"
          class="btn"
          disabled={q.trim().length < 2 || searching}
          onClick={() => lookup(q.trim())}
        >
          <Icon name="search" size={14} /> Search
        </button>
        {hits && (
          <button
            type="button"
            class="btn ghostbtn"
            onClick={() => {
              setHits(null);
              setQ("");
            }}
          >
            <Icon name="x" size={13} /> Clear
          </button>
        )}
      </div>
      {searchErr && (
        <div class="note bad">
          <Icon name="warn" size={14} /> Search failed: {searchErr}
        </div>
      )}
      {hits && (
        <div class="card">
          <ListHead
            icon="disc"
            title={`Matches for "${q.trim()}"`}
            n={hits.length}
            hint="Downloaded tracks matching the query across artist/title/album/path."
            lines={hits.map(
              (t) =>
                `${t.title ?? t.video_id}${t.artist ? ` — ${t.artist}` : ""} · ${t.file_path ?? "no file"}`,
            )}
          />
          {hits.length === 0 ? (
            <div class="fleet-note">nothing matches — try fewer words</div>
          ) : (
            <KVRows>
              {hits.slice(0, 40).map((t) => (
                <KVRow key={t.video_id}>
                  <KVKey>
                    <TrackTitle
                      title={t.title ?? t.video_id}
                      videoId={t.video_id}
                      artist={t.artist}
                    />
                  </KVKey>
                  <KVVal title={t.file_path ?? ""}>
                    {t.bitrate_kbps
                      ? `${t.bitrate_kbps} kbps ${t.codec ?? ""}`
                      : (t.codec ?? "")}
                  </KVVal>
                </KVRow>
              ))}
              {hits.length > 40 && <Truncated shown={40} total={hits.length} />}
            </KVRows>
          )}
        </div>
      )}

      <SectionHead icon="history" title="Recently updated">
        <span class="sect-n">{lib.recent.length}</span>
      </SectionHead>
      <div class="card">
        <ListHead
          icon="history"
          title="Freshest tag/ingest updates"
          n={lib.recent.length}
          hint="Newest by archive update time — recent ingests and enrichment passes surface here with their art rung. Filter to drill into an artist or status; pages keep the DOM small."
          lines={lib.recent.map(
            (t) =>
              `${t.title ?? t.video_id}${t.artist ? ` — ${t.artist}` : ""} [${STATUS_LANG[t.status] ?? t.status}] ${artLang(t.artwork_status)}`,
          )}
        />
        <DataTable
          columns={[
            {
              key: "track",
              head: "track",
              grow: 3,
              rowKey: (t) => t.video_id,
              cell: (t) => (
                <TrackTitle
                  title={t.title ?? t.video_id}
                  videoId={t.video_id}
                  artist={t.artist}
                />
              ),
              sortValue: (t) => (t.title ?? t.video_id).toLowerCase(),
            },
            {
              key: "year",
              head: "year",
              align: "end",
              min: 48,
              grow: 0,
              cell: (t) => t.year ?? "—",
              sortValue: (t) => t.year ?? null,
            },
            {
              key: "status",
              head: "status",
              min: 86,
              cell: (t) => STATUS_LANG[t.status] ?? t.status,
              sortValue: (t) => t.status,
            },
            {
              key: "art",
              head: "artwork",
              min: 110,
              cell: (t) => (
                <span title={t.artwork_status ?? ""}>
                  {artLang(t.artwork_status)}
                </span>
              ),
              sortValue: (t) => t.artwork_status ?? "",
            },
            {
              key: "updated",
              head: "updated",
              align: "end",
              min: 92,
              grow: 0,
              cell: (t) => (
                <span title={t.updated_at}>
                  {timeAgo(Date.parse(t.updated_at))}
                </span>
              ),
              sortValue: (t) => t.updated_at,
            },
          ]}
          rows={lib.recent}
          filterable
          paginate
          pageSize={15}
          copyName="Recently updated"
          copyLines={(rows) =>
            rows.map(
              (t) =>
                `${t.title ?? t.video_id}${t.artist ? ` — ${t.artist}` : ""} [${STATUS_LANG[t.status] ?? t.status}] ${artLang(t.artwork_status)}`,
            )
          }
          ariaLabel="Recently updated archive tracks"
        />
      </div>
    </div>
  );
}

function GenreBars(props: { rows: { name: string; count: number }[] }) {
  return (
    <BarList
      rows={props.rows.map((r) => ({
        key: r.name,
        name: r.name,
        value: r.count,
      }))}
      cap={10}
      empty={<div class="fleet-note">no genres yet — run `megadj fetch`</div>}
    />
  );
}

function ChipListLite(props: { rows: { name: string; count: number }[] }) {
  return (
    <BarList
      rows={props.rows.map((r) => ({
        key: r.name,
        name: r.name,
        value: r.count,
      }))}
    />
  );
}
