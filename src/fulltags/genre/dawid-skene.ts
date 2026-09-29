/**
 * dawid-skene.ts — Dawid-Skene label model for genre estimation (B5.2).
 *
 * Replaces the W-table vote ladder with a principled label aggregation
 * model that LEARNS per-annotator reliability from the evidence.
 *
 * Algorithm (EM):
 * 1. Initialize class priors from majority vote
 * 2. E-step: compute posterior P(class | annotations, error rates)
 * 3. M-step: re-estimate error rates and priors from posteriors
 * 4. Repeat until convergence (or max iterations)
 *
 * Annotator = source × scope (e.g. "beatport:exact_recording",
 * "soundcloud:same_song_other_version", "remixer:catalog").
 *
 * The model writes to `genre_posterior`, never to `tracks.genre`.
 */

/** Input: one annotation from one annotator about one track. */
export interface Annotation {
  readonly trackId: string;
  readonly annotatorId: string;
  readonly label: string;
}

/** Per-annotator confusion matrix: P(annotator says j | true class is i). */
export interface AnnotatorReliability {
  readonly annotatorId: string;
  /** confusion[trueClass][predictedClass] = probability. */
  readonly confusion: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** Overall accuracy: sum of diagonal / total. */
  readonly accuracy: number;
}

/** Per-track posterior from the model. */
export interface TrackPosterior {
  readonly trackId: string;
  /** Top-1 family. */
  readonly family: string;
  /** Top-1 probability. */
  readonly probability: number;
  /** Second-best family. */
  readonly family2: string | null;
  /** Second-best probability. */
  readonly probability2: number | null;
  /** Full posterior distribution. */
  readonly distribution: ReadonlyMap<string, number>;
}

/** Model output. */
export interface DawidSkeneResult {
  /** Per-track posteriors. */
  readonly posteriors: readonly TrackPosterior[];
  /** Per-annotator reliability. */
  readonly annotators: readonly AnnotatorReliability[];
  /** Class priors. */
  readonly priors: ReadonlyMap<string, number>;
  /** Number of EM iterations run. */
  readonly iterations: number;
  /** Whether EM converged (delta < epsilon). */
  readonly converged: boolean;
}

export interface DawidSkeneOptions {
  /** Max EM iterations (default: 50). */
  maxIterations?: number | undefined;
  /** Convergence threshold on posterior change (default: 1e-4). */
  epsilon?: number | undefined;
  /** Smoothing for confusion matrix (default: 0.01). */
  smoothing?: number | undefined;
}

/**
 * Run the Dawid-Skene EM algorithm on genre annotations.
 *
 * @param annotations - All annotations (track × annotator × label)
 * @param classes - Possible label classes (genre families)
 * @returns Model result with posteriors and annotator reliability
 */
export function dawidSkene(
  annotations: readonly Annotation[],
  classes: readonly string[],
  opts?: DawidSkeneOptions | undefined,
): DawidSkeneResult {
  const maxIter = opts?.maxIterations ?? 50;
  const epsilon = opts?.epsilon ?? 1e-4;
  const smoothing = opts?.smoothing ?? 0.01;
  const K = classes.length;

  if (annotations.length === 0 || K === 0) {
    return {
      posteriors: [],
      annotators: [],
      priors: new Map(),
      iterations: 0,
      converged: true,
    };
  }

  // Index annotations by track and annotator
  const trackIds = [...new Set(annotations.map((a) => a.trackId))];
  const annotatorIds = [...new Set(annotations.map((a) => a.annotatorId))];
  const classIdx = new Map(classes.map((c, i) => [c, i]));
  const trackIdx = new Map(trackIds.map((t, i) => [t, i]));

  const N = trackIds.length;
  const J = annotatorIds.length;

  // Group annotations by track
  const trackAnnotations = new Map<string, Annotation[]>();
  for (const a of annotations) {
    const arr = trackAnnotations.get(a.trackId) ?? [];
    arr.push(a);
    trackAnnotations.set(a.trackId, arr);
  }

  // Initialize posteriors from majority vote
  const posteriors: number[][] = Array.from({ length: N }, () =>
    Array.from({ length: K }, () => 1 / K),
  );

  // Initialize from majority vote
  for (const [trackId, anns] of trackAnnotations) {
    const ti = trackIdx.get(trackId);
    if (ti === undefined) continue;
    const counts = new Map<string, number>();
    for (const a of anns) {
      counts.set(a.label, (counts.get(a.label) ?? 0) + 1);
    }
    let total = 0;
    for (const [label, count] of counts) {
      const ci = classIdx.get(label);
      if (ci !== undefined) {
        posteriors[ti]![ci] = count;
        total += count;
      }
    }
    if (total > 0) {
      for (let k = 0; k < K; k++) {
        posteriors[ti]![k] =
          (posteriors[ti]![k]! + smoothing) / (total + smoothing * K);
      }
    }
  }

  // Priors
  let priors = Array.from({ length: K }, () => 1 / K);

  // Error rate matrices: pi[j][k][l] = P(annotator j says l | true = k)
  let pi: number[][][] = Array.from({ length: J }, () =>
    Array.from({ length: K }, () => Array.from({ length: K }, () => 1 / K)),
  );

  // EM iterations
  let converged = false;
  let iterations = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations++;

    // M-step: update priors and error rates
    const newPriors = Array.from({ length: K }, () => 0);
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < K; k++) {
        newPriors[k]! += posteriors[i]![k]!;
      }
    }
    for (let k = 0; k < K; k++) {
      newPriors[k] = (newPriors[k]! + smoothing) / (N + smoothing * K);
    }
    priors = newPriors;

    // Update error rates
    const newPi: number[][][] = Array.from({ length: J }, () =>
      Array.from({ length: K }, () =>
        Array.from({ length: K }, () => smoothing),
      ),
    );

    for (const [trackId, anns] of trackAnnotations) {
      const ti = trackIdx.get(trackId);
      if (ti === undefined) continue;
      for (const a of anns) {
        const ji = annotatorIds.indexOf(a.annotatorId);
        const li = classIdx.get(a.label);
        if (ji === -1 || li === undefined) continue;
        for (let k = 0; k < K; k++) {
          newPi[ji]![k]![li]! += posteriors[ti]![k]!;
        }
      }
    }

    // Normalize rows of pi
    for (let j = 0; j < J; j++) {
      for (let k = 0; k < K; k++) {
        let rowSum = 0;
        for (let l = 0; l < K; l++) rowSum += newPi[j]![k]![l]!;
        if (rowSum > 0) {
          for (let l = 0; l < K; l++) {
            newPi[j]![k]![l]! /= rowSum;
          }
        }
      }
    }
    pi = newPi;

    // E-step: update posteriors
    let maxDelta = 0;
    for (const [trackId, anns] of trackAnnotations) {
      const ti = trackIdx.get(trackId);
      if (ti === undefined) continue;
      const logPost = Array.from({ length: K }, (_, k) =>
        Math.log(Math.max(priors[k]!, 1e-30)),
      );

      for (const a of anns) {
        const ji = annotatorIds.indexOf(a.annotatorId);
        const li = classIdx.get(a.label);
        if (ji === -1 || li === undefined) continue;
        for (let k = 0; k < K; k++) {
          logPost[k]! += Math.log(Math.max(pi[ji]![k]![li]!, 1e-30));
        }
      }

      // Log-sum-exp normalization
      const maxLog = Math.max(...logPost);
      const exps = logPost.map((lp) => Math.exp(lp - maxLog));
      const sumExp = exps.reduce((a, b) => a + b, 0);

      for (let k = 0; k < K; k++) {
        const newVal = exps[k]! / sumExp;
        const delta = Math.abs(newVal - posteriors[ti]![k]!);
        if (delta > maxDelta) maxDelta = delta;
        posteriors[ti]![k] = newVal;
      }
    }

    if (maxDelta < epsilon) {
      converged = true;
      break;
    }
  }

  // Build output
  const trackPosteriors: TrackPosterior[] = trackIds.map((trackId, i) => {
    const dist = new Map<string, number>();
    let best = 0;
    let bestK = 0;
    let second = 0;
    let secondK = -1;

    for (let k = 0; k < K; k++) {
      const p = posteriors[i]![k]!;
      dist.set(classes[k]!, p);
      if (p > best) {
        second = best;
        secondK = bestK;
        best = p;
        bestK = k;
      } else if (p > second) {
        second = p;
        secondK = k;
      }
    }

    return {
      trackId,
      family: classes[bestK]!,
      probability: best,
      family2: secondK >= 0 ? (classes[secondK] ?? null) : null,
      probability2: secondK >= 0 ? second : null,
      distribution: dist,
    };
  });

  // Build annotator reliability
  const annotatorReliability: AnnotatorReliability[] = annotatorIds.map(
    (aid, j) => {
      const confusion = new Map<string, Map<string, number>>();
      let diagSum = 0;
      let total = 0;

      for (let k = 0; k < K; k++) {
        const row = new Map<string, number>();
        for (let l = 0; l < K; l++) {
          const val = pi[j]![k]![l]!;
          row.set(classes[l]!, val);
          total += val;
          if (k === l) diagSum += val;
        }
        confusion.set(classes[k]!, row);
      }

      return {
        annotatorId: aid,
        confusion,
        accuracy: total > 0 ? diagSum / total : 0,
      };
    },
  );

  const priorMap = new Map<string, number>();
  for (let k = 0; k < K; k++) {
    priorMap.set(classes[k]!, priors[k]!);
  }

  return {
    posteriors: trackPosteriors,
    annotators: annotatorReliability,
    priors: priorMap,
    iterations,
    converged,
  };
}
