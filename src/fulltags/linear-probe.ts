// linear-probe.ts — the literature-standard genre readout on frozen
// embeddings (research review R3/0.2: "frozen kNN is the weakest
// readout; the literature probes linear heads on frozen features").
//
// A multinomial logistic regression (softmax + full-batch gradient
// descent) over the SAME cached 1280-d vectors the kNN vote uses — no
// new model, no tower, one small weight matrix. Trained inside a
// leave-one-out harness so the number is comparable to the kNN LOO
// agreement (the ≥65% gate), with one honest caveat printed with every
// result: LOO retrains n probes, each never seeing its held-out row.
//
// Deterministic: zero-init weights, fixed learning rate, fixed epochs
// — same input, same weights, same predictions. Pure: no DB, no IO.

/** One training row: the frozen vector, its family label (the class
 *  index), and an id (self-exclusion during LOO). */
export interface ProbeRow {
  videoId: string;
  label: string;
  vec: number[];
}

export interface ProbeFit {
  /** class label → weight-row index */
  readonly classes: string[];
  /** (C×d) weight matrix, flattened row-major */
  readonly weights: number[];
  /** (C) bias vector */
  readonly bias: number[];
}

export interface ProbeFitResult {
  fit: ProbeFit;
  /** final mean cross-entropy loss on the training rows */
  loss: number;
  epochs: number;
}

/** Zero-filled numeric array of length n (`Array.from` — the oxlint-safe
 *  allocation; `new Array(n).fill(0)` is ambiguous to readers). */
const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);

/** Deterministic softmax regression fit. L2-regularized (λ) to keep the
 *  1280-d weights honest on ~3k rows; zero init makes the run
 *  reproducible. Full-batch GD: 3k×1280 × ~12 classes is ~50 MFLOPs per
 *  epoch — seconds for the default 200. */
export function fitProbe(
  rows: ProbeRow[],
  opts: { epochs?: number; lr?: number; l2?: number } = {},
): ProbeFitResult {
  const epochs = opts.epochs ?? 200;
  const lr = opts.lr ?? 0.5;
  const l2 = opts.l2 ?? 1e-4;
  if (rows.length === 0)
    return { fit: { classes: [], weights: [], bias: [] }, loss: 0, epochs: 0 };
  const classes = [...new Set(rows.map((r) => r.label))].toSorted();
  const classIndex = new Map(classes.map((c, i) => [c, i]));
  const d = rows[0]!.vec.length;
  const C = classes.length;
  const W = zeros(C * d);
  const b = zeros(C);
  const n = rows.length;
  const probs = zeros(C);
  const gradW = zeros(C * d);
  const gradB = zeros(C);
  let loss = 0;
  for (let epoch = 0; epoch < epochs; epoch++) {
    gradW.fill(0);
    gradB.fill(0);
    loss = 0;
    for (const row of rows) {
      const y = classIndex.get(row.label)!;
      // forward: softmax(W·x + b)
      let max = -Infinity;
      for (let c = 0; c < C; c++) {
        let z = b[c]!;
        const off = c * d;
        for (let i = 0; i < d; i++) z += W[off + i]! * row.vec[i]!;
        probs[c] = z;
        if (z > max) max = z;
      }
      let sum = 0;
      for (let c = 0; c < C; c++) {
        probs[c] = Math.exp(probs[c]! - max);
        sum += probs[c]!;
      }
      for (let c = 0; c < C; c++) probs[c] = probs[c]! / sum;
      loss -= Math.log(Math.max(probs[y]!, 1e-12));
      // backward: accumulate gradients
      for (let c = 0; c < C; c++) {
        const g = probs[c]! - (c === y ? 1 : 0);
        if (g === 0) continue;
        const off = c * d;
        for (let i = 0; i < d; i++) gradW[off + i]! += g * row.vec[i]!;
        gradB[c]! += g;
      }
    }
    // SGD step (mean gradients + L2 on weights only)
    const scale = lr / n;
    for (let j = 0; j < C * d; j++)
      W[j] = W[j]! - scale * gradW[j]! + lr * l2 * W[j]!;
    for (let c = 0; c < C; c++) b[c] = b[c]! - scale * gradB[c]!;
  }
  return {
    fit: { classes, weights: W, bias: b },
    loss: Math.round((loss / n) * 10000) / 10000,
    epochs,
  };
}

/** Predict the class family for one vector (argmax of the softmax —
 *  probabilities are monotone in z, so argmax on z is exact). */
export function probePredict(fit: ProbeFit, vec: number[]): string | null {
  const C = fit.classes.length;
  const d = vec.length;
  if (C === 0 || d === 0) return null;
  let best = -Infinity;
  let bestClass: string | null = null;
  for (let c = 0; c < C; c++) {
    let z = fit.bias[c]!;
    const off = c * d;
    for (let i = 0; i < d; i++) z += fit.weights[off + i]! * vec[i]!;
    if (z > best) {
      best = z;
      bestClass = fit.classes[c]!;
    }
  }
  return bestClass;
}

/** LOO probe accuracy: for each row, fit on the rest, predict the held
 *  row. This is the number comparable to the kNN LOO agreement (the
 *  ≥65% gate) — each row's probe never saw that row. Returns the
 *  accuracy share and the per-row predictions.
 *
 *  Cost note: full LOO refits n probes (O(n²) fits). `folds` (default 5)
 *  runs stratified k-fold CV instead — the literature-standard estimator
 *  of the same held-out accuracy at ~1/`folds` the fit count, and at
 *  n≈3k×1280×12 classes a full LOO is hours while 5-fold is seconds.
 *  `folds: 0` forces exact LOO (small populations only). Fold assignment
 *  is deterministic: rows pre-sorted by (label, videoId), stride
 *  assignment i%k keeps every class represented in every fold. */
export function probeLeaveOneOut(
  rows: ProbeRow[],
  folds = 5,
): {
  evaluated: number;
  correct: number;
  accuracy: number;
  predictions: { videoId: string; truth: string; predicted: string | null }[];
  /** "loo" when folds=0, else "5-fold-cv" style label */
  protocol: string;
} {
  const predictions: {
    videoId: string;
    truth: string;
    predicted: string | null;
  }[] = [];
  if (rows.length === 0)
    return {
      evaluated: 0,
      correct: 0,
      accuracy: 0,
      predictions,
      protocol: folds === 0 ? "loo" : `${folds}-fold-cv`,
    };
  let correct = 0;
  /** One held-row outcome, shared by the LOO and k-fold legs: score the
   *  prediction and append the per-row record. */
  const record = (held: ProbeRow, predicted: string | null): void => {
    if (predicted === held.label) correct++;
    predictions.push({
      videoId: held.videoId,
      truth: held.label,
      predicted,
    });
  };
  if (folds === 0 || rows.length <= folds) {
    // exact LOO: fit on the rest, predict the held row
    for (let i = 0; i < rows.length; i++) {
      const held = rows[i]!;
      const rest = rows.filter((_, j) => j !== i);
      const { fit } = fitProbe(rest);
      record(held, probePredict(fit, held.vec));
    }
    return {
      evaluated: rows.length,
      correct,
      accuracy: correct / rows.length,
      predictions,
      protocol: "loo",
    };
  }
  // stratified k-fold: group rows per class, interleave round-robin so
  // every fold sees every class in class proportion
  const byClass = new Map<string, ProbeRow[]>();
  for (const row of [...rows].toSorted(
    (a, b) =>
      a.label.localeCompare(b.label) || a.videoId.localeCompare(b.videoId),
  )) {
    const list = byClass.get(row.label) ?? [];
    list.push(row);
    byClass.set(row.label, list);
  }
  const foldOf = new Map<string, number>();
  for (const list of byClass.values())
    list.forEach((row, i) => foldOf.set(row.videoId, i % folds));
  for (let f = 0; f < folds; f++) {
    const train = rows.filter((r) => foldOf.get(r.videoId) !== f);
    const test = rows.filter((r) => foldOf.get(r.videoId) === f);
    const { fit } = fitProbe(train);
    for (const held of test) {
      record(held, probePredict(fit, held.vec));
    }
  }
  return {
    evaluated: rows.length,
    correct,
    accuracy: correct / rows.length,
    predictions,
    protocol: `${folds}-fold-cv`,
  };
}
