// HealthTab.tsx — hardware story: live stat cards, benchmark history as an
// SVG line chart (seq + random), identity serials, and folder composition
// with proportional bars.
//
// UX pass (Sep 8, same treatment as ArchiveTab/FleetPage): the tab leads
// with a verdict — is this stick gig-safe on speed? — against the CDJ
// floor (≥30 MB/s sequential; below that high-bitrate playback can
// stutter). The bench history is copyable so a dying-stick trend can be
// handed to an agent in one paste.
import type { Drive, SnapshotData } from "../shared/types";
import { fmtBytes, shortSerial } from "../shared/fmt";
import { Icon } from "./icons";
import { StatCard } from "./DrivePanels";
import { InfoTip, TabIntro } from "./InfoTip";
import { ListHead, FixNote } from "./ListHead";

// identical to DrivePage's local Bench — one shared shape (same producer)
type Bench = {
  ran_at: number;
  seq_mbps: number;
  rand4k_mbps: number;
};
export type HealthTabBench = Bench;

export function HealthTab(props: {
  drive: Drive;
  snap: SnapshotData | null;
  bench: HealthTabBench[];
}) {
  const { drive, snap, bench } = props;
  const last = bench.at(-1);
  // ---- the verdict: is this stick fast enough for the booth? ------------
  // CDJ floor: ~30 MB/s sequential (below that, playback can stutter on
  // high-bitrate files). ≥60 is comfortable, 30–59 usable, <30 replace it.
  const seq = last?.seq_mbps ?? null;
  const speed =
    seq === null
      ? null
      : seq >= 60
        ? {
            cls: "ok",
            label: "gig-safe",
            text: `Reads ${seq} MB/s sequential — comfortably above the 30 MB/s CDJ floor.`,
          }
        : seq >= 30
          ? {
              cls: "warn",
              label: "usable",
              text: `Reads ${seq} MB/s sequential — above the 30 MB/s floor, but not comfortably. Watch the trend.`,
            }
          : {
              cls: "warn",
              label: "too slow",
              text: `Reads only ${seq} MB/s sequential — below the 30 MB/s CDJ floor. High-bitrate playback can stutter; replace this stick.`,
            };
  // dying-stick signature: ~40% drop between the last two runs
  const prev = bench.at(-2);
  const drop =
    prev && seq && prev.seq_mbps > 0 && seq / prev.seq_mbps < 0.6
      ? Math.round((1 - seq / prev.seq_mbps) * 100)
      : 0;
  return (
    <div>
      <TabIntro
        what="Hardware, not library: is this stick fast enough and healthy?"
        how="The verdict banner answers the booth question — sequential read vs the 30 MB/s CDJ floor. The chart shows the trend: a sudden drop between runs predicts a dying stick better than any single number."
        next="Library-side health (databases, grids, corruption) lives in Overview and Verify."
      />
      {speed && (
        <div class={`arch-verdict ${speed.cls}`}>
          <Icon name={speed.cls === "ok" ? "check" : "warn"} size={15} />
          <span>
            {speed.text}
            {drop > 0 && (
              <b> {drop}% drop since the last run — dying-stick signature.</b>
            )}
          </span>
          <span class="arch-verdict-meta">{speed.label}</span>
        </div>
      )}
      <div class="statgrid">
        <StatCard
          v={last ? `${last.seq_mbps} MB/s` : "—"}
          l="sequential read (last)"
          icon="pulse"
          title="Big-file read speed — what CDJ playback actually needs. Green ≥60, usable ≥30, below that replace the stick."
        />
        <StatCard
          v={last ? `${last.rand4k_mbps} MB/s` : "—"}
          l="random 4k read (last)"
          icon="grid"
          title="Small-chunk read speed — covers library browsing, artwork loading and waveform seeks on hardware."
        />
        <StatCard
          v={drive.usb_serial ? shortSerial(drive.usb_serial) : "—"}
          l="USB serial"
          icon="hash"
          title={drive.usb_serial ?? undefined}
        />
        <StatCard
          v={`${drive.plug_count}`}
          l="plug sessions"
          icon="usb"
          title="How many times this drive has been mounted since CrateDeck first saw it."
        />
        {snap?.total_duration_ms ? (
          <StatCard
            v={fmtHours(snap.total_duration_ms)}
            l="total music duration"
            icon="clock"
            title="End-to-end runtime of every audio file on the drive, straight from rekordbox durations."
          />
        ) : null}
      </div>

      {bench.length > 1 && (
        <BenchChart
          bench={bench}
          lines={bench.map(
            (b) =>
              `${new Date(b.ran_at).toISOString().slice(0, 10)} — seq ${b.seq_mbps} MB/s · 4k ${b.rand4k_mbps} MB/s`,
          )}
        />
      )}
      {bench.length === 1 && (
        <div class="note">
          One benchmark so far — run Benchmark again after a few sessions to
          draw the trend.
        </div>
      )}

      <h3 class="sect">
        <Icon name="folder" /> Folders
        <InfoTip
          title="Folders"
          body="Where the bytes live: the 15 biggest folders with proportional bars."
          why="Surprise GB-eaters (old backups, duplicated exports) show up here first."
          align="right"
        />
      </h3>
      {(snap?.folders ?? []).length === 0 && (
        <div class="note">No folders recorded — run a scan.</div>
      )}
      <FolderBars snap={snap} />
      {speed && speed.cls === "warn" && (
        <FixNote>
          {drop > 0
            ? "run Benchmark again to confirm the drop — if it repeats, copy the music off and retire this stick"
            : "a Benchmark job will re-measure — confirm before trusting it for a gig"}
        </FixNote>
      )}
    </div>
  );
}

function fmtHours(ms: number): string {
  const h = Math.round(ms / 3_600_000);
  if (h < 1000) return `${h} h`;
  return `${(h / 1000).toFixed(1)}k h`;
}

function BenchChart({
  bench,
  lines,
}: {
  bench: HealthTabBench[];
  lines: string[];
}) {
  const W = 640;
  const H = 120;
  const PAD = 6;
  const max = Math.max(
    ...bench.map((b) => Math.max(b.seq_mbps, b.rand4k_mbps)),
    1,
  );
  const min = 0;
  const x = (i: number) =>
    PAD + (i / Math.max(1, bench.length - 1)) * (W - PAD * 2);
  const y = (v: number) =>
    H - PAD - ((v - min) / (max - min || 1)) * (H - PAD * 2);
  const line = (sel: (b: Bench) => number) =>
    bench
      .map(
        (b, i) =>
          `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(sel(b)).toFixed(1)}`,
      )
      .join(" ");
  const area = `${line((b) => b.seq_mbps)} L${x(bench.length - 1).toFixed(1)},${H - PAD} L${x(0)},${H - PAD} Z`;
  return (
    <div>
      <ListHead
        icon="pulse"
        title="Benchmark history"
        n={bench.length}
        hint="Each run draws two lines: sequential MB/s (solid) and random-4k MB/s (dashed). Hover the dots for the exact readings and date. A sudden ~40% drop between consecutive runs is the classic dying-stick signature — preflight flags it automatically."
        lines={lines}
      />
      <div class="benchchart">
        <div class="bench-legend">
          <span
            class="key"
            title="Big-file read speed — the number for CDJ playback"
          >
            <span class="sw" style={{ background: "var(--info)" }} /> sequential
            MB/s
          </span>
          <span
            class="key"
            title="Small-chunk speed — browsing, artwork, waveform seeks"
          >
            <span class="sw" style={{ background: "var(--accent)" }} /> random
            4k MB/s
          </span>
          <span style={{ marginLeft: "auto" }}>
            {bench.length} runs · peak {max} MB/s
          </span>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          preserveAspectRatio="none"
        >
          <path d={area} fill="var(--info-dim)" stroke="none" />
          <path
            d={line((b) => b.seq_mbps)}
            fill="none"
            stroke="var(--info)"
            stroke-width="2"
            stroke-linejoin="round"
          />
          <path
            d={line((b) => b.rand4k_mbps)}
            fill="none"
            stroke="var(--accent)"
            stroke-width="1.6"
            stroke-dasharray="4 3"
          />
          {bench.map((b, i) => (
            <circle
              key={b.ran_at}
              cx={x(i)}
              cy={y(b.seq_mbps)}
              r="3"
              fill="var(--info)"
            >
              <title>{`${new Date(b.ran_at).toLocaleString()} — seq ${b.seq_mbps} · 4k ${b.rand4k_mbps} MB/s`}</title>
            </circle>
          ))}
        </svg>
      </div>
    </div>
  );
}

function FolderBars({ snap }: { snap: SnapshotData | null }) {
  const folders = (snap?.folders ?? []).slice(0, 15);
  if (!folders.length) return null;
  const max = Math.max(...folders.map((f) => f.bytes), 1);
  return (
    <div>
      {folders.map((f) => (
        <div
          class="barrow"
          key={f.name}
          title={`${f.files} files · ${fmtBytes(f.bytes)}`}
        >
          <span class="barname">{f.name}</span>
          <span class="bartrack">
            <i style={{ width: `${Math.max(2, (f.bytes / max) * 100)}%` }} />
          </span>
          <span class="barn">{fmtBytes(f.bytes)}</span>
        </div>
      ))}
    </div>
  );
}
