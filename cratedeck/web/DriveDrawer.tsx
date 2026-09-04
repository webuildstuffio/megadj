import { useEffect, useState } from "preact/hooks";
import type {
  Drive,
  DriveReport,
  HealthCheck,
  InterlockState,
  SnapshotData,
  TimelineEvent,
} from "../shared/types";
import { fmtBytes, timeAgo } from "../shared/fmt";
import { fmtDur, fmtEventData, shortSerial } from "../shared/fmt";

interface Detail {
  drive: DriveReport["drive"];
  snapshot: SnapshotData | null;
  sync: { verdict: string; missing?: number } | null;
  master_name: string;
}

const TABS = ["report", "playlists", "health", "timeline"] as const;
type Tab = (typeof TABS)[number];

export function DriveDrawer({
  drive,
  interlock,
  onClose,
}: {
  drive: Drive;
  interlock: InterlockState;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [report, setReport] = useState<
    (DriveReport & { overall?: string }) | null
  >(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [bench, setBench] = useState<
    { ran_at: number; seq_mbps: number; rand4k_mbps: number }[]
  >([]);
  const [tab, setTab] = useState<Tab>("report");
  const [busy, setBusy] = useState<string | null>(null);
  const locked = interlock.rekordbox_running;

  const load = async () => {
    const [d, r, t, b] = await Promise.all([
      fetch(`/api/drives/${drive.id}`).then((res) => res.json()),
      fetch(`/api/drives/${drive.id}/report`).then((res) => res.json()),
      fetch(`/api/drives/${drive.id}/timeline`).then((res) => res.json()),
      fetch(`/api/drives/${drive.id}/benchmarks`).then((res) => res.json()),
    ]);
    setDetail(d);
    setReport(r);
    setTimeline(t);
    setBench(b);
  };
  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [drive.id]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const run = async (kind: string) => {
    setBusy(kind);
    try {
      await fetch(`/api/drives/${drive.id}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
    } finally {
      setBusy(null);
    }
  };

  const rename = async () => {
    const nickname = prompt(
      "Name this drive:",
      detail?.drive.nickname ?? detail?.drive.name ?? "",
    );
    if (nickname === null) return;
    await fetch(`/api/drives/${drive.id}/name`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: nickname || null }),
    });
    load();
  };

  const snap = detail?.snapshot ?? null;
  const dj = snap?.dj ?? null;
  const name = detail?.drive.nickname ?? detail?.drive.name ?? drive.name;
  const checks = report?.checks ?? [];

  return (
    <div class="drawer" onClick={(e) => e.stopPropagation()}>
      <button type="button" class="close" onClick={onClose}>
        ✕
      </button>
      <div class="drawer-head">
        <h2>
          {name}
          {!detail?.drive.mounted && (
            <span class="badge muted" style={{ marginLeft: 8 }}>
              ghost
            </span>
          )}
        </h2>
        <OverallPill verdict={report?.overall} />
      </div>
      <div class="sub">
        {detail?.drive.name} · {fmtBytes(detail?.drive.capacity_bytes ?? 0)}{" "}
        {detail?.drive.fs ?? ""} · first seen{" "}
        {new Date(detail?.drive.first_seen_at ?? 0).toLocaleDateString()} ·
        {detail?.drive.mounted
          ? " mounted now"
          : ` last seen ${timeAgo(detail?.drive.last_seen_at ?? 0)}`}
        {detail?.sync &&
          ` · ${detail.sync.verdict}${detail.sync.missing ? ` (${detail.sync.missing} files)` : ""} vs ${detail.master_name}`}
      </div>

      <div class="actions">
        <button
          type="button"
          onClick={rename}
          title="Set a display name (kept forever, even when unplugged)"
        >
          ✎ Rename
        </button>
        <button
          type="button"
          class="primary"
          disabled={!detail?.drive.mounted || locked || busy === "scan"}
          onClick={() => run("scan")}
          title="Read all files + the rekordbox DB on this drive and refresh every stat. Read-only. ~10–60s."
        >
          {busy === "scan" ? "◌ Scanning…" : "▦ Scan"}
        </button>
        <button
          type="button"
          disabled={!detail?.drive.mounted || locked || busy === "verify"}
          onClick={() => run("verify")}
          title="Full data check: every file hash + DB integrity via usb_verify.py. Slow (minutes) — run before a gig."
        >
          {busy === "verify" ? "◌ Verifying…" : "✓ Verify"}
        </button>
        <button
          type="button"
          disabled={!detail?.drive.mounted || locked || busy === "benchmark"}
          onClick={() => run("benchmark")}
          title="Read-speed test (sequential + random 4k). Confirms the stick is fast enough for CDJs (≥30 MB/s)."
        >
          {busy === "benchmark" ? "◌ Testing…" : "⚡ Benchmark"}
        </button>
        <button
          type="button"
          disabled={!detail?.drive.mounted || locked || busy === "checksum"}
          onClick={() => run("checksum")}
          title="Seed/update the corruption ledger (blake2b per file). Re-runs only hash changed files. First run is slow."
        >
          {busy === "checksum" ? "◌ Hashing…" : "# Checksum"}
        </button>
        <a
          class="btn"
          href={`/api/drives/${drive.id}/export`}
          download
          title="Download everything known about this drive as JSON (report, timeline, benchmarks)"
        >
          ⬇ Export
        </a>
      </div>
      {locked && (
        <div
          class="note bad-note"
          title="rekordbox holds the drive DBs open; editing them while it runs corrupts the library"
        >
          🔒 Drive ops locked — rekordbox is running. Quit it to unlock.
        </div>
      )}
      {!detail?.drive.mounted && (
        <div class="note">
          👻 Ghost view — showing data from the last time this drive was plugged
          in. Plug it in and run a Scan to refresh.
        </div>
      )}

      <div class="tabs">
        {TABS.map((t) => (
          <button
            type="button"
            key={t}
            class={tab === t ? "on" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "report" && (
        <div>
          {/* health checks first — the verdict */}
          <div class="checks">
            {checks.length === 0 && (
              <div class="note">No checks yet — run a scan when mounted.</div>
            )}
            {checks.map((c) => (
              <CheckRow c={c} key={c.id} />
            ))}
          </div>

          {/* space analysis */}
          <h3 class="sect">Space</h3>
          {snap?.capacity_bytes ? (
            <SpaceBar snap={snap} />
          ) : (
            <div class="note">Run a scan to measure usage.</div>
          )}
          {!!snap?.by_ext?.length && (
            <div class="extbars">
              {snap.by_ext.slice(0, 8).map((e) => {
                const max = snap.by_ext?.[0]?.bytes ?? 1;
                return (
                  <div class="extrow" key={e.ext}>
                    <span class="ext">{e.ext}</span>
                    <span class="extbar">
                      <i
                        style={{
                          width: `${Math.max(2, (e.bytes / max) * 100)}%`,
                        }}
                      />
                    </span>
                    <span class="extn">
                      {fmtBytes(e.bytes)} · {e.files}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {!!snap?.age && (
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
                  <b>{snap.age![k]}</b>
                  {label}
                </span>
              ))}
            </div>
          )}

          {/* DJ metadata */}
          {dj && <DjPanel dj={dj} />}
        </div>
      )}

      {tab === "playlists" && (
        <div class="pllist">
          {(snap?.playlists ?? []).length === 0 && (
            <div class="note">No snapshot yet — run a scan when mounted.</div>
          )}
          {(snap?.playlists ?? [])
            .slice()
            .sort((a, b) => b.entries - a.entries)
            .map((pl) => (
              <div class="plrow" key={pl.parent + "/" + pl.name}>
                <span>
                  {pl.parent && (
                    <span style={{ color: "var(--muted)" }}>
                      {pl.parent} /{" "}
                    </span>
                  )}
                  {pl.name}
                </span>
                <span class="n">{pl.entries}</span>
              </div>
            ))}
        </div>
      )}

      {tab === "health" && (
        <div>
          <div class="statgrid">
            <Stat
              v={bench.at(-1) ? `${bench.at(-1)!.seq_mbps} MB/s` : "—"}
              l="sequential read (last)"
            />
            <Stat
              v={bench.at(-1) ? `${bench.at(-1)!.rand4k_mbps} MB/s` : "—"}
              l="random 4k read (last)"
            />
            <Stat
              v={
                detail?.drive.usb_serial
                  ? shortSerial(detail.drive.usb_serial)
                  : "—"
              }
              l="USB serial"
              title={detail?.drive.usb_serial ?? undefined}
            />
            <Stat v={`${detail?.drive.plug_count ?? 0}`} l="plug sessions" />
          </div>
          {bench.length > 1 && (
            <div>
              <h3 class="sect">Benchmark history (seq MB/s)</h3>
              <div class="benchbars">
                {bench.map((b) => {
                  const max = Math.max(...bench.map((x) => x.seq_mbps));
                  return (
                    <div
                      key={b.ran_at}
                      title={`${new Date(b.ran_at).toLocaleString()}: ${b.seq_mbps} MB/s`}
                      style={{
                        width: 22,
                        height: `${(b.seq_mbps / max) * 100}%`,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )}
          <h3 class="sect">Folders</h3>
          {(snap?.folders ?? []).slice(0, 15).map((f) => (
            <div class="plrow" key={f.name}>
              <span>{f.name}</span>
              <span class="n">
                {f.files} files · {fmtBytes(f.bytes)}
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === "timeline" && (
        <div class="tl">
          {timeline.length === 0 && <div class="note">No events yet.</div>}
          {timeline.map((e) => (
            <div class="row" key={e.id}>
              <span class="t">{new Date(e.at).toLocaleString()}</span>
              <span>
                <b>{e.kind}</b>{" "}
                <span style={{ color: "var(--muted)" }}>
                  {fmtEventData(e.data)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OverallPill({ verdict }: { verdict?: string }) {
  const v = verdict ?? "unknown";
  const icon =
    { healthy: "●", attention: "▲", critical: "✕", unknown: "○" }[v] ?? "○";
  return (
    <span class={`pill ${v}`} title={`Overall verdict: ${v}`}>
      {icon} {v}
    </span>
  );
}

/** Why a check isn't passing — plain-language, per status. */
const WHY: Record<string, { warn: string; fail: string; unknown: string }> = {
  "dual-db": {
    warn: "Legacy players read the old pdb DB; a mismatch means they'd see a stale library.",
    fail: "Legacy players (XDJ-XZ, older CDJs) will see a different library than newer gear.",
    unknown: "Needs a full Scan (with rekordbox closed) to compare both DBs.",
  },
  grids: {
    warn: "Some tracks lack beatgrids — they'll need analysis before hot cues/loop work.",
    fail: "Many tracks have no beatgrids — expected gapless/beatjump won't work on them.",
    unknown: "Beatgrid coverage comes from a full Scan.",
  },
  verify: {
    warn: "Library changed since the last verify, or the verify is getting old.",
    fail: "The last verify found problems — don't trust this drive for a gig yet.",
    unknown: "This drive has never been fully verified.",
  },
  bitrot: {
    warn: "Checksum ledger is getting stale — re-run Checksum to re-confirm.",
    fail: "Files differ from their recorded hashes — silent corruption. Replace them.",
    unknown: "Run Checksum once to seed corruption tracking.",
  },
  junk: {
    warn: "Junk files can crash older CDJ firmware or double-count tracks.",
    fail: "Junk files can crash older CDJ firmware or double-count tracks.",
    unknown: "Junk info comes from a Scan.",
  },
  space: {
    warn: "rekordbox needs headroom for ANLZ files and DB WAL — below 15% is risky.",
    fail: "Critically full — rekordbox syncs will fail or corrupt.",
    unknown: "Space is measured on each Scan.",
  },
  dupes: {
    warn: "Two paths differ only by case — FAT32 sees them as one file, rekordbox may double-count.",
    fail: "Two paths differ only by case — FAT32 sees them as one file, rekordbox may double-count.",
    unknown: "Dupe detection runs on Scan.",
  },
  artwork: {
    warn: "Some tracks are missing cover art — shows blank on players.",
    fail: "Many tracks missing artwork — browsing on the player looks broken.",
    unknown: "Artwork coverage comes from a full Scan.",
  },
  mirror: {
    warn: "Mirror is behind the master — run the mirror sync to converge.",
    fail: "Mirror is badly behind the master — it is NOT a safe backup right now.",
    unknown: "Needs scans of both master and mirror.",
  },
  speed: {
    warn: "Slower than ideal — may buffer-stall on high-bitrate tracks.",
    fail: "Too slow for CDJs — likely fake-capacity or failing stick. Replace it.",
    unknown: "Run a Benchmark to measure read speed.",
  },
};

function CheckRow({ c }: { c: HealthCheck }) {
  const why = c.status !== "pass" ? WHY[c.id]?.[c.status] : undefined;
  return (
    <div class={`check ${c.status}`}>
      <span class="check-ico" title={c.status}>
        {c.status === "pass"
          ? "✓"
          : c.status === "warn"
            ? "▲"
            : c.status === "fail"
              ? "✕"
              : "○"}
      </span>
      <span class="check-body">
        <b>{c.label}</b>
        <span class="check-detail">{c.detail}</span>
        {why && <span class="check-why">{why}</span>}
        {c.fix && <span class="check-fix">→ {c.fix}</span>}
      </span>
    </div>
  );
}

function SpaceBar({ snap }: { snap: SnapshotData }) {
  const cap = snap.capacity_bytes ?? 0;
  const used = Math.max(0, cap - (snap.free_bytes ?? 0));
  const usedPct = cap ? (used / cap) * 100 : 0;
  return (
    <div class="spacewrap">
      <div class="spacebar">
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

function DjPanel({ dj }: { dj: NonNullable<SnapshotData["dj"]> }) {
  return (
    <>
      <h3 class="sect">DJ library</h3>
      <div class="statgrid">
        <Stat
          v={
            dj.bpm_min
              ? `${Math.round(dj.bpm_min)}–${Math.round(dj.bpm_max ?? 0)}`
              : "—"
          }
          l="BPM range"
        />
        <Stat v={dj.bpm_median ? `${dj.bpm_median}` : "—"} l="BPM median" />
        <Stat
          v={dj.duration ? fmtDur(dj.duration.median_s) : "—"}
          l="median track length"
        />
        <Stat
          v={dj.duration ? fmtDur(dj.duration.longest_s) : "—"}
          l="longest track"
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

function Bars({
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

function Stat({ v, l, title }: { v: string; l: string; title?: string }) {
  return (
    <div class="stat">
      <div class="v" title={title}>
        {v}
      </div>
      <div class="l">{l}</div>
    </div>
  );
}
