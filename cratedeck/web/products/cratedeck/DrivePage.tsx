// DrivePage.tsx — the main canvas for one drive. Replaces the old drawer:
// full-width sections, tabbed, deep-linkable via hash routing
// (#/drives/:id/:tab). Polls the API and merges SSE job updates.
import { useEffect } from "preact/hooks";
import type { InterlockState, JobKind } from "../../../shared/types";
import { TIER_EXPLANATION } from "../../../shared/check_matrix";
import { Icon } from "../../ui/icons";
import { navigate } from "../../app/router";
import { HELP_JOBS } from "../../../shared/help";
import { PhotoTab } from "./PhotoTab";
import { DRIVE_TABS } from "../shared";
import { useDriveData, type DriveDetail } from "./useDriveData";
import { FixesTab } from "./FixesTab";
import { HealthTab } from "./HealthTab";
import { HygieneTab } from "./HygieneTab";
import { OverviewTab } from "./OverviewTab";
import { PlaylistsTab } from "./PlaylistsTab";
import { TimelineTab } from "./TimelineTab";
import { VerifyTab } from "./VerifyTab";
import { DriveHero, RecentDriveJobs } from "./DriveChrome";
import { useDriveActions } from "./useDriveActions";

type TabId = (typeof DRIVE_TABS)[number]["id"];

/** Plain-language hover hint for a job kind, built from the shared help
 *  SSOT (shared/help.ts) so tooltips, the Welcome tour and the API agree. */
function jobHint(kind: JobKind): string {
  const j = HELP_JOBS.find((x) => x.kind === kind);
  if (!j) return "";
  return `${j.what}\nWhen: ${j.when}\nTakes ${j.duration}. ${j.safety}`;
}

/** The four standard drive jobs — one config row per button, one render
 *  loop. `kind` stays a literal per row (the surface-parity census parses
 *  these); the copy comes from jobHint(). */
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
    hint: jobHint("scan"),
  },
  {
    kind: "verify",
    label: "Verify",
    icon: "shield",
    interlockHint: true,
    hint: jobHint("verify"),
  },
  {
    kind: "benchmark",
    label: "Benchmark",
    icon: "pulse",
    hint: jobHint("benchmark"),
  },
  {
    kind: "speedtest",
    label: "Speed probe",
    icon: "zap",
    hint: jobHint("speedtest"),
  },
  {
    kind: "checksum",
    label: "Checksum",
    icon: "hash",
    hint: jobHint("checksum"),
  },
];

export function DrivePage(props: {
  driveId: string;
  tab: string;
  interlock: InterlockState;
}) {
  const { driveId, interlock } = props;
  const {
    page,
    report,
    timeline,
    bench,
    probes,
    jobs,
    verify,
    refresh: load,
  } = useDriveData(driveId);
  const detailOrNull = page.status === "ok" ? page.detail : null;
  const {
    busy,
    renaming,
    nameDraft,
    photoHits,
    photoQuery,
    driveImages,
    setRenaming,
    setNameDraft,
    setPhotoQuery,
    run,
    rename,
    searchPhotos,
    choosePhoto,
    chooseDriveImage,
    uploadPhoto,
    clearPhoto,
  } = useDriveActions({
    driveId,
    tab: props.tab,
    mounted: detailOrNull?.drive.mounted ?? false,
    photoFallbackName: nameGuess(detailOrNull),
    refresh: load,
  });
  const locked = interlock.rekordbox_running;
  // hygiene + fixes ride only the shelf master (§4.3) — same condition the
  // server uses for the drive-list badge, so the two can't disagree
  const isShelf = detailOrNull?.drive.role === "shelf";
  const tabs = isShelf
    ? DRIVE_TABS
    : DRIVE_TABS.filter((tab) => tab.id !== "hygiene" && tab.id !== "fixes");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const inEditor =
        renaming ||
        (document.activeElement instanceof HTMLInputElement &&
          document.activeElement.closest(".name-edit, .pl-tools, .search"));
      if (event.key === "Escape" && !inEditor) navigate(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [renaming]);

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
  const { detail } = page;

  const snap = detail.snapshot;
  const name = detail.drive.nickname ?? detail.drive.name;
  const checks = report?.checks ?? [];
  // unknown tab → overview; the hoisted conf kills per-tab casts in JSX
  const tabConf = DRIVE_TABS.find((t) => t.id === props.tab) ?? DRIVE_TABS[0];
  const counts: Partial<Record<TabId, number>> = {
    ...(snap?.playlists?.length === undefined
      ? {}
      : { playlists: snap.playlists.length }),
    timeline: timeline.length,
  };
  const failing = checks.filter((c) => c.status === "fail").length;
  const warning = checks.filter((c) => c.status === "warn").length;
  const content = (() => {
    switch (tabConf.id) {
      case "playlists":
        return <PlaylistsTab snap={snap} />;
      case "health":
        return (
          <HealthTab
            drive={detail.drive}
            snap={snap}
            bench={bench}
            probes={probes}
          />
        );
      case "verify":
        return <VerifyTab driveId={driveId} report={verify} />;
      case "timeline":
        return <TimelineTab events={timeline} driveId={driveId} />;
      case "photos":
        return (
          <PhotoTab
            drive={detail.drive}
            driveId={driveId}
            name={nameGuess(detail)}
            photoQuery={photoQuery}
            setPhotoQuery={setPhotoQuery}
            onSearch={searchPhotos}
            hits={photoHits}
            onChoose={choosePhoto}
            onClear={clearPhoto}
            driveImages={driveImages}
            onChooseDriveImage={chooseDriveImage}
            onUploadFile={uploadPhoto}
          />
        );
      case "hygiene":
        return isShelf ? (
          <HygieneTab driveId={driveId} driveName={nameGuess(detail)} />
        ) : null;
      case "fixes":
        return isShelf ? (
          <FixesTab driveId={driveId} driveName={nameGuess(detail)} />
        ) : null;
      case "overview":
      default:
        return (
          <OverviewTab
            name={nameGuess(detail)}
            snap={snap}
            dj={snap?.dj ?? null}
            checks={checks}
          />
        );
    }
  })();
  return (
    <div class="canvas">
      <button type="button" class="crumb" onClick={() => navigate(null)}>
        <Icon name="back" size={13} /> all drives
      </button>

      <DriveHero
        detail={detail}
        report={report}
        driveId={driveId}
        name={name}
        renaming={renaming}
        nameDraft={nameDraft}
        setRenaming={setRenaming}
        setNameDraft={setNameDraft}
        rename={rename}
      />

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
                : jobHint("mirror") || "Copy master → this mirror"
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
          <Icon name="download" size={14} /> Export dossier
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
      {detail.drive.role === "shelf" && (
        <div class="note arch">
          <Icon name="database" size={14} /> <strong>Archive tier</strong> —
          storage, not a gig stick. {TIER_EXPLANATION.archive}
        </div>
      )}

      <div class="tabs">
        {tabs.map((t) => (
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

      {content}

      <RecentDriveJobs jobs={jobs} failing={failing} warning={warning} />
    </div>
  );
}

/** Identity and hardware summary, including the inline nickname editor. */
function nameGuess(d: DriveDetail | null): string {
  return d?.drive.nickname ?? d?.drive.name ?? "";
}
