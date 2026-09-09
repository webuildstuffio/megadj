// DriveRail.tsx — the integrated left rail. Every known drive lives here
// forever: mounted drives get a live health ring; ghosts stay dimmed. This
// replaces the old drawer-open model — selecting a drive swaps the canvas.
import type { DriveCardData, OverallHealth } from "../../../shared/types";
import { fmtBytes, timeAgo } from "../../../shared/fmt";
import { ROLE_HELP } from "../../../shared/help";
import { Icon } from "../../ui/icons";
import { InfoTip } from "../../ui/InfoTip";
import { Donut } from "../../ui/charts";

const VERDICT_COLOR: Record<OverallHealth, string> = {
  healthy: "var(--accent)",
  attention: "var(--warn)",
  critical: "var(--bad)",
  unknown: "var(--muted)",
};

/** Ring hover copy — the verdict words mean the same thing everywhere. */
const RING_HELP: Record<OverallHealth, string> = {
  healthy: "All measured checks passed.",
  attention: "Usable, but warnings need a look — open the drive for the list.",
  critical: "At least one check FAILED. Open the drive before trusting it.",
  unknown: "No data yet — run a Scan (unknown never fakes healthy).",
};

function HealthRing({
  verdict,
  pct,
  hasReport,
}: {
  verdict: OverallHealth;
  pct: number;
  /** A report exists (even one that scored 0) — distinct from no data. */
  hasReport: boolean;
}) {
  // no report yet = unknown data, not zero data — the indeterminate dashed
  // arc keeps "no data" visually distinct from "worst data" (0% pass)
  const color = VERDICT_COLOR[verdict] ?? VERDICT_COLOR.unknown;
  return (
    <InfoTip
      side
      title={verdict}
      body={`${RING_HELP[verdict]}${hasReport ? "" : " (dashed ring = no report yet)"}`}
    >
      <Donut
        pct={pct}
        hasData={hasReport}
        color={color}
        title={`${verdict}${hasReport ? ` — ${Math.round(pct * 100)}% checks passed` : " — no report yet"}`}
        label={
          verdict === "healthy"
            ? "✓"
            : verdict === "critical" || verdict === "attention"
              ? "!"
              : "·"
        }
      />
    </InfoTip>
  );
}

export function DriveRail(props: {
  drives: DriveCardData[];
  reports: Map<string, { overall?: OverallHealth; pass_rate?: number }>;
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
  report?: { overall?: OverallHealth; pass_rate?: number };
  on: boolean;
  onSelect: () => void;
}) {
  const d = props.drive;
  const name = d.nickname ?? d.name;
  const snap = d.snapshot_summary;
  const cap = d.capacity_bytes ? fmtBytes(d.capacity_bytes) : null;
  const pctUsed =
    snap?.capacity_bytes && (snap.free_bytes ?? -1) >= 0
      ? 1 - (snap.free_bytes as number) / snap.capacity_bytes
      : null;
  const verdict = props.report?.overall ?? "unknown";
  // undefined report = no data (dashed arc); a real 0 pass_rate stays solid
  const ringPct = props.report?.pass_rate ?? 0;

  return (
    <button
      type="button"
      class={`dcard${d.mounted ? "" : " ghost"}${props.on ? " on" : ""}`}
      onClick={props.onSelect}
    >
      <div class="dcard-top">
        <HealthRing
          verdict={verdict}
          pct={ringPct}
          hasReport={props.report !== undefined}
        />
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
          <div class="sub">
            {d.mounted
              ? `${cap ?? "—"} · ${snap?.track_count?.toLocaleString() ?? snap?.file_count?.toLocaleString() ?? "?"} tracks`
              : `ghost · seen ${timeAgo(d.last_seen_at)}`}
          </div>
        </div>
      </div>
      {pctUsed !== null && (
        <div class="spacestrip">
          <div class="bar">
            <i
              class={pctUsed > 0.85 ? "hot" : ""}
              style={{ width: `${Math.min(100, pctUsed * 100)}%` }}
            />
          </div>
        </div>
      )}
      {d.badges.length > 0 && (
        <div class="badges">
          {d.badges.slice(0, 3).map((b) => (
            <span class={`badge ${b.tone}`} key={b.key + b.label}>
              {b.label}
            </span>
          ))}
          {d.badges.length > 3 && (
            <InfoTip
              side
              title={`+${d.badges.length - 3} more`}
              body={d.badges
                .slice(3)
                .map((b) => b.label)
                .join(" · ")}
            >
              <span class="badge muted">+{d.badges.length - 3}</span>
            </InfoTip>
          )}
        </div>
      )}
    </button>
  );
}
