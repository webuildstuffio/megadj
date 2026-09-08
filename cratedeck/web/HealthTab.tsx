// HealthTab.tsx — hardware story: live stat cards, benchmark history as an
// SVG line chart (seq + random), identity serials, and folder composition
// with proportional bars.
import type { Drive, SnapshotData } from "../shared/types";
import { fmtBytes, shortSerial } from "../shared/fmt";
import { Icon } from "./icons";
import { StatCard } from "./DrivePanels";
import { InfoTip, TabIntro } from "./InfoTip";

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
  return (
    <div>
      <TabIntro
        what="Hardware, not library: is this stick fast enough and healthy?"
        how="Benchmarks measure real read speed (CDJ floor: ~30 MB/s sequential — below that, playback can stutter on high-bitrate files). Watch the trend: a sudden drop between runs predicts a dying stick better than any single number."
        next="Library-side health (databases, grids, corruption) lives in Overview and Verify."
      />
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

      {bench.length > 1 && <BenchChart bench={bench} />}
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
    </div>
  );
}

function fmtHours(ms: number): string {
  const h = Math.round(ms / 3_600_000);
  if (h < 1000) return `${h} h`;
  return `${(h / 1000).toFixed(1)}k h`;
}

function BenchChart({ bench }: { bench: HealthTabBench[] }) {
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
      <h3 class="sect">
        <Icon name="pulse" /> Benchmark history
        <InfoTip
          title="Benchmark history"
          body="Each run draws two lines: sequential MB/s (solid) and random-4k MB/s (dashed). Hover the dots for the exact readings and date."
          why="A sudden ~40% drop between consecutive runs is the classic dying-stick signature — preflight flags it automatically."
          align="right"
        />
      </h3>
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
