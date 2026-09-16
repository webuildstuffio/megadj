// hygiene-compare.tsx — the A/B compare cluster extracted from
// HygieneTab.tsx (#89/#90 page-monolith split): when a twin finding
// (byte-twin / acoustic-twin) opens its compare, these components render
// the two playable sides, the duration-delta badge, and the
// nothing-deleted note. Pure render + one stats fetcher — the finding
// state (compares/playing maps) stays in HygieneTab.
import type {
  Finding,
  HygieneAudioStats,
} from "../../../../cratedeck/shared/hygiene";

/** basename for the compare card labels */
export function baseName(p: string): string {
  const i = p.lastIndexOf("/");
  return i !== -1 ? p.slice(i + 1) : p;
}

/** The A/B compare card state for one finding. */
export interface CompareState {
  stats: Record<number, HygieneAudioStats | null>; // by side index
  loaded: boolean;
}

/** Duration delta badge: how far apart the two sides run. */
export function durationDelta(
  a: HygieneAudioStats | null,
  b: HygieneAudioStats | null,
): string | null {
  if (!a?.durationS || !b?.durationS) return null;
  const hi = Math.max(a.durationS, b.durationS);
  const lo = Math.min(a.durationS, b.durationS);
  const pct = hi > 0 ? ((hi - lo) / hi) * 100 : 0;
  if (pct < 0.5) return "same length";
  const d = Math.abs(a.durationS - b.durationS);
  return d < 2
    ? `${d.toFixed(1)}s apart`
    : `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, "0")} apart`;
}

/** Fetch both A/B sides' audio stats (null on any per-side failure —
 *  the card degrades to "stats unavailable" per side, never throws). */
export async function fetchSideStats(
  paths: string[],
): Promise<(HygieneAudioStats | null)[]> {
  return Promise.all(
    paths.map(async (p) => {
      try {
        const r = await fetch(
          `/api/hygiene/stats?path=${encodeURIComponent(p)}`,
        );
        if (!r.ok) return null;
        return (await r.json()) as HygieneAudioStats;
      } catch {
        return null;
      }
    }),
  );
}

/** One A/B side: name, stats line, audio player, keep-decision. */
function CompareSide(props: {
  f: Finding;
  side: number;
  path: string;
  st: HygieneAudioStats | null;
  loaded: boolean;
  playing: boolean;
  busy: boolean;
  onPlay: () => void;
  onPause: () => void;
  onKeepOther: () => void;
}) {
  const { f, side, path: p, st, loaded, playing, busy } = props;
  const keeper = f.keeperPath === p;
  const statsLine = !loaded
    ? "…"
    : st
      ? [
          st.durationS !== null &&
            `${Math.floor(st.durationS / 60)}:${String(Math.round(st.durationS % 60)).padStart(2, "0")}`,
          st.bitrateKbps !== null && `${st.bitrateKbps.toLocaleString()} kbps`,
          st.codec &&
            st.sampleRate !== null &&
            `${st.codec} ${(st.sampleRate / 1000).toFixed(1).replace(/\.0$/, "")} kHz`,
          `${(st.bytes / 1_048_576).toFixed(1)} MB`,
        ]
          .filter(Boolean)
          .join(" · ") || "no metadata"
      : "stats unavailable";
  return (
    <div class="abside">
      <div class="abside-head">
        <b>
          {side === 0 ? "A" : "B"}
          {keeper ? " · current keeper" : ""}
        </b>
        <span class="abside-name" title={p}>
          {baseName(p)}
        </span>
      </div>
      <div class="abside-stats">{statsLine}</div>
      <audio
        controls
        preload="none"
        src={`/api/hygiene/audio?path=${encodeURIComponent(p)}`}
        onPlay={props.onPlay}
        onPause={props.onPause}
        data-playing={playing}
      />
      <div class="abside-actions">
        <button
          type="button"
          class="btn sm"
          disabled={busy || keeper}
          onClick={props.onKeepOther}
          title="Confirm = this side's twin moves to quarantine, the keeper stays"
        >
          {keeper ? "Keeper — keep this" : "Keep the other (A) — confirm"}
        </button>
      </div>
    </div>
  );
}

/** The A/B compare expansion under a twin finding: duration delta, two
 *  playable sides, and the nothing-deleted note. */
export function CompareCardPanel(props: {
  f: Finding;
  cmp: CompareState;
  playing: string | null;
  /** The useState setter — accepts a value or an updater function. */
  setPlaying: (
    next: string | null | ((cur: string | null) => string | null),
  ) => void;
  busy: boolean;
  onKeepOther: (id: string) => void;
}) {
  const { f, cmp, playing, setPlaying, busy, onKeepOther } = props;
  const isTwin = f.kind === "acoustic-twin" || f.kind === "byte-twin";
  const dDelta = isTwin
    ? durationDelta(cmp.stats[0] ?? null, cmp.stats[1] ?? null)
    : null;
  return (
    <div class="abcompare">
      {dDelta && (
        <span
          class={`pill ${dDelta === "same length" ? "ok" : "warn"}`}
          title="Duration difference between the two copies — a big gap means different recordings/mixes, not just encodes"
        >
          {dDelta}
        </span>
      )}
      {[0, 1].map((side) => {
        const p = f.paths[side];
        if (!p) return null;
        const playKey = `${f.id}:${side}`;
        return (
          <CompareSide
            key={side}
            f={f}
            side={side}
            path={p}
            st={cmp.stats[side] ?? null}
            loaded={cmp.loaded}
            playing={playing === playKey}
            busy={busy}
            onPlay={() => setPlaying(playKey)}
            onPause={() => setPlaying((cur) => (cur === playKey ? null : cur))}
            onKeepOther={() => onKeepOther(f.id)}
          />
        );
      })}
      <div class="abnote">
        Confirm quarantines the <b>non-keeper</b> copy — nothing is deleted, and
        you can restore it later. Dismiss keeps both files untouched.
      </div>
    </div>
  );
}
