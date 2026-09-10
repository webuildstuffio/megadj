// DriveRail.tsx — the integrated left rail. Every known drive lives here
// forever: mounted drives show a status icon + a real check SCORE; ghosts
// stay dimmed. This replaces the old drawer-open model — selecting a drive
// swaps the canvas. Card anatomy, top to bottom: photo thumb (or the drive
// icon), name + role chip, plain-language sub line (free of total when we
// have capacity), the score line ("7 of 9 checks passed · 2 to fix"), the
// shelf-sweep line when one exists, the space bar, and up to 3 badges
// ranked worst-first (attn → stale → unknown → …) with a "+N" overflow.
import type {
  DriveCardData,
  OverallHealth,
  ReportSummary,
} from "../../../shared/types";
import { rankBadges } from "../../../shared/badges";
import { fmtBytes, timeAgo } from "../../../shared/fmt";
import { ROLE_HELP } from "../../../shared/help";
import { Icon } from "../../ui/icons";
import { InfoTip } from "../../ui/InfoTip";

const VERDICT_COLOR: Record<OverallHealth, string> = {
  healthy: "var(--accent)",
  attention: "var(--warn)",
  critical: "var(--bad)",
  unknown: "var(--muted)",
};

/** The circular verdict glyph per state — a check/warn/x INSIDE a circle
 *  reads at any size (the old bare "!" was ambiguous: missing icon? alert?
 *  exclamation?). Dashed circle = no report yet, honest-unknown. */
const VERDICT_ICON: Record<OverallHealth, string> = {
  healthy: "circleCheck",
  attention: "circleAlert",
  critical: "circleX",
  unknown: "circleDashed",
};

/** Ring hover copy — the verdict words mean the same thing everywhere. */
const RING_HELP: Record<OverallHealth, string> = {
  healthy: "All measured checks passed.",
  attention: "Usable, but warnings need a look — open the drive for the list.",
  critical: "At least one check FAILED. Open the drive before trusting it.",
  unknown: "No data yet — run a Scan (unknown never fakes healthy).",
};

/** The verdict badge that rides the photo corner when a report exists:
 *  the icon IS the verdict, the tooltip carries the words + score. */
function VerdictChip(props: {
  verdict: OverallHealth;
  report?: ReportSummary;
}) {
  return (
    <InfoTip
      side
      title={props.verdict}
      body={`${RING_HELP[props.verdict]}${props.report ? ` Score: ${props.report.passed} of ${props.report.checks} checks passed.` : " (dashed circle = no report yet)"}`}
    >
      <span
        class="dcard-verdict"
        style={{ color: VERDICT_COLOR[props.verdict] }}
        title={
          props.report
            ? `${props.verdict} — ${props.report.passed}/${props.report.checks} checks`
            : props.verdict
        }
      >
        <Icon name={VERDICT_ICON[props.verdict]} size={17} />
      </span>
    </InfoTip>
  );
}

export function DriveRail(props: {
  drives: DriveCardData[];
  reports: Map<string, ReportSummary>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  ports: { port_key: string; drive_name: string | null; mounted: boolean }[];
}) {
  const mounted = props.drives.filter((d) => d.mounted);
  const ghosts = props.drives.filter((d) => !d.mounted);
  const railCard = (d: DriveCardData) => (
    <RailCard
      key={d.id}
      drive={d}
      report={props.reports.get(d.id)}
      on={props.selectedId === d.id}
      onSelect={() => props.onSelect(d.id)}
    />
  );
  return (
    <aside class="rail">
      <div class="rail-head">
        <h2>Crate shelf</h2>
        <span class="count">
          {mounted.length} in · {ghosts.length} ghost
        </span>
      </div>
      {props.drives.length === 0 && (
        <div class="note-card">
          <Icon name="usb" size={22} />
          No drives known yet — plug one in and it will appear here, forever. It
          stays browsable as a "ghost" after unmounting.
        </div>
      )}
      {mounted.map(railCard)}
      {ghosts.length > 0 && (
        <>
          <div class="rail-head" style={{ marginTop: 6 }}>
            <h2>Ghosts</h2>
            <span
              class="count"
              title="Known drives that aren't plugged in — their last snapshot stays browsable."
            >
              last-scan state
            </span>
          </div>
          {ghosts.map(railCard)}
        </>
      )}
      {props.ports.length > 0 && (
        <>
          <div class="rail-head" style={{ marginTop: 8 }}>
            <h2>Ports</h2>
            <span
              class="count"
              title="Physical USB ports and which drive was last seen in each — handy for 'which port is the mirror' habits."
            >
              physical slots
            </span>
          </div>
          <div class="portstrip">
            {props.ports.map((p) => (
              <span class="port" key={p.port_key}>
                <span class={"dot " + (p.mounted ? "on" : "off")} />
                <b>{p.drive_name ?? "unknown drive"}</b>
                {!p.mounted && <span class="port-last">last</span>}
              </span>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

function RailCard(props: {
  drive: DriveCardData;
  report?: ReportSummary;
  on: boolean;
  onSelect: () => void;
}) {
  const d = props.drive;
  const name = d.nickname ?? d.name;
  const snap = d.snapshot_summary;
  const cap = d.capacity_bytes ? fmtBytes(d.capacity_bytes) : null;
  const report = props.report;
  const verdict = report?.overall ?? "unknown";
  const badges = rankBadges(d.badges, 3);

  // plain-language second line. Mounted drives show free of total when both
  // sides are known ("142.8 GB free of 1.9 TB") — LIVE free space first
  // (server measures at payload build), snapshot truth as fallback. Total
  // comes from the snapshot when it has one, else the Drive row's diskutil
  // capacity (legacy snapshots often lack it). The track count keeps its
  // own line so neither gets truncated into meaninglessness.
  const totalBytes = snap?.capacity_bytes || d.capacity_bytes;
  const free = snap?.live_free_bytes ?? snap?.free_bytes;
  const sub = d.mounted
    ? free !== null && free !== undefined && totalBytes
      ? `${fmtBytes(free)} free of ${fmtBytes(totalBytes)}`
      : (cap ?? "—")
    : `ghost · seen ${timeAgo(d.last_seen_at)}`;

  return (
    <button
      type="button"
      class={`dcard${d.mounted ? "" : " ghost"}${props.on ? " on" : ""}`}
      onClick={props.onSelect}
    >
      <div class="dcard-top">
        <div class="photo">
          {d.photo_path ? (
            <img
              src={`/photos/${d.id}?v=${d.last_seen_at}`}
              alt=""
              loading="lazy"
            />
          ) : (
            <Icon name="usb" size={20} />
          )}
          <VerdictChip verdict={verdict} report={report} />
        </div>
        <div class="idbox">
          <div class="name">
            <span
              class="dcard-name"
              title={`${name}${ROLE_HELP[d.role] ? ` — ${ROLE_HELP[d.role]}` : ""}`}
            >
              {name}
            </span>
            {d.role !== "unknown" && (
              <span class={`rolechip ${d.role}`} title={ROLE_HELP[d.role]}>
                {d.role}
              </span>
            )}
          </div>
          <div class="sub" title={sub}>
            {sub}
          </div>
          {d.mounted && snap?.track_count !== undefined && (
            <div class="sub">
              {snap.track_count.toLocaleString()} tracks
              {snap.file_count !== undefined &&
                snap.file_count !== snap.track_count &&
                ` · ${snap.file_count.toLocaleString()} files`}
            </div>
          )}
          {report && report.checks > 0 && (
            <div
              class={`sub scoreline${report.failed > 0 || report.warned > 0 ? " haswarn" : ""}`}
            >
              <b>
                {report.passed} of {report.checks}
              </b>{" "}
              checks passed
              {report.failed > 0 && (
                <span class="score-fails"> · {report.failed} to fix</span>
              )}
              {report.warned > 0 && (
                <span class="score-warns"> · {report.warned} warnings</span>
              )}
            </div>
          )}
          {d.shelf_sweep && (
            <div
              class={`sub sweepline${(d.shelf_sweep.ageDays ?? 0) > 30 || d.shelf_sweep.verdict === "failed" ? " stale" : ""}`}
              title={`Last drive→shelf sweep: ${d.shelf_sweep.verdict}, ${d.shelf_sweep.files_seen.toLocaleString()} files (${d.shelf_sweep.copied} copied, ${d.shelf_sweep.preserved} preserved as twins)`}
            >
              shelf: {d.shelf_sweep.verdict} ·{" "}
              {d.shelf_sweep.files_seen.toLocaleString()} files
              {d.shelf_sweep.finished_at
                ? ` · ${Math.floor(d.shelf_sweep.ageDays ?? 0)}d ago`
                : " · running"}
            </div>
          )}
        </div>
      </div>
      {d.mounted &&
        snap &&
        (snap.free_bytes ?? snap.live_free_bytes) != null &&
        snap.capacity_bytes && (
          <div class="spacestrip">
            <div class="bar">
              <i
                class={
                  1 -
                    (snap.free_bytes ?? snap.live_free_bytes)! /
                      snap.capacity_bytes >
                  0.85
                    ? "hot"
                    : ""
                }
                style={{
                  width: `${Math.min(
                    100,
                    (1 -
                      ((snap.free_bytes ?? snap.live_free_bytes) as number) /
                        snap.capacity_bytes) *
                      100,
                  )}%`,
                }}
              />
            </div>
          </div>
        )}
      {(badges.top.length > 0 || badges.extra.length > 0) && (
        <div class="badges">
          {badges.top.map((b) => (
            <span class={`badge ${b.tone}`} key={b.key + b.label}>
              {b.label}
            </span>
          ))}
          {badges.extra.length > 0 && (
            <InfoTip
              side
              title={`+${badges.extra.length} more`}
              body={badges.extra.map((b) => b.label).join(" · ")}
            >
              <span class="badge muted">+{badges.extra.length}</span>
            </InfoTip>
          )}
        </div>
      )}
    </button>
  );
}
