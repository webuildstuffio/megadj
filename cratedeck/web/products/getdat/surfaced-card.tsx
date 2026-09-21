// surfaced-card.tsx — the #256 surfaced-link workflow card, extracted from
// getdat-tabs.tsx when it crossed the file-length cap (Sep 21). ONE
// component for the surfaced cohort on both GetDat tabs that show it
// (Pipeline = the ledger view; Backlog = the "yours to click" work view):
// same rows, same wire (ArchiveIngestStatus.surfaced), same rendering —
// only the framing text changes per context. Includes ScSetsStrip (the
// playlists-to-go-through census strip) and the per-row set chips.
import { useState } from "preact/hooks";
import { apiPost, toast } from "../../ui/toast";
import { navigateProduct } from "../../app/router";
import { ListHead, KVRows, KVRow, KVKey, KVVal } from "../../ui/data";
import { TrackTitle } from "../shared";
import type { ArchiveIngestStatus } from "../../../shared/types";

/** The user's four SoundCloud playlists (Sep 21): pre-listed as the
 *  sets-to-go-through. The LEDGER (sc_sets census) owns the DATA — this
 *  map only restores each slug's full URL so the strip can link out;
 *  a ledger set without a URL here still renders (slug + counts). */
const SC_SET_URLS: Record<string, string> = {
  "mmw-2026": "https://soundcloud.com/parvati-rajesh/sets/mmw-2026",
  "summer-2025": "https://soundcloud.com/parvati-rajesh/sets/summer-2025",
  "winter-2026": "https://soundcloud.com/parvati-rajesh/sets/winter-2026",
  "summer-2026": "https://soundcloud.com/parvati-rajesh/sets/summer-2026",
};

/** SurfacedLinksCard — ONE component for the #256 surfaced-link cohort on
 *  both GetDat tabs that show it (Pipeline = the ledger view; Backlog =
 *  the "yours to click" work view). Same rows, same wire
 *  (ArchiveIngestStatus.surfaced), same rendering — only the framing text
 *  changes per context. Extracted when the two hand-rolled copies started
 *  drifting (the DRY rule that bit the route table, Sep 17). */
/** "mmw-2026" from the ledger's "soundcloud:mmw-2026" set label (module
 *  scope — pure). The chip's short text; the strip carries the URL. */
function setDisplayName(source: string): string {
  return source.slice("soundcloud:".length);
}

/** ScSetsStrip — the playlists-to-go-through (Sep 21). DATA comes from
 *  the ledger census (ArchiveIngestStatus.sc_sets): every scraped
 *  `soundcloud:<slug>` set with its row decomposition. SC_SET_URLS only
 *  restores each slug's full URL for the outbound link; a set without a
 *  known URL still renders its progress honestly. Progress = handled
 *  (downloaded) vs open work (surfaced) vs dead (gone) vs queued. */
export function ScSetsStrip(props: { sets: ArchiveIngestStatus["sc_sets"] }) {
  if (props.sets.length === 0) return null;
  return (
    <div class="sc-sets">
      <span class="dt-sub">playlists being gone through:</span>
      {props.sets.map((s) => {
        const url = SC_SET_URLS[s.slug];
        const handled = s.downloaded;
        return (
          <div class="sc-set-row" key={s.slug}>
            <b>{s.slug}</b>
            <span class="sc-set-progress">
              <i class="have">{handled}</i> in archive ·{" "}
              <i class="surf">{s.surfaced}</i> links open ·{" "}
              <i class="gone">{s.gone}</i> gone · {s.pending} queued —{" "}
              {handled + s.surfaced + s.gone + s.pending} of {s.total} tracked
            </span>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-sm surfaced-link"
              >
                open set ↗
              </a>
            )}
            {s.surfaced > 0 && (
              <span class="dt-sub">
                work the {s.surfaced} link{s.surfaced === 1 ? "" : "s"} below
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Clickable acquisition links for one surfaced row (module scope — pure
 *  render, nothing captured). Bare URL, no "purchase_url" label. */
function renderLinks(s: ArchiveIngestStatus["surfaced"][number]) {
  if (s.links.length === 0) return <span class="dt-sub">link available</span>;
  return (
    <span class="surfaced-links">
      {s.links.map((l) => (
        <a
          key={l.url}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          class="btn btn-sm surfaced-link"
        >
          {l.url.replace(/^https?:\/\//, "")} ↗
        </a>
      ))}
    </span>
  );
}

export function SurfacedLinksCard(props: {
  rows: ArchiveIngestStatus["surfaced"];
  context: "ledger" | "backlog";
  onChanged?: () => void;
  /** The per-set census (Pipeline passes ingest.sc_sets) — renders the
   *  playlists-to-go-through strip. Optional: tests pass rows only. */
  sets?: ArchiveIngestStatus["sc_sets"];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  // Pagination (Sep 21): the cohort hit 70 rows — the old cap-50 slice
  // silently hid the rest. 25/page, open rows first (the producer's
  // ORDER BY), full list reachable.
  const PAGE_SIZE = 25;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(props.rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedRows = props.rows.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE,
  );
  const scSets = props.sets ?? [];
  // Default batch folder: the user's real downloads home (the intake
  // watch dir, ~/Music/Downloads — editable to wherever the saved files
  // actually sit). Plain literal: the browser bundle has no process.env,
  // and the route validates the path.
  const [folder, setFolder] = useState("/Users/nick/Music/Downloads");
  const n = props.rows.length;
  const doneCount = props.rows.filter((r) => r.done).length;
  const openRows = props.rows.filter((r) => !r.done);
  const copy = {
    ledger: {
      title: "Surfaced links — go through them instead of ripping",
      hint: "These tracks advertise an official purchase or free-download link, so megadj skipped the rip and parked the URL here (--force-rip overrides, per drop). Surfaced rows are never counted as downloaded library.",
    },
    backlog: {
      title: "Links surfaced — yours to click",
      hint: "No code fixes these: the track advertises an official download/purchase link, the rip was skipped on purpose. Click through, save the file, check it off, then run the batch to fulltags-process everything you saved.",
    },
  }[props.context];
  const setDone = async (videoId: string, done: boolean) => {
    setBusy(videoId);
    try {
      await apiPost(`/api/archive/surfaced-note`, { id: videoId, done });
      props.onChanged?.();
    } finally {
      setBusy(null);
    }
  };
  const finalizeBatch = async () => {
    setBatchBusy(true);
    try {
      // Job-based now: the route enqueues the intake job and returns at
      // once — no 600s client deadline, progress/cancel live in the dock.
      const batch = await apiPost<{
        ok: boolean;
        jobId?: string;
        submitted: number;
      }>(
        `/api/archive/surfaced-batch`,
        {
          folder,
          ids: props.rows.filter((row) => row.done).map((row) => row.video_id),
        },
        { timeoutMs: 30_000 },
      );
      if (batch.jobId)
        toast(
          `Processing ${batch.submitted} saved file${batch.submitted === 1 ? "" : "s"} — job ${batch.jobId.slice(0, 8)}`,
          "ok",
        );
      navigateProduct("getdat", "intake");
      props.onChanged?.();
    } catch (e: unknown) {
      toast(
        `batch refused: ${e instanceof Error ? e.message : String(e)}`,
        "err",
      );
    } finally {
      setBatchBusy(false);
    }
  };
  return (
    <div class="card">
      <ListHead
        icon="compass"
        title={copy.title}
        n={n}
        hint={copy.hint}
        lines={[
          `${doneCount} checked off · ${openRows.length} open`,
          ...props.rows
            .slice(0, 3)
            .map((s) => `${s.title ?? s.video_id} — ${s.url ?? "link"}`),
        ]}
      />
      <ScSetsStrip sets={scSets} />
      <KVRows>
        {pagedRows.map((s) => (
          <KVRow key={s.video_id} class={s.done ? "surfaced-done" : ""}>
            <KVKey>
              <label class="surfaced-check">
                <input
                  type="checkbox"
                  checked={s.done}
                  disabled={busy === s.video_id}
                  onChange={(e) =>
                    setDone(s.video_id, (e.target as HTMLInputElement).checked)
                  }
                />
                <TrackTitle
                  title={s.title}
                  videoId={s.video_id}
                  artist={s.artist}
                />
                {s.source.startsWith("soundcloud:") && (
                  <span
                    class="surfaced-src"
                    title={`from the ${setDisplayName(s.source)} SoundCloud set`}
                  >
                    {setDisplayName(s.source)}
                  </span>
                )}
              </label>
            </KVKey>
            <KVVal>{renderLinks(s)}</KVVal>
          </KVRow>
        ))}
      </KVRows>
      {pageCount > 1 && (
        <div class="surfaced-pager">
          <button
            class="btn sm"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            ← prev
          </button>
          <span>
            page {page + 1} / {pageCount} · {n} rows
          </span>
          <button
            class="btn sm"
            disabled={page >= pageCount - 1}
            onClick={() => setPage(page + 1)}
          >
            next →
          </button>
        </div>
      )}
      {props.context === "backlog" && doneCount > 0 && (
        <div class="surfaced-batch">
          <label class="surfaced-folder">
            batch folder
            <input
              type="text"
              value={folder}
              onInput={(e) => setFolder((e.target as HTMLInputElement).value)}
            />
          </label>
          <button
            class="btn primary"
            disabled={batchBusy}
            onClick={() => void finalizeBatch()}
          >
            {batchBusy
              ? "processing…"
              : `Fulltags-process ${doneCount} saved file${doneCount === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
      <div class="arch-fix">
        click a link → save the file into the downloads folder → check it off →
        run the batch. Ledger: <code>megadj surfaced-note &lt;id&gt;</code>
      </div>
    </div>
  );
}
