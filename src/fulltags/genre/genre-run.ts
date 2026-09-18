// genre-run.ts — the `megadj genre` CLI arm (#206 split from genre.ts):
// flag parse → ladder invocation → report. genre.ts keeps the
// vocabulary (GenreOptions/RefoldEvalBlock types); this file owns the
// runner, mirroring the #88 fetch split (fetch-pipeline + stages) and
// the #90 command-arm pattern.
import { commandLog } from "../../progress";
import {
  writeJson,
  finishCommandError,
  setExit,
} from "../../shared/cli-output";
import {
  evalLeaveOneOut,
  evalLeaveOneOutArtistDisjoint,
  genreFamily,
  inferGenre,
  parseEmbeddingVector,
  type GenreSeed,
} from "../../archive/similar";
import { l2normalize } from "../../../cratedeck/shared/vector-space";
import { tier0Diagnostics } from "./genre-diagnostics";
import { probeLeaveOneOut, type ProbeRow } from "../analysis/linear-probe";
import { refoldDetail, scoringFamily } from "./genre-refold";
import { isUmbrellaLabel } from "./genre-vocab";
import { classifyDisputes } from "./genre-flag";
import { collectDisputes, resolveDispute } from "./genre-disputes";
import type { GenreOptions, RefoldEvalBlock } from "./genre";

/** Share 0..1 → percentage string with one decimal (eval log lines). */
const pct = (share: number): string => `${(share * 100).toFixed(1)}%`;

/** #64 dispute review/resolution mode (genre() branch split, #181):
 *  review is read-only; the resolution verbs are the only writers. A
 *  bare --note without agree/keep is a usage error (exit 2, no work).
 *  Returns true when the invocation was a disputes-mode run. */
async function genreDisputesMode(
  opts: GenreOptions,
  log: (s: string) => void,
  k: number,
): Promise<boolean> {
  if (
    !opts.disputes &&
    opts.note === undefined &&
    opts.agree === undefined &&
    opts.keep === undefined
  )
    return false;
  const resolutionCount =
    (opts.agree !== undefined ? 1 : 0) + (opts.keep !== undefined ? 1 : 0);
  if (resolutionCount > 1) {
    await finishCommandError({
      command: "genre",
      json: opts.json === true,
      error: "--agree and --keep resolve one row each — pass one, not both",
      exitCode: 2,
    });
    return true;
  }
  if (opts.note !== undefined && resolutionCount === 0) {
    await finishCommandError({
      command: "genre",
      json: opts.json === true,
      error: "--note rides with --agree or --keep — nothing to note on its own",
      exitCode: 2,
    });
    return true;
  }
  if (opts.agree !== undefined || opts.keep !== undefined) {
    const verb = opts.agree !== undefined ? "agree" : "keep";
    const videoId = (opts.agree ?? opts.keep)!;
    const result = resolveDispute(opts.state, {
      videoId,
      verb,
      note: opts.note,
    });
    if (!result.ok) {
      await finishCommandError({
        command: "genre",
        json: opts.json === true,
        error: result.message,
        exitCode: 1,
      });
      return true;
    }
    log(result.message);
    await writeJson({
      command: "genre",
      mode: "dispute-resolve",
      video_id: videoId,
      verb,
      applied: true,
      message: result.message,
    });
    return true;
  }
  // read-only review
  const review = collectDisputes(opts.state, k);
  log(
    `genre disputes: ${review.flagged} flagged (${review.alreadyAgree} already agree with live consensus — --keep resolves those)`,
  );
  for (const r of review.rows.slice(0, 30)) {
    const evidence = r.consensus
      ? `consensus ${r.consensus} @ ${Math.round((r.agreement ?? 0) * 100)}% · embed ${r.embedAgeDays ?? "?"}d`
      : "no live consensus (re-run --flag)";
    log(`  ${r.videoId}  "${r.genre}"  — ${evidence}`);
    log(`    ${r.artist ?? "?"} — ${r.title ?? "?"}`);
  }
  await writeJson({
    command: "genre",
    mode: "disputes",
    flagged: review.flagged,
    alreadyAgree: review.alreadyAgree,
    rows: review.rows,
  });
  return true;
}

/** --eval mode (genre() branch split, #181): measure, never write.
 *  Runs the LOO harness plus the optional diagnostics/artist-disjoint/
 *  probe/refold readouts and emits the eval JSON. #160 ring 3: setExit
 *  is the one mutation point (eval's pass/fail). */
async function genreEvalMode(
  opts: GenreOptions,
  log: (s: string) => void,
  k: number,
  minAgreement: number,
): Promise<void> {
  {
    // ---- eval mode: measure, never write ----
    const pop = opts.state.evalPopulation();
    const seeds: GenreSeed[] = [];
    const durations: { videoId: string; durationS: number | null }[] = [];
    const artists = new Map<string, string>();
    const probeRows: ProbeRow[] = [];
    for (const row of pop) {
      const vec = parseEmbeddingVector(
        row.vec_json,
        `genre eval ${row.video_id}`,
      );
      seeds.push({ videoId: row.video_id, genre: row.genre, vec });
      durations.push({ videoId: row.video_id, durationS: row.duration_s });
      if (row.artist) artists.set(row.video_id, row.artist);
      const family = genreFamily(row.genre);
      if (family !== null)
        probeRows.push({
          videoId: row.video_id,
          label: family,
          vec: l2normalize(vec),
        });
    }
    const summary = evalLeaveOneOut(
      seeds,
      k,
      minAgreement,
      opts.durationGuard === false ? [] : durations,
    );
    log(
      `genre eval: ${summary.evaluated} evaluated · gated agreement ${pct(summary.agreement)} · refusal ${pct(summary.refusal)} · ungated ${pct(summary.ungatedAgreement)} (k=${k}, minAgreement ${minAgreement}${opts.durationGuard === false ? ", no duration guard" : ", 90–480s guard"})`,
    );
    let diagnostics: ReturnType<typeof tier0Diagnostics> | undefined;
    let artistDisjoint:
      | { evaluated: number; agreement: number; refusal: number; delta: number }
      | undefined;
    let probe:
      | {
          protocol: string;
          evaluated: number;
          accuracy: number;
          deltaVsKnn: number;
        }
      | undefined;
    let refold: RefoldEvalBlock | undefined;
    if (opts.refold) {
      const rb = evalLeaveOneOut(
        seeds,
        k,
        minAgreement,
        opts.durationGuard === false ? [] : durations,
        scoringFamily,
      );
      const abstained = summary.evaluated - rb.evaluated;
      refold = {
        evaluated: rb.evaluated,
        abstained,
        agree: rb.agree,
        disagree: rb.disagree,
        refused: rb.refused,
        agreement: Math.round(rb.agreement * 1000) / 1000,
        refusal: Math.round(rb.refusal * 1000) / 1000,
        deltaVsBaseline:
          Math.round((rb.agreement - summary.agreement) * 1000) / 1000,
      };
      log(
        `  refold (umbrella arbitration): ${rb.evaluated} scored (${abstained} plain-umbrella rows abstain) · gated ${pct(rb.agreement)} (Δ ${refold.deltaVsBaseline >= 0 ? "+" : ""}${pct(rb.agreement - summary.agreement)} vs baseline) · refusal ${pct(rb.refusal)}`,
      );
    }
    // the audit's checkpoint: gated agreement — v3 target ≥65% POST-REFOLD.
    // With --refold the gate judges the ARBITRATION readout (the shipped
    // policy): the whole point of the refold is that plain-umbrella rows
    // are unscorable, so the legacy-baseline number can never reach the
    // bar. The baseline arm stays in the JSON for A/B either way.
    const gatedValue =
      refold !== undefined ? refold.agreement : summary.agreement;
    const pass = gatedValue >= 0.65;
    log(
      `  target (genre-audit §5b.3): gated ≥65% post-refold — ${pass ? "PASS" : "below target (see audit for the refold plan)"} (${refold !== undefined ? `refold arm ${pct(refold.agreement)}` : `baseline ${pct(summary.agreement)}`})`,
    );
    if (opts.diagnostics) {
      const famPop = summary.rows.map((row) => {
        const seed = seeds.find((s) => s.videoId === row.videoId)!;
        return {
          videoId: row.videoId,
          genre: "",
          vec: seed.vec,
          artist: artists.get(row.videoId) ?? "unknown",
          family: row.family,
        };
      });
      diagnostics = tier0Diagnostics(famPop, summary.rows, k);
      log(
        `  diagnostics: label errors ${diagnostics.labelErrors.verdict} (top-10 artists hold ${pct(diagnostics.labelErrors.top10Share)} of disagreements) · same-artist top-5 ${pct(diagnostics.artistOverlap.meanTop5SameArtist)}${diagnostics.artistOverlap.rerunNeeded ? " — RERUN ARTIST-DISJOINT" : ""} · hubs≥10 ${diagnostics.hubness.hubs10}/${diagnostics.hubness.tracks} (max ${diagnostics.hubness.maxOccurrence}) · triangle share ${pct(diagnostics.confusion.triangleShare)} · top-2 ${pct(diagnostics.confusion.top2Accuracy)}`,
      );
    }
    if (opts.artistDisjoint) {
      const dj = evalLeaveOneOutArtistDisjoint(
        seeds,
        artists,
        k,
        minAgreement,
        opts.durationGuard === false ? [] : durations,
      );
      artistDisjoint = {
        evaluated: dj.evaluated,
        agreement: Math.round(dj.agreement * 1000) / 1000,
        refusal: Math.round(dj.refusal * 1000) / 1000,
        delta: Math.round((dj.agreement - summary.agreement) * 1000) / 1000,
      };
      log(
        `  artist-disjoint LOO: ${pct(dj.agreement)} (Δ ${artistDisjoint.delta >= 0 ? "+" : ""}${pct(dj.agreement - summary.agreement)} vs plain) — ${dj.agreement >= summary.agreement * 0.95 ? "audio-driven, plain LOO stands" : "artist fingerprinting suspected: plain LOO is inflated"}`,
      );
    }
    if (opts.probe) {
      const pr = probeLeaveOneOut(probeRows);
      probe = {
        protocol: pr.protocol,
        evaluated: pr.evaluated,
        accuracy: Math.round(pr.accuracy * 1000) / 1000,
        deltaVsKnn: Math.round((pr.accuracy - summary.agreement) * 1000) / 1000,
      };
      log(
        `  linear probe ${pr.protocol}: ${pct(pr.accuracy)} (Δ ${probe.deltaVsKnn >= 0 ? "+" : ""}${pct(pr.accuracy - summary.agreement)} vs kNN gate)${probe.deltaVsKnn >= 0.03 ? " — probe beats the gate by ≥3 pts: promote to production readout" : ""}`,
      );
    }
    await writeJson({
      command: "genre",
      mode: "eval",
      k,
      minAgreement,
      durationGuard: opts.durationGuard !== false,
      evaluated: summary.evaluated,
      agree: summary.agree,
      disagree: summary.disagree,
      refused: summary.refused,
      agreement: Math.round(summary.agreement * 1000) / 1000,
      refusal: Math.round(summary.refusal * 1000) / 1000,
      ungated_agreement: Math.round(summary.ungatedAgreement * 1000) / 1000,
      target: 0.65,
      pass,
      ...(diagnostics !== undefined ? { diagnostics } : {}),
      ...(artistDisjoint !== undefined
        ? { artist_disjoint: artistDisjoint }
        : {}),
      ...(probe !== undefined ? { probe } : {}),
      ...(refold !== undefined ? { refold } : {}),
    });
    // #160 ring 3: setExit is the one mutation point (eval's pass/fail).
    setExit(pass ? 0 : 1);
  }
}

/** --refold standalone mode (genre() branch split, #181): the DATA half
 *  — canonicalization proposals over the LABELED population, never the
 *  unlabeled one. Umbrella rows are explicitly NOT rewritten here (their
 *  refinement is a scoring decision, measured in --eval --refold);
 *  --apply only writes repaired/split/aliased rows that DIFFER. */
async function genreRefoldMode(
  opts: GenreOptions,
  log: (s: string) => void,
): Promise<boolean> {
  if (!opts.refold) return false;
  const labeled = opts.state.labeledPopulation();
  const changes: {
    video_id: string;
    from: string;
    to: string;
    escaped: boolean;
    split: boolean;
    aliased: boolean;
  }[] = [];
  // Placeholder labels (pre-guard intake legacy: literal `Music` ×154,
  // `unknown`, `fixme`) resolve to null via refoldDetail — they are NOT
  // labels. Clear them so genreSeeds() re-enrolls the rows as QUERIES
  // (#61): a non-empty value blocked both directions before.
  const unstrand: { video_id: string; from: string }[] = [];
  let unchanged = 0;
  let abstained = 0;
  for (const row of labeled) {
    const detail = refoldDetail(row.genre);
    if (detail.label === null) {
      const raw = row.genre.trim().toLowerCase();
      if (raw === "music" || raw === "unknown" || raw === "fixme") {
        unstrand.push({ video_id: row.video_id, from: row.genre });
      } else {
        // URL junk / empty-after-trim: visible in the census, but not
        // mechanically deletable — a human decides those.
        unchanged++;
      }
      continue;
    }
    if (detail.label === row.genre) {
      unchanged++;
      continue;
    }
    if (isUmbrellaLabel(detail.label)) {
      // plain-umbrella rows keep their parent label (scoring arbitrates,
      // not the column) — EXCEPT:
      // 1. casing-only fixes: "edm" → "EDM", "DANCE" → "Dance" is
      //    display hygiene (kills the label twins that fragment
      //    group-by), not a genre rewrite. Propose it.
      // 2. split outcomes: "Dance/Electronic" resolved to a bare
      //    umbrella because BOTH tokens are parents — the refold's
      //    canonicalization (one spelling, primary first) is still the
      //    data half's job and kills the case-twin pair. The VALUE
      //    class (umbrella) is preserved, so no genre knowledge is
      //    invented.
      const casingOnly =
        detail.label.toLowerCase() === row.genre.trim().toLowerCase();
      if (!detail.split && !casingOnly) {
        abstained++;
        continue;
      }
      changes.push({
        video_id: row.video_id,
        from: row.genre,
        to: detail.label,
        escaped: detail.escaped,
        split: detail.split,
        aliased: true,
      });
      continue;
    }
    changes.push({
      video_id: row.video_id,
      from: row.genre,
      to: detail.label,
      escaped: detail.escaped,
      split: detail.split,
      aliased: detail.aliased,
    });
  }
  log(
    `genre refold: ${changes.length} changeable of ${labeled.length} labeled (${abstained} umbrella rows kept honest, ${unchanged} already canonical, ${unstrand.length} placeholder rows to unstrand) — ${opts.apply ? "WRITTEN" : "proposals only (use --apply to write)"}`,
  );
  for (const c of changes.slice(0, 20))
    log(`  ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
  await writeJson({
    command: "genre",
    mode: "refold",
    labeled: labeled.length,
    changes: changes.length,
    umbrellaKept: abstained,
    alreadyCanonical: unchanged,
    unstrand: unstrand.length,
    applied: opts.apply === true,
    samples: changes.slice(0, 40),
  });
  if (opts.apply) {
    for (const c of changes) opts.state.updateGenre(c.video_id, c.to);
    for (const c of unstrand) opts.state.clearGenre(c.video_id);
  }
  return true;
}

/** --flag standalone mode (genre() branch split, #181): the
 *  demote-and-flag pass (§5b.3 step 2). Runs the LOO harness; rows whose
 *  label contradicts a UNANIMOUS kNN consensus get genre_flag='disputed'
 *  — never rewritten, but excluded from inference seeding
 *  (state_tracks.genreSeeds filters them). Previously-flagged rows are
 *  REASSESSED from scratch each run: if a fixed label (or a changed
 *  neighbourhood) now agrees, the flag clears — idempotent,
 *  self-healing. */
async function genreFlagMode(
  opts: GenreOptions,
  log: (s: string) => void,
  k: number,
  minAgreement: number,
): Promise<boolean> {
  if (!opts.flag) return false;
  const pop = opts.state.evalPopulation();
  const seeds: GenreSeed[] = [];
  const durations: { videoId: string; durationS: number | null }[] = [];
  for (const row of pop) {
    seeds.push({
      videoId: row.video_id,
      genre: row.genre,
      vec: parseEmbeddingVector(row.vec_json, `genre flag ${row.video_id}`),
    });
    durations.push({ videoId: row.video_id, durationS: row.duration_s });
  }
  const summary = evalLeaveOneOut(seeds, k, minAgreement, durations);
  const result = classifyDisputes(summary);
  const disputeIds = new Set(result.rows.map((r) => r.videoId));
  // every embedded labeled row is reassessed: set the flag on new
  // disputes, CLEAR it on rows no longer disputed (self-healing)
  if (opts.apply)
    for (const row of pop)
      opts.state.setGenreFlag(
        row.video_id,
        disputeIds.has(row.video_id) ? "disputed" : null,
      );
  log(
    `genre flag: ${result.disputed} disputed of ${result.evaluated} assessed (${result.upheld} upheld by unanimous consensus, ${result.noQuorum} no quorum) — ${opts.apply ? "FLAGS WRITTEN (labels untouched)" : "proposals only (use --apply to write flags)"}`,
  );
  for (const r of result.rows.slice(0, 15))
    log(`  ${r.family} → consensus ${r.consensus}  (${r.videoId})`);
  await writeJson({
    command: "genre",
    mode: "flag",
    evaluated: result.evaluated,
    disputed: result.disputed,
    upheld: result.upheld,
    noQuorum: result.noQuorum,
    applied: opts.apply === true,
    samples: result.rows.slice(0, 40),
  });
  return true;
}

export async function genre(opts: GenreOptions): Promise<void> {
  const log = commandLog(opts);
  const k = opts.k ?? 5;
  const minAgreement = opts.minAgreement ?? 0.6;

  if (await genreDisputesMode(opts, log, k)) return;

  if (opts.refold && opts.flag) {
    await finishCommandError({
      command: "genre",
      json: opts.json === true,
      error: "--refold and --flag are separate passes — run one at a time",
      exitCode: 2,
    });
    return;
  }

  if (opts.eval) {
    await genreEvalMode(opts, log, k, minAgreement);
    return;
  }

  if (await genreRefoldMode(opts, log)) return;
  if (await genreFlagMode(opts, log, k, minAgreement)) return;

  // seeds: embedded tracks WITH a trusted genre; queries: embedded
  // tracks WITHOUT one (COALESCE means we could also never clobber, but
  // not querying them at all keeps the run bounded by the real gap)
  const rows = opts.state.genreSeeds();
  const seeds: GenreSeed[] = rows.seeds.map((s) => ({
    videoId: s.video_id,
    genre: s.genre!,
    vec: parseEmbeddingVector(s.vec_json, `genre seed ${s.video_id}`),
  }));
  // Parse and validate every query before the first --apply write. A late
  // corrupt row must never leave an earlier query partially committed.
  const queries = rows.queries.map((q) => ({
    ...q,
    vec: parseEmbeddingVector(q.vec_json, `genre query ${q.video_id}`),
  }));

  let inferred = 0;
  let split = 0;
  const proposals: {
    video_id: string;
    title: string | null;
    genre: string;
    agreement: number;
  }[] = [];
  for (const q of queries) {
    const v = inferGenre(seeds, q.vec, k, minAgreement);
    if (v.inferred === null) {
      split++;
      continue;
    }
    inferred++;
    if (opts.apply) opts.state.updateGenre(q.video_id, v.inferred);
    proposals.push({
      video_id: q.video_id,
      title: q.title,
      genre: v.inferred,
      agreement: v.agreement,
    });
  }

  log(
    `genre: ${inferred} inferred, ${split} split-vote (left untouched), from ${seeds.length} seeds — ${opts.apply ? "WRITTEN" : "proposals only (use --apply to write)"}`,
  );
  for (const p of proposals.slice(0, 20))
    log(
      `  ${p.genre.padEnd(8)} ${(p.agreement * 100).toFixed(0)}%  ${p.title ?? p.video_id}`,
    );

  await writeJson({
    command: "genre",
    mode: "infer",
    seeds: seeds.length,
    queries: rows.queries.length,
    inferred,
    split,
    applied: opts.apply === true,
    proposals: proposals.slice(0, 40),
  });
  // an all-split run is a finding, not an error — embeddings may not
  // exist yet; say so and exit 0 (the JSON states the census)
  if (inferred === 0 && split === 0)
    log(
      "genre: nothing to infer — run `megadj mood --embeddings` to build the embedding ledger first",
    );
}
