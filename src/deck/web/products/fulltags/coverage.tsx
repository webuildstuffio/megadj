// coverage.tsx — the shared analysis-coverage read + strip (#233 split
// from tabs.tsx): one hook for the unified coverage fetch and
// the per-ledger meter strip every FullTags analysis tab mounts, so the
// three views can't disagree about progress.
import type { ArchiveAnalysisCoverage } from "../../../shared/types";
import { api } from "../../ui/toast";
import { Icon } from "../../ui/icons";
import { useFetched } from "../../ui/useFetched";
import { Meter } from "../shared";

/** One hook for the unified analysis-coverage read: playable tracks vs the
 *  beats/mood/cues ledgers in a single picture. null ledger = pre-analysis
 *  DB (table absent), rendered as "not run yet", never as 0-of-N. */
export function useCoverage(): ArchiveAnalysisCoverage | null {
  const page = useFetched<ArchiveAnalysisCoverage>(
    () => api<ArchiveAnalysisCoverage>("/api/archive/analysis-coverage"),
    [],
  );
  return page.status === "ok" ? page.data : null;
}

/** The coverage strip: one meter per analysis ledger, shared by every
 *  FullTags analysis tab so the three views can't disagree about progress. */
export function CoverageStrip(props: {
  cov: ArchiveAnalysisCoverage | null;
  active: "beats" | "mood" | "cues";
}) {
  const { cov } = props;
  if (!cov || !cov.available) return null;
  const LEDGERS = [
    { key: "beats", label: "beatgrids", cmd: "megadj beats" },
    { key: "mood", label: "mood", cmd: "megadj mood" },
    { key: "cues", label: "cues", cmd: "megadj cues" },
  ] as const;
  return (
    <div class="card ft-coverage">
      <div class="ft-coverage-head">
        <Icon name="pulse" size={14} />
        <b>Analysis coverage</b>
        <span class="muted">{cov.tracks.toLocaleString()} playable tracks</span>
      </div>
      {LEDGERS.map((l) => {
        const n = cov[l.key];
        return (
          <div class="ft-coverage-row" key={l.key}>
            {n === null ? (
              <>
                <span class="ft-coverage-label">{l.label}</span>
                <span class="ft-meter na">
                  <span class="ft-meter-fill" style={{ width: "0%" }} />
                  <span class="ft-meter-label">ledger not created</span>
                </span>
                <code class="ft-coverage-cmd">{l.cmd}</code>
              </>
            ) : (
              <>
                <span class="ft-coverage-label">{l.label}</span>
                <Meter
                  done={n}
                  total={cov.tracks || n}
                  label=""
                  cls={
                    n >= cov.tracks ? "ok" : props.active === l.key ? "" : "dim"
                  }
                />
                <code class="ft-coverage-cmd">
                  {n >= cov.tracks ? "complete" : l.cmd}
                </code>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
