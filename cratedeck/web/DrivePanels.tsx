// DrivePanels.tsx — presentational panels used by DrivePage: health-check
// rows, space/extension/age visualizations, DJ analytics. Pure props → JSX;
// no fetching, no polling.
import type { HealthCheck, SnapshotData } from "../shared/types";
import { fmtBytes, fmtDur } from "../shared/fmt";
import { Icon } from "./icons";

export function CheckRow({ c }: { c: HealthCheck }) {
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
        <b>{c.label}</b>
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
  const cap = snap.capacity_bytes ?? 0;
  const used = Math.max(0, cap - (snap.free_bytes ?? 0));
  const usedPct = cap ? (used / cap) * 100 : 0;
  return (
    <div class="spacewrap">
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
          <b>
            {snap.free_bytes !== null && snap.free_bytes !== undefined
              ? fmtBytes(snap.free_bytes)
              : "—"}
          </b>{" "}
          free
        </span>
        <span>{fmtBytes(cap)} total</span>
      </div>
    </div>
  );
}

export function ExtBars({ snap }: { snap: SnapshotData }) {
  const byExt = snap.by_ext ?? [];
  const max = byExt[0]?.bytes ?? 1;
  const total = byExt.reduce((s, e) => s + e.bytes, 0);
  return (
    <div class="extbars">
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
    <div class="agestrip">
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
        />
        <StatCard
          v={dj.bpm_median ? `${dj.bpm_median}` : "—"}
          l="BPM median"
          icon="pulse"
        />
        <StatCard
          v={
            dj.duration && dj.duration.median_s
              ? fmtDur(dj.duration.median_s)
              : "—"
          }
          l="median track length"
          icon="clock"
        />
        <StatCard
          v={
            dj.duration && dj.duration.longest_s
              ? fmtDur(dj.duration.longest_s)
              : "—"
          }
          l="longest track"
          icon="clock"
        />
      </div>
      {!!dj.bpm_histogram?.length && (
        <div class="bpmhist" title="tracks per 10-BPM bucket">
          {dj.bpm_histogram.map((b) => {
            const max = Math.max(...dj.bpm_histogram!.map((x) => x.count));
            return (
              <div
                class="bpmcol"
                key={b.bucket}
                title={`${b.bucket} BPM: ${b.count}`}
              >
                <i style={{ height: `${(b.count / max) * 100}%` }} />
              </div>
            );
          })}
        </div>
      )}
      {!!dj.genres?.length && <Bars title="Genres" rows={dj.genres} />}
      {!!dj.keys?.length && <Bars title="Keys" rows={dj.keys} />}
      {!!dj.artists_top?.length && (
        <Bars title="Top artists" rows={dj.artists_top} />
      )}
      {dj.bitrate && (
        <div class="brstrip">
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
}: {
  v: string;
  l: string;
  icon: string;
}) {
  return (
    <div class="stat">
      <div class="v">
        <Icon name={icon} size={13} /> {v}
      </div>
      <div class="l">{l}</div>
    </div>
  );
}

export function Bars({
  title,
  rows,
}: {
  title: string;
  rows: { name: string; count: number }[];
}) {
  const total = rows.reduce((s, r) => s + r.count, 0) || 1;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <div>
      <h3 class="sect">
        {title} <span class="sect-n">{rows.length}</span>
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
