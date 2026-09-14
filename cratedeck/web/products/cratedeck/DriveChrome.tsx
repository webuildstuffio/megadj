import type { DriveReport, Job } from "../../../shared/types";
import { fmtBytes, timeAgo } from "../../../shared/fmt";
import { ROLE_HELP, VERDICT_HELP } from "../../../shared/help";
import { Icon } from "../../ui/icons";
import { InfoTip } from "../../ui/InfoTip";
import type { DriveDetail } from "./useDriveData";

export function DriveHero(props: {
  detail: DriveDetail;
  report: (DriveReport & { overall?: string }) | null;
  driveId: string;
  name: string;
  renaming: boolean;
  nameDraft: string;
  setRenaming: (value: boolean) => void;
  setNameDraft: (value: string) => void;
  rename: (nickname: string | null) => Promise<void>;
}) {
  const { detail } = props;
  return (
    <div class="hero">
      <div class="photo">
        {detail.drive.photo_path ? (
          <img
            src={`/photos/${props.driveId}?v=${detail.drive.last_seen_at}`}
            alt={props.name}
          />
        ) : (
          <Icon name="usb" size={26} />
        )}
      </div>
      <div class="hid">
        {props.renaming ? (
          <span class="name-edit">
            <input
              value={props.nameDraft}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (!props.nameDraft.trim()) props.setRenaming(false);
                  else void props.rename(props.nameDraft.trim());
                }
                if (event.key === "Escape") {
                  event.stopPropagation();
                  props.setRenaming(false);
                }
              }}
              onInput={(event) =>
                props.setNameDraft((event.target as HTMLInputElement).value)
              }
            />
            <button
              type="button"
              class="btn sm primary"
              onClick={() =>
                props.nameDraft.trim()
                  ? void props.rename(props.nameDraft.trim())
                  : props.setRenaming(false)
              }
            >
              Save
            </button>
            <button
              type="button"
              class="btn sm ghostbtn"
              onClick={() => props.setRenaming(false)}
            >
              Cancel
            </button>
          </span>
        ) : (
          <h2>
            {props.name}
            {!detail.drive.mounted && (
              <span
                class="badge muted"
                title="Ghost: not plugged in right now — everything below reads from the last snapshot."
              >
                ghost
              </span>
            )}
            <span class={`pill ${props.report?.overall ?? "unknown"}`}>
              {props.report?.overall ?? "unknown"}
            </span>
            <InfoTip
              title={`verdict: ${props.report?.overall ?? "unknown"}`}
              body={
                VERDICT_HELP[props.report?.overall ?? "unknown"] ??
                "No report yet — run a scan."
              }
              why="Worst status wins: one failing check makes the whole drive critical — the failing rows just below say which."
              below
            />
            <InfoTip
              title={`role: ${detail.drive.role}`}
              body={
                ROLE_HELP[detail.drive.role] ??
                "Role derived from the configured master/mirror volume names."
              }
            />
            <button
              type="button"
              class="btn sm ghostbtn"
              title="Rename drive"
              onClick={() => {
                props.setRenaming(true);
                props.setNameDraft(detail.drive.nickname ?? detail.drive.name);
              }}
            >
              <Icon name="pencil" size={13} />
            </button>
          </h2>
        )}
        <div class="hsub">
          <span>{detail.drive.name}</span>
          <span class="sep">·</span>
          <span>
            {detail.drive.capacity_bytes
              ? fmtBytes(detail.drive.capacity_bytes)
              : "—"}
          </span>
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
  );
}

/** Bounded recent-job summary kept separate from the main drive controller. */
export function RecentDriveJobs(props: {
  jobs: Job[];
  failing: number;
  warning: number;
}) {
  if (props.jobs.length === 0) return null;
  return (
    <>
      <h3 class="sect">
        <Icon name="clock" /> Recent jobs
      </h3>
      <div class="checks">
        {props.jobs.slice(0, 5).map((job) => (
          <div class="check" key={job.id}>
            <span class={`jstat ${job.status}`}>{job.status}</span>
            <span class="check-body">
              <b>{job.kind}</b>
              <span class="check-detail">
                {job.error ??
                  job.message ??
                  (job.finished_at
                    ? new Date(job.finished_at).toLocaleString()
                    : "…")}
              </span>
            </span>
            {job.status === "running" && (
              <span class="progressbar" style={{ alignSelf: "center" }}>
                <i style={{ width: `${Math.round(job.progress * 100)}%` }} />
              </span>
            )}
          </div>
        ))}
      </div>
      {(props.failing > 0 || props.warning > 0) && (
        <div class="note" style={{ marginTop: 12 }}>
          {props.failing > 0
            ? `${props.failing} check${props.failing > 1 ? "s" : ""} failing`
            : `${props.warning} warning${props.warning > 1 ? "s" : ""}`}{" "}
          — see Overview.
        </div>
      )}
    </>
  );
}
