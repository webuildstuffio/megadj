// OverviewTab.tsx — the drive page's report card: the verdict banner over
// the health-check rows, plus space/extension/age/DJ context panels.
//
// Extracted from DrivePage.tsx (Sep 8 UX pass) — the page crossed the
// 800-line guard when Overview grew its verdict banner + copy CTA, and
// Overview is a self-contained surface: checks in, context panels out.
import type { DriveReport, SnapshotData } from "../shared/types";
import { Icon } from "./icons";
import { AgeStrip, CheckRow, DjPanel, ExtBars, SpaceBar } from "./DrivePanels";
import { InfoTip, TabIntro } from "./InfoTip";
import { copyList } from "./ListHead";

export function OverviewTab(props: {
  name: string;
  snap: SnapshotData | null;
  dj: SnapshotData["dj"] | null;
  checks: NonNullable<DriveReport["checks"]>;
}) {
  const { name, snap, dj, checks } = props;
  const failing = checks.filter((c) => c.status === "fail").length;
  const warning = checks.filter((c) => c.status === "warn").length;

  return (
    <div>
      <TabIntro
        what="This is the drive's report card."
        how="The verdict banner is the one-line answer; below it every row is one health check with a verdict: green = measured and fine, yellow = usable but look into it, red = fix before a gig, grey = no data yet (grey never pretends to be green). Copy hands the failing/warning list to an agent."
        next="Deep audit with per-track detail lives in the Verify tab; this page is the quick verdict."
      />
      {checks.length > 0 && (
        <div
          class={`arch-verdict ${failing > 0 || warning > 0 ? "warn" : "ok"}`}
        >
          <Icon
            name={failing > 0 || warning > 0 ? "warn" : "check"}
            size={15}
          />
          <span>
            {failing > 0
              ? `${failing} check${failing > 1 ? "s" : ""} failing — fix before a gig`
              : warning > 0
                ? `${warning} warning${warning > 1 ? "s" : ""} — usable, but look into it`
                : `All ${checks.length} checks passed — this stick is gig-ready.`}
          </span>
          {(failing > 0 || warning > 0) && (
            <span class="arch-verdict-meta">
              <InfoTip
                title="Needs attention"
                body="Copy exports every failing/warning check with its measured detail — paste to an agent (or deckctl) to work the list."
                align="right"
              />
              <button
                type="button"
                class="btn sm ghostbtn"
                title="Copy the failing/warning checks — paste to an agent to work the list"
                onClick={() =>
                  copyList(
                    `${name} issues`,
                    checks
                      .filter((c) => c.status !== "pass")
                      .map(
                        (c) =>
                          `${c.id}: ${c.status}${c.detail ? ` — ${c.detail}` : ""}${c.fix ? ` | fix: ${c.fix}` : ""}`,
                      ),
                  )
                }
              >
                <Icon name="copy" size={12} /> Copy
              </button>
            </span>
          )}
        </div>
      )}
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
        <InfoTip
          title="Space"
          body="Used vs free against capacity. rekordbox needs headroom for its database journal and analysis files — under ~15% free degrades syncs and can corrupt exports."
          align="right"
        />
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
  );
}
