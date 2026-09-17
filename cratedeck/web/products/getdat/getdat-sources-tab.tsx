// getdat-sources-tab.tsx — the GetDat sources tab (#89/#90 diet
// extraction from getdat-tabs.tsx): ingest source census + the A/B
// source-compare diff lists.
import { useCallback, useState } from "preact/hooks";
import type {
  ArchiveIngestStatus,
  ArchiveSourceCensus,
} from "../../../shared/types";
import { errMessage } from "../../../shared/fmt";
import { api } from "../../ui/toast";
import { Icon } from "../../ui/icons";
import { FetchedGate, useFetched } from "../../ui/useFetched";
import { TabIntro } from "../../ui/InfoTip";
import { ListHead, KVRows, KVRow, KVKey, Truncated } from "../../ui/data";
import { ArchiveAbsentGate, Verdict, TrackTitle } from "../shared";

type Track = ArchiveIngestStatus["recent_tracks"][number];

export function SourcesTab() {
  const page = useFetched<[ArchiveIngestStatus, ArchiveSourceCensus]>(
    () =>
      Promise.all([
        api<ArchiveIngestStatus>("/api/archive/ingest-status"),
        api<ArchiveSourceCensus>("/api/archive/sources"),
      ]),
    [],
  );
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<{
    a: string;
    b: string;
    only_in_a: Track[];
    only_in_b: Track[];
    shared: number;
  } | null>(null);
  const [diffErr, setDiffErr] = useState<string | null>(null);

  const runDiff = useCallback(async () => {
    if (!a.trim() || !b.trim() || a.trim() === b.trim()) return;
    setBusy(true);
    setDiffErr(null);
    try {
      setDiff(
        (await api(
          `/api/archive/source-diff?a=${encodeURIComponent(a.trim())}&b=${encodeURIComponent(b.trim())}`,
        )) as NonNullable<typeof diff>,
      );
    } catch (e) {
      setDiffErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }, [a, b]);

  if (page.status !== "ok")
    return <FetchedGate page={page} loading="loading sources…" />;
  const [ingest, census] = page.data;
  if (!ingest.available) return <ArchiveAbsentGate />;
  const sources = census.available ? census.sources : [];
  return (
    <div>
      <TabIntro
        what="Where the archive's music comes from — and whether two sources drifted apart."
        how="Every archived track carries its source tag: the liked list, a YouTube playlist id, or an ingest run. The chips below are the real census (click one to fill the form); diff any two to see which tracks live in one but not the other — the classic case is 'my liked list vs the playlist I curated'."
        next="Drift is normal (you unlike things); the diff tells you what a re-sync would add or drop."
      />
      {sources.length > 0 && (
        <div class="card">
          <ListHead
            icon="compass"
            title="Source tags in the archive"
            n={sources.length}
            hint="Every source tag with its total and playable (downloaded) track counts. Click a chip to drop it into the diff form — 'playable' is what can actually be mixed; the gap is the source's history (gone/skipped/pending)."
            lines={sources.map(
              (s) => `${s.source}: ${s.tracks} tracked, ${s.playable} playable`,
            )}
          />
          <div class="src-chips">
            {sources.map((s) => (
              <button
                type="button"
                class="src-chip"
                key={s.source}
                title={`${s.playable} playable of ${s.tracks} tracked — click to fill the form`}
                onClick={() => {
                  if (!a.trim()) setA(s.source);
                  else if (!b.trim()) setB(s.source);
                }}
              >
                {s.source}
                <span class="src-chip-n">{s.playable}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div class="pl-tools">
        <input
          placeholder="source A (e.g. liked)"
          value={a}
          onInput={(e) => setA((e.target as HTMLInputElement).value)}
        />
        <span class="diff-arrow">→</span>
        <input
          placeholder="source B (e.g. PLxxxx…)"
          value={b}
          onInput={(e) => setB((e.target as HTMLInputElement).value)}
        />
        <button
          type="button"
          class="btn primary"
          disabled={busy || !a.trim() || !b.trim()}
          onClick={runDiff}
        >
          <Icon name="sort" size={14} /> {busy ? "Diffing…" : "Diff sources"}
        </button>
      </div>
      {diffErr && (
        <div class="note bad">
          <Icon name="warn" size={14} /> Source diff failed: {diffErr}
        </div>
      )}
      {diff && (
        <>
          <Verdict
            cls="ok"
            text={`${diff.only_in_a.length} only in "${diff.a}" · ${diff.only_in_b.length} only in "${diff.b}" · ${diff.shared} shared.`}
          />
          <div class="archive-cols">
            <DiffList
              title={`only in ${diff.a}`}
              rows={diff.only_in_a}
              empty="none — b has everything a has"
            />
            <DiffList
              title={`only in ${diff.b}`}
              rows={diff.only_in_b}
              empty="none — a has everything b has"
            />
          </div>
        </>
      )}
      {!diff && !diffErr && (
        <div class="note-card">
          <Icon name="compass" size={20} />
          Diff two source tags — e.g. <code>liked</code> vs a playlist id (
          <code>PL…</code>) or <code>ingest</code>.
        </div>
      )}
    </div>
  );
}

function DiffList(props: { title: string; rows: Track[]; empty: string }) {
  return (
    <div class="card">
      <ListHead
        icon="disc"
        title={props.title}
        n={props.rows.length}
        hint={`Tracks present in only one of the two sources. Copy hands the list to an agent.`}
        lines={
          props.rows.length
            ? props.rows.map(
                (t) =>
                  `${t.title ?? t.video_id}${t.artist ? ` — ${t.artist}` : ""}`,
              )
            : undefined
        }
      />
      {!props.rows.length ? (
        <div class="fleet-note">{props.empty}</div>
      ) : (
        <KVRows>
          {props.rows.slice(0, 25).map((t) => (
            <KVRow key={t.video_id}>
              <KVKey>
                <TrackTitle
                  title={t.title ?? t.video_id}
                  videoId={t.video_id}
                  artist={t.artist}
                />
              </KVKey>
            </KVRow>
          ))}
          {props.rows.length > 25 && (
            <Truncated shown={25} total={props.rows.length} full={false} />
          )}
        </KVRows>
      )}
    </div>
  );
}
