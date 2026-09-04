import { useEffect, useState } from "preact/hooks";
import type {
  Badge,
  Drive,
  InterlockState,
  Job,
  SnapshotData,
  TimelineEvent,
} from "../shared/types";
import { fmtBytes, timeAgo } from "./DriveCard";

interface Detail {
  drive: Drive;
  snapshot: SnapshotData | null;
  sync: { verdict: string; missing?: number } | null;
  master_name: string;
}

const TABS = ["overview", "playlists", "health", "timeline"] as const;
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
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [bench, setBench] = useState<
    { ran_at: number; seq_mbps: number; rand4k_mbps: number }[]
  >([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState<string | null>(null);
  const locked = interlock.rekordbox_running;

  const load = async () => {
    const [d, t, b] = await Promise.all([
      fetch(`/api/drives/${drive.id}`).then((r) => r.json()),
      fetch(`/api/drives/${drive.id}/timeline`).then((r) => r.json()),
      fetch(`/api/drives/${drive.id}/benchmarks`).then((r) => r.json()),
    ]);
    setDetail(d);
    setTimeline(t);
    setBench(b);
  };
  useEffect(() => {
    load();
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, [drive.id]);

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
  const name = detail?.drive.nickname ?? detail?.drive.name ?? drive.name;

  return (
    <div class="drawer" onClick={(e) => e.stopPropagation()}>
      <button class="close" onClick={onClose}>
        ✕
      </button>
      <h2>
        {name}
        {!detail?.drive.mounted && (
          <span class="badge muted" style={{ marginLeft: 8 }}>
            ghost
          </span>
        )}
      </h2>
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
        <button onClick={rename}>Rename</button>
        <button
          class="primary"
          disabled={!detail?.drive.mounted || locked || busy === "scan"}
          onClick={() => run("scan")}
          title={locked ? "rekordbox is running" : undefined}
        >
          {busy === "scan" ? "Scanning…" : "Scan"}
        </button>
        <button
          disabled={!detail?.drive.mounted || locked || busy === "verify"}
          onClick={() => run("verify")}
          title={locked ? "rekordbox is running" : undefined}
        >
          Verify
        </button>
        <button
          disabled={!detail?.drive.mounted || locked || busy === "benchmark"}
          onClick={() => run("benchmark")}
        >
          Benchmark
        </button>
        <button
          disabled={!detail?.drive.mounted || locked || busy === "checksum"}
          onClick={() => run("checksum")}
        >
          Checksum
        </button>
        <a
          href={`/api/drives/${drive.id}/export`}
          download
          style={{ alignSelf: "center" }}
        >
          <button>Export dossier</button>
        </a>
      </div>
      {locked && (
        <div style={{ color: "var(--bad)", fontSize: 12, marginBottom: 8 }}>
          Drive ops locked — rekordbox is running.
        </div>
      )}
      {!detail?.drive.mounted && (
        <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>
          Ghost view — data from the last scan. Plug it in to refresh.
        </div>
      )}

      <div class="tabs">
        {TABS.map((t) => (
          <button
            key={t}
            class={tab === t ? "on" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div>
          <div class="statgrid">
            <Stat
              v={snap?.track_count?.toLocaleString() ?? "—"}
              l="rekordbox tracks"
            />
            <Stat
              v={snap?.file_count?.toLocaleString() ?? "—"}
              l="audio files on disk"
            />
            <Stat
              v={snap ? pct(snap.grid_coverage) : "—"}
              l="beatgrid coverage (ANLZ)"
            />
            <Stat
              v={snap ? fmtBytes(snap.total_bytes ?? 0) : "—"}
              l="audio size"
            />
            <Stat
              v={
                snap
                  ? `${snap.onelibrary_rows ?? "—"} / ${snap.pdb_live_rows ?? "—"}`
                  : "—"
              }
              l="OneLibrary / legacy pdb rows (hardware gate)"
            />
            <Stat
              v={snap?.db_mtime ? timeAgo(snap.db_mtime) : "—"}
              l="device DB last changed"
            />
          </div>
          {snap?.junk && (
            <div>
              <h3 class="sect">Junk scan</h3>
              <div style={{ fontSize: 13 }}>
                {snap.junk.zero_byte.length === 0 &&
                snap.junk.case_collisions.length === 0 &&
                snap.junk.orphan_resource_forks === 0 ? (
                  "Clean — no zero-byte files, case collisions, or orphan forks."
                ) : (
                  <>
                    {snap.junk.zero_byte.length > 0 && (
                      <div style={{ color: "var(--bad)" }}>
                        {snap.junk.zero_byte.length} zero-byte file(s)
                      </div>
                    )}
                    {snap.junk.case_collisions.length > 0 && (
                      <div style={{ color: "var(--warn)" }}>
                        {snap.junk.case_collisions.length} case-collision
                        path(s)
                      </div>
                    )}
                    {snap.junk.orphan_resource_forks > 0 && (
                      <div style={{ color: "var(--muted)" }}>
                        {snap.junk.orphan_resource_forks} orphan ._* forks
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "playlists" && (
        <div class="pllist">
          {(snap?.playlists ?? []).length === 0 && (
            <div style={{ color: "var(--muted)" }}>
              No snapshot yet — run a scan when mounted.
            </div>
          )}
          {(snap?.playlists ?? [])
            .slice()
            .sort((a, b) => b.entries - a.entries)
            .map((pl) => (
              <div class="plrow" key={pl.name}>
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
              v={
                bench.length ? `${bench[bench.length - 1].seq_mbps} MB/s` : "—"
              }
              l="sequential read (last)"
            />
            <Stat
              v={
                bench.length
                  ? `${bench[bench.length - 1].rand4k_mbps} MB/s`
                  : "—"
              }
              l="random 4k read (last)"
            />
            <Stat v={detail?.drive.usb_serial ?? "—"} l="USB serial" />
            <Stat v={`${detail?.drive.plug_count ?? 0}`} l="plug sessions" />
          </div>
          {bench.length > 1 && (
            <div>
              <h3 class="sect">Benchmark history (seq MB/s)</h3>
              <div
                style={{
                  display: "flex",
                  gap: 3,
                  alignItems: "flex-end",
                  height: 60,
                }}
              >
                {bench.map((b) => {
                  const max = Math.max(...bench.map((x) => x.seq_mbps));
                  return (
                    <div
                      key={b.ran_at}
                      title={`${new Date(b.ran_at).toLocaleString()}: ${b.seq_mbps} MB/s`}
                      style={{
                        width: 22,
                        height: `${(b.seq_mbps / max) * 100}%`,
                        background: "var(--info)",
                        borderRadius: 3,
                        opacity: 0.85,
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
          {timeline.length === 0 && (
            <div style={{ color: "var(--muted)" }}>No events yet.</div>
          )}
          {timeline.map((e) => (
            <div class="row" key={e.id}>
              <span class="t">{new Date(e.at).toLocaleString()}</span>
              <span>
                <b>{e.kind}</b>{" "}
                <span style={{ color: "var(--muted)" }}>
                  {JSON.stringify(e.data).slice(1, 90)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ v, l }: { v: string; l: string }) {
  return (
    <div class="stat">
      <div class="v">{v}</div>
      <div class="l">{l}</div>
    </div>
  );
}

function pct(x?: number): string {
  return x === undefined ? "—" : `${Math.round(x * 100)}%`;
}
