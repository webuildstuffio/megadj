// TagCompareRows.tsx — the three-source comparison card (#233 split
// from TagCompareTab.tsx): CompareCard (the frame) + the per-field KV
// rows (genre/key/bpm/year/mood/art/comment) + the inline census-row
// variant. TagCompareTab keeps the census table + the track picker.
import type { ArchiveTrackTagCompare } from "../../../shared/types";
import { api } from "../../ui/toast";
import { Card, ListHead, KVRows, KVRow, KVKey, KVVal } from "../../ui/data";
import { useFetched, FetchedGate, type Fetched } from "../../ui/useFetched";
import type { TrackPick } from "./TrackPickSearch";

/** Pill classes per comparison outcome. */
export const diffPill = (differ: boolean): string =>
  differ ? "arch-pill warn" : "arch-pill ok";

export const show = (v: string | number | null): string =>
  v === null || v === "" ? "—" : String(v);

type CompareData = ArchiveTrackTagCompare;

/** The expanded census row's compact compare — same card, inline. */
export function CompareInline(props: { videoId: string }) {
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

/** genre row — the one source pair with a diff pill (casefolded). */
function GenreRow({ t }: { t: CompareData }) {
  return (
    <KVRow key="genre">
      <KVKey>genre</KVKey>
      <KVVal>
        <span
          class={diffPill(
            t.file !== null &&
              t.file.genre !== null &&
              t.pipeline.genre !== null &&
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
