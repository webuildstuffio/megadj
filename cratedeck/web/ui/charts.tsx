// charts.tsx — the shared SVG chart kit: LineChart (multi-series with area,
// dots, tooltips), Sparkline (inline energy arcs), Histogram (div bars),
// Donut (verdict rings). Before this file each chart re-implemented its own
// min/max scale math (HealthTab, DrivePanels, PlaylistsTab, DriveRail) and
// BenchChart shipped preserveAspectRatio="none", which distorts stroke
// geometry on wide canvases. One scale helper, one tooltip pattern, honest
// unknowns (no data → dashed/empty, never fabricated zero).
//
// All components are pure SVG/CSS — no chart library (latest-tech rule:
// the dep would outlive its value; these are ~300 lines total).

// ---- scale helper -------------------------------------------------------------

export interface Scale {
  /** data value → pixel coordinate */
  (v: number): number;
  min: number;
  max: number;
}

/** Linear scale over [min..max] data → [a..b] pixels, zero-guarded. */
export function linearScale(
  min: number,
  max: number,
  a: number,
  b: number,
): Scale {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const span = hi - lo || 1;
  const fn = (v: number) => a + ((v - lo) / span) * (b - a);
  return Object.assign(fn, { min: lo, max: hi });
}

// ---- LineChart ----------------------------------------------------------------

export interface LineSeries {
  name: string;
  color: string;
  /** CSS color for the area fill under this series (omit = no area fill) */
  area?: string;
  dashed?: boolean;
  values: (number | null)[];
  /** hover tooltip per point */
  tip: (v: number, i: number) => string;
}

/** Multi-series SVG line chart with area fill, per-point <title> tooltips,
 *  y gridlines + axis labels, and a legend. Preserves aspect ratio (fixed
 *  viewBox scaled to width) so strokes don't distort. Nulls gap the line. */
export function LineChart(props: {
  series: LineSeries[];
  height?: number;
  /** y-axis unit label (e.g. "MB/s") */
  unit?: string;
  /** approx gridline count (default 3) */
  gridlines?: number;
}) {
  const H = props.height ?? 130;
  const W = 640;
  const PAD_L = 34;
  const PAD_R = 8;
  const PAD_T = 8;
  const PAD_B = 8;
  const all = props.series.flatMap((s) =>
    s.values.filter((v): v is number => v !== null),
  );
  if (all.length === 0) return null;
  const max = Math.max(...all);
  const min = Math.min(0, Math.min(...all));
  const n = Math.max(...props.series.map((s) => s.values.length));
  const x = (i: number) =>
    PAD_L + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD_L - PAD_R));
  const y = linearScale(min, max, H - PAD_B, PAD_T);
  const line = (vals: (number | null)[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const first = props.series[0];
  const areaD =
    first && first.area
      ? `${line(first.values)} L${x(n - 1).toFixed(1)},${(H - PAD_B).toFixed(1)} L${x(0).toFixed(1)},${(H - PAD_B).toFixed(1)} Z`
      : null;
  const ticks = props.gridlines ?? 3;
  return (
    <div class="chart">
      <div class="chart-legend">
        {props.series.map((s) => (
          <span class="key" key={s.name} title={s.name}>
            <span
              class="sw"
              style={{
                background: s.color,
                ...(s.dashed
                  ? {
                      backgroundImage:
                        "repeating-linear-gradient(90deg, currentColor 0 4px, transparent 4px 7px)",
                      background: "none",
                      borderTop: `2px dashed ${s.color}`,
                      height: 0,
                      width: 12,
                    }
                  : {}),
              }}
            />
            {s.name}
          </span>
        ))}
        {props.unit && (
          <span style={{ marginLeft: "auto" }}>
            {all.length} points · peak {fmtNum(max)} {props.unit}
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={props.series.map((s) => s.name).join(" and ") + " chart"}
      >
        {/* y gridlines + labels — the eye needs a scale, not just a shape */}
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const v = min + ((max - min) / ticks) * i;
          const py = y(v);
          return (
            <g key={i}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={py}
                y2={py}
                class="chart-grid"
              />
              <text x={PAD_L - 4} y={py + 3} class="chart-tick">
                {fmtNum(v)}
              </text>
            </g>
          );
        })}
        {areaD && first!.area && (
          <path d={areaD} fill={first!.area} stroke-width="0" opacity="0.35" />
        )}
        {props.series.map((s) => (
          <path
            key={s.name}
            d={line(s.values)}
            fill="none"
            stroke={s.color}
            stroke-width={s.dashed ? 1.6 : 2}
            stroke-linejoin="round"
            stroke-linecap="round"
            stroke-dasharray={s.dashed ? "4 3" : undefined}
          />
        ))}
        {props.series.map((s) =>
          s.values.map((v, i) =>
            v === null ? null : (
              <circle
                key={`${s.name}/${i}`}
                cx={x(i)}
                cy={y(v)}
                r="3"
                fill={s.color}
              >
                <title>{s.tip(v, i)}</title>
              </circle>
            ),
          ),
        )}
      </svg>
    </div>
  );
}

// ---- Sparkline ----------------------------------------------------------------

/** Inline sparkline polyline — the crate energy arc, mixing trends. */
export function Sparkline(props: {
  values: number[];
  width?: number;
  height?: number;
  title?: string;
}) {
  const W = props.width ?? 110;
  const H = props.height ?? 16;
  if (props.values.length < 2) return null;
  const min = Math.min(...props.values);
  const max = Math.max(...props.values);
  const sy = linearScale(min, max, H - 2, 2);
  const pts = props.values
    .map(
      (v, i) =>
        `${((i / (props.values.length - 1)) * (W - 4) + 2).toFixed(1)},${sy(v).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      class="bpmspark"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden
      title={
        props.title ??
        `${fmtNum(min)}–${fmtNum(max)} across ${props.values.length} points`
      }
    >
      <polyline points={pts} />
    </svg>
  );
}

// ---- Histogram ----------------------------------------------------------------

export interface HistBucket {
  label: string;
  count: number;
}

/** Div-bar histogram (BPM shape, byte mixes). Per-bar <title> tooltip and
 *  x-axis labels every `labelEvery` buckets. */
export function Histogram(props: {
  buckets: HistBucket[];
  height?: number;
  /** render a label under every Nth bar (0 = never) */
  labelEvery?: number;
  unit?: string;
}) {
  const max = Math.max(...props.buckets.map((b) => b.count), 1);
  return (
    <div>
      <div
        class="bpmhist"
        style={{ height: props.height ?? 56 }}
        role="img"
        aria-label={`Histogram: ${props.buckets.length} buckets, peak ${max}${props.unit ? ` ${props.unit}` : ""}`}
      >
        {props.buckets.map((b) => (
          <div
            class="bpmcol"
            key={b.label}
            title={`${b.label}: ${b.count.toLocaleString()}`}
          >
            <i style={{ height: `${Math.max(2, (b.count / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      {(props.labelEvery ?? 0) > 0 && (
        <div class="hist-labels">
          {props.buckets.map((b, i) => (
            <span key={b.label}>
              {i % (props.labelEvery ?? 1) === 0 ? b.label : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Donut --------------------------------------------------------------------

/** Verdict donut ring — the drive health ring. pct=0 renders the honest
 *  dashed "no data" arc, never a fabricated zero. */
export function Donut(props: {
  /** 0..1 pass fraction */
  pct: number;
  /** Data exists? false = indeterminate dashed arc. Defaults to pct > 0
   *  so a real measured 0 (a report that ran and passed nothing) stays
   *  distinct from "no report yet" when the caller knows the difference. */
  hasData?: boolean;
  size?: number;
  stroke?: number;
  color: string;
  label?: string;
  title?: string;
}) {
  const size = props.size ?? 46;
  const stroke = props.stroke ?? 3.5;
  const R = (size - stroke) / 2 - 1;
  const C = 2 * Math.PI * R;
  const hasReport = props.hasData ?? props.pct > 0;
  return (
    <div class="ring" title={props.title}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={props.title ?? "status ring"}
      >
        <circle
          class="ring-track"
          cx={size / 2}
          cy={size / 2}
          r={R}
          fill="none"
          stroke-width={stroke}
        />
        <circle
          class="ring-arc"
          cx={size / 2}
          cy={size / 2}
          r={R}
          fill="none"
          stroke-width={stroke}
          stroke={props.color}
          stroke-dasharray={hasReport ? C : "3 6"}
          stroke-dashoffset={
            hasReport ? C * (1 - Math.max(0.04, Math.min(1, props.pct))) : 0
          }
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {props.label && (
        <span class="ring-label" style={{ color: props.color }}>
          {props.label}
        </span>
      )}
    </div>
  );
}

// ---- fmt ----------------------------------------------------------------------

const fmtNum = (v: number): string =>
  Math.abs(v) >= 1000
    ? `${(v / 1000).toFixed(1)}k`
    : `${Math.round(v * 10) / 10}`;
