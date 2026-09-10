// HealthTab.tsx — hardware story: live stat cards, benchmark history as an
// SVG line chart (seq + random), identity serials, and folder composition
// with proportional bars.
//
// UX pass (Sep 8, same treatment as ArchiveTab/FleetPage): the tab leads
// with a verdict — is this stick gig-safe on speed? — against the CDJ
// floor (≥30 MB/s sequential; below that high-bitrate playback can
// stutter). The bench history is copyable so a dying-stick trend can be
// handed to an agent in one paste.
import type { Drive, SnapshotData, BenchRun } from "../../../shared/types";
import { fmtBytes, shortSerial } from "../../../shared/fmt";
import { Icon } from "../../ui/icons";
import { StatCard } from "../../ui/DrivePanels";
import { InfoTip, TabIntro } from "../../ui/InfoTip";
import { ListHead, FixNote } from "../../ui/ListHead";
import { BarList } from "../../ui/data";
import { LineChart } from "../../ui/charts";

// The bench row shape is DERIVED from shared/types.ts (BenchRun) — the
// same producer contract DrivePage reads; no consumer-side re-declaration.
export type HealthTabBench = BenchRun;

export function HealthTab(props: {
  drive: Drive;
  snap: SnapshotData | null;
  bench: HealthTabBench[];
  probes: { ran_at: number; mbps: number }[];
}) {
  const { drive, snap, bench, probes } = props;
  const last = bench.at(-1);
  // ---- USB link class (negotiated rate from the ioreg tree at mount) -----
  // The same thresholds as the rail badge + banner: <5G = USB2-class cap.
  const link =
    drive.link_bps === null || drive.link_bps === undefined
      ? null
      : drive.link_bps >= 10_000_000_000
        ? {
            cls: "ok",
            label: "USB3 10G",
            text: "10+ Gbps link — no bottleneck.",
          }
        : drive.link_bps >= 5_000_000_000
          ? { cls: "ok", label: "USB 3.0", text: "5 Gbps link — gig-safe." }
          : {
              cls: "warn",
              label: "USB 2.0",
              text: `${(drive.link_bps / 1_000_000).toFixed(0)} Mbps link — caps copies/playback at ~35 MB/s. Move to a USB 3.0 port.`,
            };
  // speed-probe average (the minimal ~10MB probe) — one number for "how fast
  // is this drive really", averaged across probes to smooth one-off spikes
  const avgProbe = probes.length
    ? Math.round(probes.reduce((s, p) => s + p.mbps, 0) / probes.length)
    : null;
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
      {link && (
        <div class={`arch-verdict ${link.cls}`}>
          <Icon name={link.cls === "ok" ? "usb" : "warn"} size={15} />
          <span>
            <b>{link.label} link.</b> {link.text}
          </span>
          <span class="arch-verdict-meta">{link.label}</span>
        </div>
      )}
      <div class="statgrid">
        <StatCard
          v={last ? `${last.seq_mbps} MB/s` : "—"}
          l="sequential read (last)"
          icon="pulse"
          title="Big-file read speed — what CDJ playback actually needs. Green ≥60, usable ≥30, below that replace the stick."
        />
        {avgProbe !== null && (
          <StatCard
            v={`${avgProbe} MB/s`}
            l={`speed probe avg (${probes.length})`}
            icon="zap"
            title="Average of the minimal ~10MB read probes — a quick, write-free sanity check of real throughput. Run 'Speed probe' from the header to add a sample."
          />
        )}
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
  return (
    <div>
      <ListHead
        icon="pulse"
        title="Benchmark history"
        n={bench.length}
        hint="Each run draws two lines: sequential MB/s (solid) and random-4k MB/s (dashed). Hover the dots for the exact readings and date. A sudden ~40% drop between consecutive runs is the classic dying-stick signature — preflight flags it automatically. Click a legend to isolate a series."
        lines={lines}
      />
      <div class="benchchart">
        <LineChart
          series={[
            {
              name: "sequential MB/s",
              color: "var(--info)",
              area: "var(--info-dim)",
              values: bench.map((b) => b.seq_mbps),
              tip: (v, i) =>
                `${new Date(bench[i]!.ran_at).toLocaleString()} — seq ${v} · 4k ${bench[i]!.rand4k_mbps} MB/s`,
            },
            {
              name: "random 4k MB/s",
              color: "var(--accent)",
              dashed: true,
              values: bench.map((b) => b.rand4k_mbps),
              tip: (v, i) =>
                `${new Date(bench[i]!.ran_at).toLocaleString()} — 4k ${v} · seq ${bench[i]!.seq_mbps} MB/s`,
            },
          ]}
          height={130}
          unit="MB/s"
        />
      </div>
    </div>
  );
}

function FolderBars({ snap }: { snap: SnapshotData | null }) {
  const folders = (snap?.folders ?? []).slice(0, 15);
  if (!folders.length) return null;
  return (
    <BarList
      rows={folders.map((f) => ({
        key: f.name,
        name: f.name,
        value: f.bytes,
        display: fmtBytes(f.bytes),
        title: `${f.name}: ${f.files} files · ${fmtBytes(f.bytes)}`,
      }))}
      tone="info"
    />
  );
}
