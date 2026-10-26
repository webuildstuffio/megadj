/**
 * drop-energy.ts — Drop-section energy features from bar_features (B7.1).
 *
 * Until WS8 gives real structure detection, the "drop" is approximated
 * as the loudest 16-bar window in the track. Features are computed
 * from the bar_features table.
 *
 * Energy features at the drop:
 * - Peak LUFS (loudest bar in the window)
 * - Mean LUFS over the window
 * - Onset density at the drop
 * - Low-band energy share (bass dominance)
 * - Spectral flux (timbral change rate)
 * - Energy contrast (drop vs rest of track)
 */
import { round3 } from "../../shared/leaf/fmt";
import type { BarFeature } from "./bar-features";

/** Mean of a number array, null when empty. */
function meanArr(arr: number[]): number | null {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

/** Energy features computed from the drop section. */
export interface DropEnergyFeatures {
  /** Index of the first bar in the drop window. */
  readonly dropStartBar: number;
  /** Peak LUFS in the drop window. */
  readonly peakLufs: number | null;
  /** Mean LUFS over the drop window. */
  readonly meanLufs: number | null;
  /** Mean onset density at the drop (onsets/sec). */
  readonly meanOnsetDensity: number | null;
  /** Mean low-band energy share at the drop. */
  readonly meanLowBand: number | null;
  /** Mean spectral flux at the drop. */
  readonly meanFlux: number | null;
  /** Contrast: drop mean LUFS minus rest-of-track mean LUFS. */
  readonly lufsContrast: number | null;
  /** Number of bars in the window. */
  readonly windowSize: number;
}

/**
 * Find the loudest N-bar window in the track (drop approximation).
 *
 * @param bars - Per-bar features, ordered by barIndex
 * @param windowSize - Number of bars in the window (default: 16)
 * @returns Drop energy features, or null if bars are insufficient
 */
export function computeDropEnergy(
  bars: readonly BarFeature[],
  windowSize = 16,
): DropEnergyFeatures | null {
  if (bars.length < windowSize) return null;

  // Find the window with the highest mean LUFS
  let bestStart = 0;
  let bestMeanLufs = -Infinity;

  for (let start = 0; start <= bars.length - windowSize; start++) {
    let sum = 0;
    let count = 0;
    for (let i = start; i < start + windowSize; i++) {
      const lufs = bars[i]?.lufs;
      if (lufs !== null && lufs !== undefined) {
        sum += lufs;
        count++;
      }
    }
    if (count > 0) {
      const mean = sum / count;
      if (mean > bestMeanLufs) {
        bestMeanLufs = mean;
        bestStart = start;
      }
    }
  }

  // Extract features from the window
  const window = bars.slice(bestStart, bestStart + windowSize);
  const windowLufs = window.map((b) => b.lufs).filter((l): l is number => l !== null);
  const windowOnset = window.map((b) => b.onsetDensity).filter((d): d is number => d !== null);
  const windowLowBand = window.map((b) => b.lowBandShare).filter((s): s is number => s !== null);
  const windowFlux = window.map((b) => b.spectralFlux).filter((f): f is number => f !== null);

  // Rest-of-track LUFS (everything outside the window)
  const restBars = [...bars.slice(0, bestStart), ...bars.slice(bestStart + windowSize)];
  const restLufs = restBars.map((b) => b.lufs).filter((l): l is number => l !== null);

  const peakLufs = windowLufs.length > 0 ? Math.max(...windowLufs) : null;
  const meanLufsVal = meanArr(windowLufs);
  const restMeanLufs = meanArr(restLufs);

  return {
    dropStartBar: bestStart,
    peakLufs: peakLufs !== null ? round3(peakLufs) : null,
    meanLufs: meanLufsVal !== null ? round3(meanLufsVal) : null,
    meanOnsetDensity:
      windowOnset.length > 0
        ? round3(windowOnset.reduce((a, b) => a + b, 0) / windowOnset.length)
        : null,
    meanLowBand:
      windowLowBand.length > 0
        ? round3(windowLowBand.reduce((a, b) => a + b, 0) / windowLowBand.length)
        : null,
    meanFlux:
      windowFlux.length > 0
        ? round3(windowFlux.reduce((a, b) => a + b, 0) / windowFlux.length)
        : null,
    lufsContrast:
      meanLufsVal !== null && restMeanLufs !== null ? round3(meanLufsVal - restMeanLufs) : null,
    windowSize,
  };
}
