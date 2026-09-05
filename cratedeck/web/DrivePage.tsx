// DrivePage.tsx — the main canvas for one drive. Replaces the old drawer:
// full-width sections, tabbed, deep-linkable via hash routing
// (#/drives/:id/:tab). Polls the API and merges SSE job updates.
import { useCallback, useEffect, useState } from "preact/hooks";
import type {
  DriveReport,
  InterlockState,
  Job,
  SnapshotData,
  TimelineEvent,
  VerifyReport,
} from "../shared/types";
import { fmtBytes, timeAgo } from "../shared/fmt";
import { api, toast } from "./toast";
import { Icon } from "./icons";
import { navigate } from "./router";
import { PlaylistsTab } from "./PlaylistsTab";
import { HealthTab } from "./HealthTab";
import { TimelineTab } from "./TimelineTab";
import { VerifyTab } from "./VerifyTab";
import { AgeStrip, CheckRow, DjPanel, ExtBars, SpaceBar } from "./DrivePanels";

const TABS = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "playlists", label: "Playlists", icon: "disc" },
  { id: "health", label: "Health", icon: "pulse" },
  { id: "verify", label: "Verify", icon: "check" },
  { id: "timeline", label: "Timeline", icon: "history" },
  { id: "photos", label: "Photo", icon: "photo" },
] as const;
type TabId = (typeof TABS)[number]["id"];

interface Detail {
  drive: DriveReport["drive"];
  snapshot: SnapshotData | null;
  sync: { verdict: string; missing?: number } | null;
  master_name: string;
}

interface PhotoHit {
  id: string;
  thumb: string;
  full: string;
  source: string;
}

export function DrivePage(props: {
  driveId: string;
  tab: string;
  interlock: InterlockState;
}) {
  const { driveId, interlock } = props;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [report, setReport] = useState<
    (DriveReport & { overall?: string }) | null
  >(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [bench, setBench] = useState<
    { ran_at: number; seq_mbps: number; rand4k_mbps: number }[]
  >([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [verify, setVerify] = useState<VerifyReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [photoHits, setPhotoHits] = useState<PhotoHit[] | null>(null);
  const [photoQuery, setPhotoQuery] = useState("");
  const locked = interlock.rekordbox_running;

  const load = useCallback(async () => {
    const enc = encodeURIComponent(driveId);
    const [d, r, t, b, j, v] = await Promise.all([
      fetch(`/api/drives/${enc}`).then((res) => res.json() as Promise<Detail>),
      fetch(`/api/drives/${enc}/report`).then(
        (res) => res.json() as Promise<DriveReport & { overall?: string }>,
      ),
      fetch(`/api/drives/${enc}/timeline`).then(
        (res) => res.json() as Promise<TimelineEvent[]>,
      ),
      fetch(`/api/drives/${enc}/benchmarks`).then(
        (res) =>
          res.json() as Promise<
            { ran_at: number; seq_mbps: number; rand4k_mbps: number }[]
          >,
      ),
      fetch(`/api/jobs?drive=${enc}`).then(
        (res) => res.json() as Promise<Job[]>,
      ),
      fetch(`/api/drives/${enc}/verify`).then(
        (res) => res.json() as Promise<VerifyReport>,
      ),
    ]);
    if (!d?.drive) {
      // unknown drive id (stale link / renamed registry) — surface, don't hang
      setDetail({ drive: null } as unknown as Detail);
      return;
    }
    setDetail(d);
    setReport(r);
    setTimeline(t);
    setBench(b);
    setJobs(j);
    setVerify(v);
  }, [driveId]);

  useEffect(() => {
    load();
    // adaptive cadence: 2s while jobs run (live progress), 10s idle. When a
    // job looks stuck (running >90s with no progress change) do a full
    // reload anyway — this is the self-heal for a lost SSE "done" event.
    let iv: ReturnType<typeof setTimeout>;
    let lastSnapshot = "";
    let stuckCount = 0;
    const loop = async () => {
      try {
        const active = (await fetch(
          `/api/jobs?drive=${encodeURIComponent(driveId)}&active=1`,
        ).then((r) => r.json())) as Job[];
        const n = Array.isArray(active) ? active.length : 0;
        if (n > 0) {
          // detect a stuck job: identical progress payload twice in a row
          const sig = JSON.stringify(active.map((j) => [j.id, j.progress]));
          stuckCount = sig === lastSnapshot ? stuckCount + 1 : 0;
          lastSnapshot = sig;
          // every job the server still calls active is authoritative — but
          // if the server-side reaper already ended them, active=1 will
          // stop returning them and we fall through to the idle path.
          if (stuckCount >= 45) {
            // ~90s frozen: force a full reload (also picks up final state)
            stuckCount = 0;
            lastSnapshot = "";
            await load();
          }
        } else {
          stuckCount = 0;
          lastSnapshot = "";
        }
        iv = setTimeout(loop, n > 0 ? 2000 : 10000);
      } catch {
        iv = setTimeout(loop, 10000);
      }
    };
    loop();
    return () => clearTimeout(iv);
  }, [load, driveId]);

  // SSE-driven job refreshes land in App; here we only need the drive's own
  // jobs list to stay current between polls.
  useEffect(() => {
    const onJob = () => {
      fetch(`/api/jobs?drive=${driveId}`)
        .then((r) => r.json())
        .then(setJobs)
        .catch(() => {});
    };
    window.addEventListener("cratedeck:job", onJob);
    return () => window.removeEventListener("cratedeck:job", onJob);
  }, [driveId]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !renaming) navigate(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [renaming]);

  const run = async (kind: string) => {
    setBusy(kind);
    try {
      await api<Job>(`/api/drives/${driveId}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      toast(`${kind} queued`, "ok");
    } catch {
      /* toast already surfaced the failure */
    } finally {
      setBusy(null);
    }
  };

  const rename = async (nickname: string | null) => {
    await api(`/api/drives/${driveId}/name`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: nickname || null }),
    });
    setRenaming(false);
    toast(nickname ? "Drive renamed" : "Nickname cleared", "ok");
    load();
  };

  const searchPhotos = async () => {
    const q = photoQuery.trim() || nameGuess(detail);
    try {
      const res = await api<{ provider: string; hits: PhotoHit[] }>(
        `/api/images/search?q=${encodeURIComponent(q)}`,
      );
      if (!res.hits.length) {
        toast(
          res.provider === "none"
            ? "No image provider configured (config.toml → images)"
            : "No images found",
          "info",
        );
        return;
      }
      setPhotoHits(res.hits);
    } catch {}
  };

  const choosePhoto = async (hit: PhotoHit) => {
    try {
      await api(`/api/drives/${driveId}/photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: hit.full }),
      });
      toast("Photo saved", "ok");
      load();
    } catch {}
  };

  const clearPhoto = async () => {
    // photo clearing = set nickname-style: dedicated endpoint keeps guard happy
    try {
      await api(`/api/drives/${driveId}/photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
      toast("Photo removed", "ok");
      load();
    } catch {}
  };

  if (!detail)
    return (
      <div class="canvas">
        <div class="note-card">
          <Icon name="clock" size={20} />
          Loading drive…
        </div>
      </div>
    );

  if (!(detail as unknown as { drive: unknown }).drive)
    return (
      <div class="canvas">
        <div class="note-card">
          <Icon name="warn" size={20} />
          Drive not found — it may have been removed from the registry.
          <button type="button" class="btn" onClick={() => navigate(null)}>
            Back to all drives
          </button>
        </div>
      </div>
    );

  const snap = detail.snapshot;
  const dj = snap?.dj ?? null;
  const name = detail.drive.nickname ?? detail.drive.name;
  const checks = report?.checks ?? [];
  const tab = (
    TABS.some((t) => t.id === props.tab) ? props.tab : "overview"
  ) as TabId;
  const counts: Partial<Record<TabId, number>> = {
    playlists: snap?.playlists?.length,
    timeline: timeline.length,
  };
  const failing = checks.filter((c) => c.status === "fail").length;
  const warning = checks.filter((c) => c.status === "warn").length;

  return (
    <div class="canvas">
      <button type="button" class="crumb" onClick={() => navigate(null)}>
        <Icon name="back" size={13} /> all drives
      </button>

      <div class="hero">
        <div class="photo">
          {detail.drive.photo_path ? (
            <img
              src={`/photos/${driveId}?v=${detail.drive.last_seen_at}`}
              alt={name}
            />
          ) : (
            <Icon name="usb" size={26} />
          )}
        </div>
        <div class="hid">
          {renaming ? (
            <span class="name-edit">
              <input
                value={nameDraft}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") rename(nameDraft.trim() || null);
                  if (e.key === "Escape") setRenaming(false);
                }}
                onInput={(e) =>
                  setNameDraft((e.target as HTMLInputElement).value)
                }
              />
              <button
                type="button"
                class="btn sm primary"
                onClick={() => rename(nameDraft.trim() || null)}
              >
                Save
              </button>
              <button
                type="button"
                class="btn sm ghostbtn"
                onClick={() => setRenaming(false)}
              >
                Cancel
              </button>
            </span>
          ) : (
            <h2>
              {name}
              {!detail.drive.mounted && <span class="badge muted">ghost</span>}
              <span class={`pill ${report?.overall ?? "unknown"}`}>
                {report?.overall ?? "unknown"}
              </span>
              <button
                type="button"
                class="btn sm ghostbtn"
                title="Rename drive"
                onClick={() => {
                  setRenaming(true);
                  setNameDraft(detail.drive.nickname ?? detail.drive.name);
                }}
              >
                <Icon name="pencil" size={13} />
              </button>
            </h2>
          )}
          <div class="hsub">
            <span>{detail.drive.name}</span>
            <span class="sep">·</span>
            <span>{fmtBytes(detail.drive.capacity_bytes ?? 0)}</span>
            {detail.drive.fs && (
              <>
                <span class="sep">·</span>
                <span>{detail.drive.fs}</span>
              </>
            )}
            <span class="sep">·</span>
            <span>
              {detail.drive.mounted
                ? "mounted now"
                : `last seen ${timeAgo(detail.drive.last_seen_at)}`}
            </span>
            {detail.sync && (
              <>
                <span class="sep">·</span>
                <span>
                  {detail.sync.verdict}
                  {detail.sync.missing
                    ? ` (${detail.sync.missing} files)`
                    : ""}{" "}
                  vs {detail.master_name}
                </span>
              </>
            )}
          </div>
          {(detail.drive.vendor || detail.drive.model) && (
            <div class="hsub hw">
              <Icon name="usb" size={12} />
              <span>
                {[detail.drive.vendor, detail.drive.model]
                  .filter(Boolean)
                  .join(" ")}
              </span>
              {detail.drive.usb_serial && (
                <>
                  <span class="sep">·</span>
                  <span class="hwserial" title={detail.drive.usb_serial}>
                    S/N {detail.drive.usb_serial.slice(0, 10)}…
                  </span>
                </>
              )}
              {detail.drive.last_port_key && (
                <>
                  <span class="sep">·</span>
                  <span title="Physical USB port (from ioreg location)">
                    port {detail.drive.last_port_key.replace(/^\//, "")}
                  </span>
                </>
              )}
              <span class="sep">·</span>
              <span>
                {detail.drive.plug_count} plug
                {detail.drive.plug_count === 1 ? "" : "s"}
              </span>
            </div>
          )}
        </div>
      </div>

      <div class="actions">
        <button
          type="button"
          class="btn primary"
          disabled={!detail.drive.mounted || locked || busy === "scan"}
          onClick={() => run("scan")}
          title={locked ? "rekordbox is running" : undefined}
        >
          <Icon name="scan" size={14} />{" "}
          {busy === "scan" ? "Scanning…" : "Scan"}
        </button>
        <button
          type="button"
          class="btn"
          disabled={!detail.drive.mounted || locked || busy === "verify"}
          onClick={() => run("verify")}
          title={locked ? "rekordbox is running" : undefined}
        >
          <Icon name="shield" size={14} /> Verify
        </button>
        <button
          type="button"
          class="btn"
          disabled={!detail.drive.mounted || locked || busy === "benchmark"}
          onClick={() => run("benchmark")}
        >
          <Icon name="pulse" size={14} /> Benchmark
        </button>
        <button
          type="button"
          class="btn"
          disabled={!detail.drive.mounted || locked || busy === "checksum"}
          onClick={() => run("checksum")}
        >
          <Icon name="hash" size={14} /> Checksum
        </button>
        <a class="btn" href={`/api/drives/${driveId}/export`} download>
          <Icon name="play" size={14} /> Export dossier
        </a>
      </div>

      {locked && detail.drive.mounted && (
        <div class="note bad">
          <Icon name="warn" size={14} /> Drive ops locked — rekordbox is
          running. Hands off until it quits.
        </div>
      )}
      {!detail.drive.mounted && (
        <div class="note">
          <Icon name="history" size={14} /> Ghost view — data from the last
          scan. Plug it in to refresh.
        </div>
      )}

      <div class="tabs">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            class={tab === t.id ? "on" : ""}
            onClick={() => navigate(driveId, t.id)}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
            {counts[t.id] !== undefined && (
              <span class="tabn">{counts[t.id]}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div>
          <div class="checks">
            {checks.length === 0 && (
              <div class="note-card">
                <Icon name="scan" size={20} />
                No checks yet — run a scan when mounted.
              </div>
            )}
            {checks.map((c) => (
              <CheckRow key={c.id} c={c} />
            ))}
          </div>

          <h3 class="sect">
            <Icon name="grid" /> Space
          </h3>
          {snap?.capacity_bytes ? (
            <SpaceBar snap={snap} />
          ) : (
            <div class="note">Run a scan to measure usage.</div>
          )}
          {!!snap?.by_ext?.length && <ExtBars snap={snap} />}
          {!!snap?.age && <AgeStrip snap={snap} />}

          {dj && <DjPanel dj={dj} />}
        </div>
      )}

      {tab === "playlists" && <PlaylistsTab snap={snap} />}

      {tab === "health" && (
        <HealthTab drive={detail.drive} snap={snap} bench={bench} />
      )}

      {tab === "verify" && <VerifyTab driveId={driveId} report={verify} />}

      {tab === "timeline" && <TimelineTab events={timeline} />}

      {tab === "photos" && (
        <div>
          <div class="note">
            <Icon name="photo" size={14} /> Pick a cover photo for this drive's
            card — it's saved locally and shown across the app.
          </div>
          {detail.drive.photo_path && (
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                margin: "8px 0",
              }}
            >
              <img
                src={`/photos/${driveId}?v=${detail.drive.last_seen_at}`}
                alt={name}
                style={{
                  width: 140,
                  height: 105,
                  objectFit: "cover",
                  borderRadius: 12,
                  border: "1px solid var(--stroke)",
                }}
              />
              <button type="button" class="btn danger sm" onClick={clearPhoto}>
                <Icon name="trash" size={13} /> Remove photo
              </button>
            </div>
          )}
          <div class="pl-tools">
            <input
              placeholder={`Search images for “${nameGuess(detail)}”…`}
              value={photoQuery}
              onInput={(e) =>
                setPhotoQuery((e.target as HTMLInputElement).value)
              }
              onKeyDown={(e) => e.key === "Enter" && searchPhotos()}
            />
            <button type="button" class="btn" onClick={searchPhotos}>
              <Icon name="search" size={14} /> Search
            </button>
          </div>
          {photoHits && (
            <div class="photopick">
              {photoHits.map((h) => (
                <img
                  key={h.id}
                  src={h.thumb}
                  alt={h.source}
                  title={`source: ${h.source}`}
                  onClick={() => choosePhoto(h)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* recent jobs for this drive */}
      {jobs.length > 0 && (
        <>
          <h3 class="sect">
            <Icon name="clock" /> Recent jobs
          </h3>
          <div class="checks">
            {jobs.slice(0, 5).map((j) => (
              <div class="check" key={j.id}>
                <span class={`jstat ${j.status}`}>{j.status}</span>
                <span class="check-body">
                  <b>{j.kind}</b>
                  <span class="check-detail">
                    {j.error ??
                      j.message ??
                      (j.finished_at
                        ? new Date(j.finished_at).toLocaleString()
                        : "…")}
                  </span>
                </span>
                {j.status === "running" && (
                  <span class="progressbar" style={{ alignSelf: "center" }}>
                    <i style={{ width: `${Math.round(j.progress * 100)}%` }} />
                  </span>
                )}
              </div>
            ))}
          </div>
          {(failing > 0 || warning > 0) && (
            <div class="note" style={{ marginTop: 12 }}>
              {failing > 0
                ? `${failing} check${failing > 1 ? "s" : ""} failing`
                : `${warning} warning${warning > 1 ? "s" : ""}`}{" "}
              — see Overview.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function nameGuess(d: Detail | null): string {
  if (!d) return "";
  return d.drive.nickname ?? d.drive.name;
}
