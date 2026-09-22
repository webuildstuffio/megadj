// MegasetArcChart.tsx — the set builder's two-lane arc chart, split out of
// MegasetPanel.tsx (file-length guard).
//
// The chain's energy lane: measured arousal riding the preset's target
// envelope (dashed) above; BPM lane below. One glance answers "does this
// build actually follow the journey I picked?" Position on the x axis is
// the real cumulative set time (atMin), so a 5-minute opener is not
// visually equal to a 30-minute stretch. Arousal 1–9 and the preset's
// envelope share the top lane; the BPM lane scales to its own min/max.
import type { MegasetStep, MegasetPresetDef } from "../../../shared/types";
import { linearScale } from "../../ui/charts";

/** Arousal 1–9 → the band word used in hover evidence and elsewhere. */
export const energyBand = (value: number): string =>
  value < 3.5 ? "Low" : value < 6 ? "Medium" : value < 8 ? "High" : "Maximum";

export function MegasetArcChart(props: {
  steps: MegasetStep[];
  preset: MegasetPresetDef;
  keyGlide: string | null;
}) {
  const W = 560;
  const H = 110;
  const padL = 34;
  const padR = 10;
  const arousalTop = 6;
  const arousalBottom = 44;
  const bpmTop = 62;
  const bpmBottom = 100;
  const arousalScale = linearScale(1, 9, arousalBottom, arousalTop);
  const bpms = props.steps
    .map((s) => s.bpm)
    .filter((b): b is number => b !== null);
  const bpmScale =
    bpms.length >= 2
      ? linearScale(Math.min(...bpms), Math.max(...bpms), bpmBottom, bpmTop)
      : null;
  const xAt = (atMin: number): number => {
    const last = props.steps[props.steps.length - 1];
    const total = last && last.atMin > 0 ? last.atMin : 1;
    return padL + (atMin / total) * (W - padL - padR);
  };
  const arousalPts = props.steps
    .filter((s) => s.arousal !== null)
    .map(
      (s) =>
        `${xAt(s.atMin).toFixed(1)},${arousalScale(s.arousal!).toFixed(1)}`,
    )
    .join(" ");
  const targetPts = [0, 1]
    .map((t) => {
      const env =
        props.preset.arousal[0]! +
        (props.preset.arousal[1]! - props.preset.arousal[0]!) * t;
      const x = padL + t * (W - padL - padR);
      return `${x.toFixed(1)},${arousalScale(env).toFixed(1)}`;
    })
    .join(" ");
  const bpmPts =
    bpmScale === null
      ? null
      : props.steps
          .filter((s) => s.bpm !== null)
          .map(
            (s) => `${xAt(s.atMin).toFixed(1)},${bpmScale(s.bpm!).toFixed(1)}`,
          )
          .join(" ");
  const bpmMin = bpms.length > 0 ? Math.round(Math.min(...bpms)) : 0;
  const bpmMax = bpms.length > 0 ? Math.round(Math.max(...bpms)) : 0;
  return (
    <figure
      class="megaset-arcchart"
      aria-label="Energy and BPM arc of the chain"
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Energy ${props.preset.label} envelope with the chain's arousal path, and ${bpmMin}–${bpmMax} BPM below`}
      >
        {/* preset target envelope (dashed) + measured arousal (solid) */}
        <polyline class="arc-envelope" points={targetPts} />
        {arousalPts && <polyline class="arc-arousal" points={arousalPts} />}
        {bpmPts && <polyline class="arc-bpm" points={bpmPts} />}
        {/* per-step hover targets: full-height invisible hit bars */}
        {props.steps.map((s, i) => (
          <g key={s.videoId}>
            <title>
              {`#${i + 1} ${s.artist ?? "?"} — ${s.title ?? s.videoId}\n${Math.round(s.atMin)} min · ${s.bpm === null ? "?" : Math.round(s.bpm)} BPM · ${s.key ?? "?"} · energy ${s.arousal === null ? "?" : `${energyBand(s.arousal)} (${s.arousal.toFixed(1)}/9)`}${s.transition === null ? "" : `\ntransition ${s.transition.toFixed(2)}`}${s.mixInCue === null ? "" : `\nmix-in ${Math.round(s.mixInCue.position)}s (bar ${s.mixInCue.bar})`}${s.mixOutCue === null ? "" : `\nmix-out ${Math.round(s.mixOutCue.position)}s (bar ${s.mixOutCue.bar})`}`}
            </title>
            <rect
              class="arc-hit"
              x={xAt(s.atMin) - 4}
              y={arousalTop}
              width={8}
              height={bpmBottom - arousalTop + 6}
            />
          </g>
        ))}
        {/* lane labels */}
        <text class="arc-label" x={2} y={arousalTop + 8}>
          energy
        </text>
        <text class="arc-label" x={2} y={bpmTop + 4}>
          bpm
        </text>
        {bpmScale && (
          <>
            <text class="arc-label" x={2} y={bpmTop + 16}>
              {bpmMax}
            </text>
            <text class="arc-label" x={2} y={bpmBottom}>
              {bpmMin}
            </text>
          </>
        )}
      </svg>
      <figcaption>
        <span class="arc-legend">
          <i class="arc-sw arousal" /> energy (measured)
          <i class="arc-sw envelope" /> {props.preset.label} target
          {bpmPts && <i class="arc-sw bpm" />} {bpmPts ? "bpm" : ""}
        </span>
        {props.keyGlide && (
          <span class="muted">key glide {props.keyGlide}</span>
        )}
        <span class="muted">
          {props.steps.length} tracks ·{" "}
          {Math.round(props.steps[props.steps.length - 1]!.atMin)} min
        </span>
      </figcaption>
    </figure>
  );
}
