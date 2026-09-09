// DrivePanels.tsx — presentational panels used by DrivePage: health-check
// rows, space/extension/age visualizations, DJ analytics. Pure props → JSX;
// no fetching, no polling.
import { useState } from "preact/hooks";
import type { HealthCheck, SnapshotData } from "../../shared/types";
import { fmtBytes, fmtDur } from "../../shared/fmt";
import { Icon } from "./icons";
import { InfoTip } from "./InfoTip";

/** Two-step destructive-action button: first click arms it ("Sure?"), a
 *  second click within 3s fires, clicking away disarms. Kills accidental
 *  data loss without a modal. */
export function ConfirmButton(props: {
  label: string;
  confirmLabel?: string;
  hint?: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      class={`btn danger sm ${armed ? "armed" : ""}`}
      title={props.hint}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (armed) {
          setArmed(false);
          props.onConfirm();
        } else {
          setArmed(true);
          setTimeout(() => setArmed(false), 3000);
        }
      }}
    >
      <Icon name="trash" size={13} />{" "}
      {armed ? (props.confirmLabel ?? "Sure? Click again") : props.label}
    </button>
  );
}

/** What each Overview check id means, for the hover explainer on its row.
 *  Keys mirror the ids report.ts emits; unknown ids fall back to a generic
 *  line (the row still shows its measured detail). */
const CHECK_WHY: Record<string, { what: string; why: string }> = {
  "dual-db": {
    what: "Compares the two rekordbox libraries every drive carries.",
    why: "Hardware players (CDJs, XDJ-XZ) only read the legacy one — drift means the booth sees an older library than your laptop.",
  },
  grids: {
    what: "Checks each track's analysis file (waveform + beatgrid) sits at the hashed path hardware looks up.",
    why: "Missing ANLZ = no waveform and no Beat Sync on that track, exactly when you reach for it.",
  },
  verify: {
    what: "How recent and how clean the last deep audit was.",
    why: "Data changes after verify go unproven — the weekly auto-verify keeps this fresh.",
  },
  bitrot: {
    what: "Compares every audio file's hash against the corruption ledger.",
    why: "Silent decay is invisible until the track fails mid-set; this is the only early warning.",
  },
  junk: {
    what: "Scans for zero-byte files, case-collision paths and orphan resource forks.",
    why: "Exactly the junk that crashes older CDJ firmware or double-counts tracks.",
  },
  space: {
    what: "Free space against capacity.",
    why: "rekordbox needs headroom for its DB journal — a full drive corrupts exports.",
  },
  dupes: {
    what: "Paths differing only by letter case — the same file twice on FAT32.",
    why: "rekordbox may count both while the player sees one; dedupe keeps counts honest.",
  },
  artwork: {
    what: "Share of tracks with embedded artwork.",
    why: "The booth browser shows blank tiles without it — cosmetic, but it slows you down.",
  },
  mirror: {
    what: "This mirror's file count against the master's.",
    why: "A behind mirror isn't a backup — converge it before you need it.",
  },
  speed: {
    what: "Last measured sequential read speed.",
    why: "Below ~30 MB/s a CDJ can stutter on high-bitrate files — replace the stick before a gig.",
  },
};

export function CheckRow({ c }: { c: HealthCheck }) {
  const why = CHECK_WHY[c.id];
  return (
    <div class={`check ${c.status}`}>
      <span class="check-ico">
        <Icon
          name={
            c.status === "pass"
              ? "check"
              : c.status === "unknown"
                ? "dot"
                : "warn"
          }
          size={12}
        />
      </span>
      <span class="check-body">
        <b>
          {c.label}
          {why && (
            <InfoTip
              title={c.label}
              body={why.what}
              why={why.why}
              align="right"
            />
          )}
        </b>
        <span class="check-detail">{c.detail}</span>
        {c.fix && c.status !== "pass" && (
          <span class="check-fix">
            <Icon name="bolt" size={11} /> {c.fix}
          </span>
        )}
      </span>
    </div>
  );
}

export function SpaceBar({ snap }: { snap: SnapshotData }) {
  const cap = snap.capacity_bytes;
  const free = snap.free_bytes ?? null;
  // DrivePage gates this panel on capacity being measured, but free_bytes can
  // be null (statfs failure) — fabricating 0 would draw a "drive full" bar
  // from unknown data, so unknown stays explicit.
  if (!cap || free === null) {
    return (
      <div class="spacewrap">
        <div class="spacelegend">
          <span>usage unknown — scan didn't measure free space</span>
          <span>
            <b>{cap ? fmtBytes(cap) : "—"}</b> total
          </span>
        </div>
      </div>
    );
  }
  const used = Math.max(0, cap - free);
  const usedPct = (used / cap) * 100;
  return (
    <div
      class="spacewrap"
      title="Used vs free vs total. Keep ≥15% free — rekordbox needs headroom for its database journal and analysis files."
    >
      <div class="bar">
        <i
          class={usedPct > 85 ? "hot" : ""}
          style={{ width: `${Math.min(100, usedPct)}%` }}
        />
      </div>
      <div class="spacelegend">
        <span>
          <b>{fmtBytes(used)}</b> used ({Math.round(usedPct)}%)
        </span>
        <span>
          <b>{fmtBytes(free)}</b> free
        </span>
        <span>{fmtBytes(cap)} total</span>
      </div>
    </div>
  );
}

export function ExtBars({ snap }: { snap: SnapshotData }) {
  const byExt = snap.by_ext;
  if (!byExt?.length) return null;
  // `|| 1` also covers a leading all-zero-byte extension (NaN width guard)
  const max = byExt[0]?.bytes || 1;
  const total = byExt.reduce((s, e) => s + e.bytes, 0);
  return (
    <div
      class="extbars"
      title="Bytes on disk by file extension — audio formats vs artwork, DB and system files. '._' entries are macOS resource forks (junk)."
    >
      {byExt.slice(0, 8).map((e) => (
        <div
          class="extrow"
          key={e.ext}
          title={`${Math.round((e.bytes / (total || 1)) * 100)}% of bytes`}
        >
          <span class="ext">{e.ext}</span>
          <span class="extbar">
            <i style={{ width: `${Math.max(2, (e.bytes / max) * 100)}%` }} />
          </span>
          <span class="extn">
            {fmtBytes(e.bytes)} · {e.files}
          </span>
        </div>
      ))}
    </div>
  );
}

export function AgeStrip({ snap }: { snap: SnapshotData }) {
  const age = snap.age!;
  return (
    <div
      class="agestrip"
      title="How old the audio is, by file modified date. A stick that's all 'ancient' may be overdue for new music; a mixed profile is normal."
    >
      {(
        [
          ["fresh", "< 30d"],
          ["recent", "30–180d"],
          ["old", "180d–2y"],
          ["ancient", "> 2y"],
        ] as const
      ).map(([k, label]) => (
        <span class="agecell" key={k} title={label}>
          <b>{age[k]}</b>
          {label}
        </span>
      ))}
    </div>
  );
}

export function DjPanel({ dj }: { dj: NonNullable<SnapshotData["dj"]> }) {
  return (
    <>
      <h3 class="sect">
        <Icon name="disc" /> DJ library
        <InfoTip
          title="DJ library analytics"
          body="Live stats read straight out of the drive's rekordbox database — BPMs, keys, genres, bitrates, artwork coverage. They update on every scan."
          why="Use BPM range + keys to sanity-check that this stick matches how you actually play."
          align="right"
        />
      </h3>
      <div class="statgrid">
        <StatCard
          v={
            dj.bpm_min
              ? `${Math.round(dj.bpm_min)}–${Math.round(dj.bpm_max ?? 0)}`
              : "—"
          }
          l="BPM range"
          icon="pulse"
          title="Slowest to fastest track BPM in the library, from rekordbox analysis. Empty means tracks aren't analyzed yet."
        />
        <StatCard
          v={dj.bpm_median ? `${dj.bpm_median}` : "—"}
          l="BPM median"
          icon="pulse"
          title="The middle of the library's BPM distribution — the 'home tempo' this stick lives at."
        />
        <StatCard
          v={
            dj.duration && dj.duration.median_s
              ? fmtDur(dj.duration.median_s)
              : "—"
          }
          l="median track length"
          icon="clock"
          title="Half the library is shorter, half longer. Useful for planning set blocks."
        />
        <StatCard
          v={
            dj.duration && dj.duration.longest_s
              ? fmtDur(dj.duration.longest_s)
              : "—"
          }
          l="longest track"
          icon="clock"
          title="The marathon in the crate — longer tracks need reliable beatgrids to mix out of."
        />
      </div>
      {!!dj.bpm_histogram?.length && (
        <div
          class="bpmhist"
          title="Tracks per 10-BPM bucket — the shape of your library's tempo. Hover a bar for the exact count."
        >
          {(() => {
            const max = Math.max(...dj.bpm_histogram.map((x) => x.count));
            return dj.bpm_histogram.map((b) => (
              <div
                class="bpmcol"
                key={b.bucket}
                title={`${b.bucket} BPM: ${b.count} tracks`}
              >
                <i style={{ height: `${(b.count / max) * 100}%` }} />
              </div>
            ));
          })()}
        </div>
      )}
      {!!dj.genres?.length && <Bars title="Genres" rows={dj.genres} />}
      {!!dj.keys?.length && (
        <Bars
          title="Keys"
          rows={dj.keys}
          tip="Harmonic mixing fuel — Camelot/Open Key notation from rekordbox analysis. Adjacent keys mix cleanest."
        />
      )}
      {!!dj.artists_top?.length && (
        <Bars title="Top artists" rows={dj.artists_top} />
      )}
      {dj.bitrate && (
        <div
          class="brstrip"
          title="Audio quality mix: lossless (AIFF/WAV/FLAC/ALAC) vs high-bitrate lossy vs everything else. 'unknown' rows usually predate analysis."
        >
          {(
            [
              ["lossless", dj.bitrate.lossless, "good"],
              ["≥256 kbps", dj.bitrate.lossy_high, "info"],
              ["<256 kbps", dj.bitrate.lossy, "warn"],
              ["unknown", dj.bitrate.unknown, "muted"],
            ] as const
          ).map(([label, n, tone]) => (
            <span class={`badge ${tone}`} key={label}>
              {label} {n}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

export function StatCard({
  v,
  l,
  icon,
  title,
}: {
  v: string;
  l: string;
  icon: string;
  title?: string;
}) {
  return (
    <div class="stat">
      <div class="v" title={title}>
        <Icon name={icon} size={13} /> {v}
      </div>
      <div class="l">{l}</div>
    </div>
  );
}

export function Bars({
  title,
  rows,
  tip,
}: {
  title: string;
  rows: { name: string; count: number }[];
  tip?: string;
}) {
  const total = rows.reduce((s, r) => s + r.count, 0) || 1;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <div>
      <h3 class="sect">
        {title} <span class="sect-n">{rows.length}</span>
        {tip && <InfoTip title={title} body={tip} align="right" />}
      </h3>
      {rows.slice(0, 8).map((r) => (
        <div class="barrow" key={r.name}>
          <span class="barname" title={r.name}>
            {r.name}
          </span>
          <span class="bartrack">
            <i style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span class="barn">{Math.round((r.count / total) * 100)}%</span>
        </div>
      ))}
    </div>
  );
}
