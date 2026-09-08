// DrivePage.tsx — the main canvas for one drive. Replaces the old drawer:
// full-width sections, tabbed, deep-linkable via hash routing
// (#/drives/:id/:tab). Polls the API and merges SSE job updates.
import { useCallback, useEffect, useState } from "preact/hooks";
import type {
  DriveReport,
  InterlockState,
  Job,
  JobKind,
  SnapshotData,
  TimelineEvent,
  VerifyReport,
} from "../shared/types";
import { errMessage, fmtBytes, timeAgo } from "../shared/fmt";
import { ApiError, api, apiPost, toast } from "./toast";
import { Icon } from "./icons";
import { navigate } from "./router";
import { PlaylistsTab } from "./PlaylistsTab";
import { HealthTab, type HealthTabBench } from "./HealthTab";
import { TimelineTab } from "./TimelineTab";
import { VerifyTab } from "./VerifyTab";
import {
  AgeStrip,
  CheckRow,
  ConfirmButton,
  DjPanel,
  ExtBars,
  SpaceBar,
} from "./DrivePanels";

const TABS = [
  {
    id: "overview",
    label: "Overview",
    icon: "grid",
    title: "Health checks, space usage, DJ metadata at a glance",
  },
  {
    id: "playlists",
    label: "Playlists",
    icon: "disc",
    title: "Browse and search the playlists stored on this drive",
  },
  {
    id: "health",
    label: "Health",
    icon: "pulse",
    title: "Hardware health: speed benchmarks, disk age, capacity history",
  },
  {
    id: "verify",
    label: "Verify",
    icon: "check",
    title: "Deep integrity audit results — databases, files, grids, parity",
  },
  {
    id: "timeline",
    label: "Timeline",
    icon: "history",
    title: "Everything that happened to this drive, newest first",
  },
  {
    id: "photos",
    label: "Photo",
    icon: "photo",
    title: "Pick the cover photo shown on this drive's card",
  },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** The four standard drive jobs — one config row per button, one render
 *  loop. Each carries a `hint`: the plain-language explanation shown as the
 *  hover tooltip ("what does this actually do?"). */
const JOB_BUTTONS: {
  kind: JobKind;
  label: string;
  busy?: string;
  icon: string;
  primary?: boolean;
  interlockHint?: boolean;
  hint: string;
}[] = [
  {
    kind: "scan",
    label: "Scan",
    busy: "Scanning…",
    icon: "scan",
    primary: true,
    hint: "Read the rekordbox library on this drive — tracks, playlists, health stats. Read-only, safe any time.",
  },
  {
    kind: "verify",
    label: "Verify",
    icon: "shield",
    interlockHint: true,
    hint: "Deep integrity audit: both rekordbox databases agree, every audio file exists, beatgrids sane, mirror matches master. Read-only.",
  },
  {
    kind: "benchmark",
    label: "Benchmark",
    icon: "pulse",
    hint: "Measure real read/write speed of this drive — tells you if it can handle gig-night playback. Writes a temp file, then deletes it.",
  },
  {
    kind: "checksum",
    label: "Checksum",
    icon: "hash",
    hint: "Hash every audio file (blake2b) so future scans can detect silent corruption/bitrot. Slow the first time, fast after.",
  },
];

interface Detail {
  drive: DriveReport["drive"];
  snapshot: SnapshotData | null;
  sync: DriveReport["sync"];
  master_name: string;
}

interface PhotoHit {
  id: string;
  thumb: string;
  full: string;
  source: string;
}

/** Page load state: a machine where every branch is named. Replaces the old
 *  `{ drive: null } as unknown as Detail` sentinel — the Detail type no
 *  longer lies about its own shape. */
type PageState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "not-found" }
  | { status: "ok"; detail: Detail };

export function DrivePage(props: {
  driveId: string;
  tab: string;
  interlock: InterlockState;
}) {
  const { driveId, interlock } = props;
  const [page, setPage] = useState<PageState>({ status: "loading" });
  const [report, setReport] = useState<
    (DriveReport & { overall?: string }) | null
  >(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [bench, setBench] = useState<HealthTabBench[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [verify, setVerify] = useState<VerifyReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [photoHits, setPhotoHits] = useState<PhotoHit[] | null>(null);
  const [photoQuery, setPhotoQuery] = useState("");
  const detailOrNull = page.status === "ok" ? page.detail : null;
  const loadError = page.status === "error" ? page.message : null;
  const locked = interlock.rekordbox_running;

  const load = useCallback(async () => {
    const enc = encodeURIComponent(driveId);
    try {
      const [d, r, t, b, j, v] = await Promise.all([
        api<Detail>(`/api/drives/${enc}`, { quiet: true }),
        api<DriveReport & { overall?: string }>(`/api/drives/${enc}/report`, {
          quiet: true,
        }),
        api<TimelineEvent[]>(`/api/drives/${enc}/timeline`, { quiet: true }),
        api<HealthTabBench[]>(`/api/drives/${enc}/benchmarks`, {
          quiet: true,
        }),
        api<Job[]>(`/api/jobs?drive=${enc}`, { quiet: true }),
        api<VerifyReport>(`/api/drives/${enc}/verify`, { quiet: true }),
      ]);
      if (!d?.drive) {
        // unknown drive id (stale link / renamed registry) — api() only gets
        // here on a real 200, so this is a deliberate soft-not-found shape.
        setPage({ status: "not-found" });
        return;
      }
      const fresh = d;
      setPage({ status: "ok", detail: fresh });
      setReport(r);
      setTimeline(t);
      setBench(b);
      setJobs(j);
      setVerify(v);
    } catch (e) {
      // failed background refresh: keep the last good render visible, but the
      // failure is surfaced (banner) instead of silently showing stale data.
      console.error(`drive ${driveId} load failed`, e);
      // A 404 on the drive itself is a verdict (stale link / removed from
      // registry), not a transport failure — map only that to not-found;
      // everything else (500, network) keeps the error banner honest.
      if (e instanceof ApiError && e.status === 404) {
        setPage({ status: "not-found" });
        return;
      }
      const msg = errMessage(e);
      setPage((prev) =>
        prev.status === "ok" ? prev : { status: "error", message: msg },
      );
      return;
    }
  }, [driveId]);

  useEffect(() => {
    load().catch((e: unknown) => {
      console.error(`initial load for ${driveId} failed`, e);
    });
    // adaptive cadence: 2s while jobs run (live progress), 10s idle. When a
    // job looks stuck (running >90s with no progress change) do a full
    // reload anyway — this is the self-heal for a lost SSE "done" event.
    let iv: ReturnType<typeof setTimeout>;
    let lastSnapshot = "";
    let stuckCount = 0;
    const loop = async () => {
      try {
        const active = await api<Job[]>(
          `/api/jobs?drive=${encodeURIComponent(driveId)}&active=1`,
          { quiet: true },
        );
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
          // idle self-heal: the poll loop used to only refresh job state —
          // if the FIRST full load failed (server busy/restarting), the
          // "Loading failed" card stuck forever because nothing retried it
          if (loadError) await load();
        }
        iv = setTimeout(loop, n > 0 ? 2000 : 10000);
      } catch {
        iv = setTimeout(loop, 10000);
      }
    };
    loop();
    return () => clearTimeout(iv);
    // loadError rides along: the idle self-heal only retries after a failed
    // load, and must see the flag flip false once the retry succeeds
  }, [load, driveId, loadError]);

  // SSE-driven job refreshes land in App; here we only need the drive's own
  // jobs list to stay current between polls. `cratedeck:job` fires per SSE
  // event (up to ~4/s while a job runs) — throttle to ≤1 fetch per 2s.
  const refreshJobs = useCallback(async () => {
    try {
      setJobs(await api<Job[]>(`/api/jobs?drive=${driveId}`, { quiet: true }));
    } catch (e) {
      console.error(`jobs refresh for ${driveId} failed`, e);
      toast("job list refresh failed — server unreachable", "err");
    }
  }, [driveId]);

  useEffect(() => {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onJob = () => {
      const now = Date.now();
      if (now - last < 2000) {
        if (!timer) {
          timer = setTimeout(
            () => {
              timer = null;
              last = Date.now();
              refreshJobs();
            },
            2000 - (now - last),
          );
        }
        return;
      }
      last = now;
      refreshJobs();
    };
    window.addEventListener("cratedeck:job", onJob);
    return () => {
      window.removeEventListener("cratedeck:job", onJob);
      if (timer) clearTimeout(timer);
    };
  }, [driveId, refreshJobs]);

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
      await apiPost<Job>(`/api/drives/${driveId}/jobs`, { kind });
      toast(`${kind} queued`, "ok");
    } catch {
      /* toast already surfaced the failure */
    } finally {
      setBusy(null);
    }
  };

  const rename = async (nickname: string | null) => {
    try {
      await apiPost(`/api/drives/${driveId}/name`, {
        nickname: nickname || null,
      });
    } catch {
      // api() already toasted the failure — stay in rename mode so the
      // user can retry or Escape out.
      return;
    }
    setRenaming(false);
    toast(nickname ? "Drive renamed" : "Nickname cleared", "ok");
    load().catch((e: unknown) =>
      console.error("post-rename refresh failed", e),
    );
  };

  const searchPhotos = async () => {
    const q = photoQuery.trim() || nameGuess(detailOrNull);
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
    } catch (e) {
      // api() already toasted the failure; the catch only stops propagation.
      console.error("photo search failed", e);
    }
  };

  const choosePhoto = async (hit: PhotoHit) => {
    try {
      await apiPost(`/api/drives/${driveId}/photo`, { url: hit.full });
      toast("Photo saved", "ok");
      load().catch((e: unknown) =>
        console.error("post-save refresh failed", e),
      );
    } catch {
      /* toast already surfaced the failure */
    }
  };

  const clearPhoto = async () => {
    // photo clearing = set nickname-style: dedicated endpoint keeps guard happy
    try {
      await apiPost(`/api/drives/${driveId}/photo`, { clear: true });
      toast("Photo removed", "ok");
      load();
    } catch {
      /* toast already surfaced the failure */
    }
  };

  if (page.status !== "ok")
    return (
      <div class="canvas">
        <div class="note-card">
          {page.status === "not-found" ? (
            <>
              <Icon name="warn" size={20} />
              Drive not found — it may have been removed from the registry.
              <button type="button" class="btn" onClick={() => navigate(null)}>
                Back to all drives
              </button>
            </>
          ) : (
            <>
              <Icon name="clock" size={20} />
              {page.status === "error"
                ? `Loading failed: ${page.message} — retrying in the background`
                : "Loading drive…"}
            </>
          )}
        </div>
      </div>
    );
  // After the gate TS sees page as the ok branch — bind the narrowed detail.
  const detail = page.detail;

  const snap = detail.snapshot;
  const dj = snap?.dj ?? null;
  const name = detail.drive.nickname ?? detail.drive.name;
  const checks = report?.checks ?? [];
  // unknown tab → overview; the hoisted conf kills per-tab casts in JSX
  const tabConf = TABS.find((t) => t.id === props.tab) ?? TABS[0];
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
        {JOB_BUTTONS.map((b) => (
          <button
            type="button"
            key={b.kind}
            class={b.primary ? "btn primary" : "btn"}
            disabled={!detail.drive.mounted || locked || busy === b.kind}
            onClick={() => run(b.kind)}
            title={
              locked && b.interlockHint
                ? `${b.hint} — blocked right now: rekordbox is running`
                : b.hint
            }
          >
            <Icon name={b.icon} size={14} />{" "}
            {busy === b.kind ? (b.busy ?? b.label) : b.label}
          </button>
        ))}
        {detail.drive.role === "mirror" && (
          <button
            type="button"
            class="btn"
            disabled={!detail.drive.mounted || locked || busy === "mirror"}
            onClick={() => run("mirror")}
            title={
              locked
                ? "rekordbox is running"
                : "Copy master → this mirror (never writes the master)"
            }
          >
            <Icon name="copy" size={14} />{" "}
            {busy === "mirror" ? "Mirroring…" : "Mirror"}
          </button>
        )}
        <a
          class="btn"
          href={`/api/drives/${driveId}/export`}
          download
          title="Download a full status dossier (report, playlists, checks) as a file"
        >
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
            class={tabConf.id === t.id ? "on" : ""}
            onClick={() => navigate(driveId, t.id)}
            title={t.title}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
            {counts[t.id] !== undefined && (
              <span class="tabn">{counts[t.id]}</span>
            )}
          </button>
        ))}
      </div>

      {tabConf.id === "overview" && (
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

      {tabConf.id === "playlists" && <PlaylistsTab snap={snap} />}

      {tabConf.id === "health" && (
        <HealthTab drive={detail.drive} snap={snap} bench={bench} />
      )}

      {tabConf.id === "verify" && (
        <VerifyTab driveId={driveId} report={verify} />
      )}

      {tabConf.id === "timeline" && (
        <TimelineTab events={timeline} driveId={driveId} />
      )}

      {tabConf.id === "photos" && (
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
              <ConfirmButton
                label="Remove photo"
                confirmLabel="Remove photo — sure?"
                hint="Deletes the cover photo (the file stays on disk untouched)"
                onConfirm={clearPhoto}
              />
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
  return d?.drive.nickname ?? d?.drive.name ?? "";
}
