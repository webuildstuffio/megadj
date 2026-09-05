// VerifyTab.tsx — the granular "what does verify check and what did it find"
// view. Every check gets a status chip, the raw numbers, a plain-English
// "why this matters", and (when failing) the fix. Includes the full
// explainer for people (and agents) who don't know what verify is.
import { useEffect, useState } from "preact/hooks";
import type { VerifyCheck, VerifyReport } from "../shared/types";
import { timeAgo } from "../shared/fmt";
import { api, toast } from "./toast";
import { Icon } from "./icons";

interface HelpDoc {
  intro: string;
  duration: string;
  safety: string;
  checks: {
    id: string;
    label: string;
    what: string;
    why: string;
    if_fail: string;
    fix: string;
  }[];
}

const STATUS_ICON: Record<VerifyCheck["status"], string> = {
  pass: "check",
  fail: "warn",
  warn: "warn",
  unknown: "dot",
};

export function VerifyTab(props: {
  driveId: string;
  report: VerifyReport | null;
}) {
  const { driveId, report } = props;
  const [help, setHelp] = useState<HelpDoc | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    fetch(`/api/drives/${driveId}/verify/help`)
      .then((r) => r.json() as Promise<HelpDoc>)
      .then(setHelp)
      .catch((e: unknown) => {
        console.error(`verify help for ${driveId} failed`, e);
        // the tab still works without the help doc (report + run button are
        // self-contained) — the failure is logged, not hidden.
      });
  }, [driveId]);

  const runVerify = async () => {
    setRunning(true);
    try {
      await api(`/api/drives/${encodeURIComponent(driveId)}/jobs`, {
        method: "POST",
        body: JSON.stringify({ kind: "verify" }),
      });
      toast("Verify started — progress in the job dock below");
    } catch (e) {
      toast((e as Error).message || "could not start verify");
    } finally {
      setRunning(false);
    }
  };

  const failed = report?.checks?.filter((c) => c.status !== "pass") ?? [];
  const passed = report?.checks?.filter((c) => c.status === "pass") ?? [];

  return (
    <div class="verifytab">
      <div class="note">
        <Icon name="shield" size={14} />
        <span>
          {help?.intro ??
            "Verify reads both rekordbox databases on the drive and checks that every track, waveform, beatgrid and playlist is really there and consistent — read-only, nothing is modified."}
        </span>
      </div>

      <div class="vmeta">
        {report ? (
          <>
            <span>
              <Icon name="clock" size={12} /> last ran {timeAgo(report.ran_at)}
            </span>
            {report.duration_s != null && (
              <span>· took {report.duration_s}s</span>
            )}
            <span class="sep">·</span>
            <span class={report.ok ? "good" : "bad"}>
              {report.ok
                ? `all ${report.checks.length} checks passed`
                : `${failed.length} of ${report.checks.length} checks need attention`}
            </span>
          </>
        ) : (
          <span class="muted">never verified on this drive yet</span>
        )}
        <button
          type="button"
          class="btn sm"
          onClick={runVerify}
          disabled={running}
          title="Read-only integrity check of both databases, files, waveforms and (if both drives plugged) mirror parity. Requires rekordbox to be closed."
        >
          <Icon name="check" size={13} />
          {running ? "starting…" : "Run verify"}
        </button>
      </div>

      {!report && (
        <div class="vnever">
          <p>
            <b>What you get:</b> a check-by-check breakdown of drive health from
            the hardware's point of view — not just "it's fine", but
            <i> what was checked and how many tracks each check covered</i>.
          </p>
          <ul>
            {(help?.checks ?? []).map((c) => (
              <li key={c.id}>
                <b>{c.label}</b> — {c.what}
              </li>
            ))}
          </ul>
          {help && (
            <p class="muted">
              {help.safety} Typical duration: {help.duration}
            </p>
          )}
        </div>
      )}

      {report && (
        <>
          <DeltasBar report={report} />
          {failed.length > 0 && (
            <div class="vgroup vfail">
              <h3>
                <Icon name="warn" size={13} /> Needs attention ({failed.length})
              </h3>
              {failed.map((c) => (
                <CheckCard key={c.id} c={c} />
              ))}
            </div>
          )}
          {passed.length > 0 && (
            <div class="vgroup vpass">
              <h3>
                <Icon name="check" size={13} /> Passed ({passed.length})
              </h3>
              {passed.map((c) => (
                <CheckCard key={c.id} c={c} />
              ))}
            </div>
          )}
          {Object.keys(report.stats).length > 0 && (
            <div class="vstats">
              {Object.entries(report.stats).map(([k, v]) => (
                <span class="vstat" key={k}>
                  {k.replace(/_/g, " ")}: <b>{v}</b>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CheckCard(props: { c: VerifyCheck }) {
  const { c } = props;
  const ok = c.status === "pass";
  return (
    <div class={`vcheck ${ok ? "ok" : c.status}`}>
      <div class="vhead">
        <Icon name={STATUS_ICON[c.status]} size={14} />
        <b>{c.label}</b>
        <span class={`chip ${c.status}`}>{c.status}</span>
      </div>
      <div class="vdetail">{c.detail}</div>
      <OffenderList c={c} />
      <div class="vwhy" title="Why this check matters">
        <Icon name="dot" size={11} /> {c.meaning}
      </div>
      {!ok && c.fix && (
        <div class="vfix">
          <Icon name="sliders" size={11} /> <b>Fix:</b> {c.fix}
        </div>
      )}
    </div>
  );
}

/** Track-path list for failing checks — exactly WHAT needs attention,
 *  capped with the true total. Passes with offenders=0 render nothing. */
function OffenderList(props: { c: VerifyCheck }) {
  const { c } = props;
  if (c.status === "pass" || !c.offenders?.length) return null;
  const total = c.offender_count ?? c.offenders.length;
  return (
    <div class="voffenders">
      <div class="voffhead">
        {total} track{total === 1 ? "" : "s"}:
      </div>
      {c.offenders.slice(0, 8).map((p) => (
        <div class="voff" key={p} title={p}>
          {trackName(p)}
        </div>
      ))}
      {total > 8 && (
        <div class="voff more">
          +{total - 8} more (full list in the job log — deckctl jobs)
        </div>
      )}
    </div>
  );
}

/** "Contents/YTMusic Liked/Artist - Title.mp3" → "Artist - Title" */
function trackName(p: string): string {
  const base = p.split("/").pop() ?? p;
  return base.replace(/\.[a-z0-9]+$/i, "");
}

/** Delta strip: what changed since the previous stored run. */
function DeltasBar(props: { report: VerifyReport }) {
  const { report } = props;
  const deltas = report.deltas ?? [];
  if (!report.prev_ran_at || deltas.length === 0) return null;
  const worsened = deltas.filter((d) => d.delta > 0);
  const improved = deltas.filter((d) => d.delta < 0);
  const flipped = deltas.filter((d) => d.delta === 0);
  if (!worsened.length && !improved.length && !flipped.length) {
    return (
      <div class="vdeltas same">
        <Icon name="check" size={12} /> identical to the previous run (
        {new Date(report.prev_ran_at).toLocaleString()})
      </div>
    );
  }
  return (
    <div class="vdeltas">
      <span class="vdhead">
        vs previous run ({new Date(report.prev_ran_at).toLocaleString()}):
      </span>
      {worsened.map((d) => (
        <span class="vdelta worse" key={d.check_id}>
          <Icon name="warn" size={11} /> {d.label}: +{d.delta} new
        </span>
      ))}
      {improved.map((d) => (
        <span class="vdelta better" key={d.check_id}>
          <Icon name="check" size={11} /> {d.label}: {d.delta} fixed
        </span>
      ))}
      {flipped.map((d) => (
        <span class="vdelta" key={d.check_id}>
          {d.label}: status {d.prev_status} → now failing with {d.count}
        </span>
      ))}
    </div>
  );
}
