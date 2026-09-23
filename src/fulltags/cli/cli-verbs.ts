// cli-verbs.ts — the fulltags verb arms (#42 item 2 split, out of
// cli.ts): audit / verify-key / ensure-models / enrich. cli.ts keeps
// flag parsing, the verb table, and main().
import { existsSync, statSync, readdirSync } from "node:fs";
import { setExit, writeJson } from "../../shared/cli-output";
import { basename, join } from "node:path";
import { enrichAll, readAiStamps } from "../pipeline/pipeline";
import { groundTruth } from "../write/readers";
import { completeness } from "../write/schema";
import { isAudioFile } from "../write/writer";
import type { CliCtx } from "./cli-args";

export function collectFiles(target: string): string[] {
  const st = statSync(target);
  if (st.isFile()) return isAudioFile(target) ? [target] : [];
  return readdirSync(target, { withFileTypes: true }).flatMap((ent) => {
    if (ent.name.startsWith(".")) return [];
    const full = join(target, ent.name);
    if (ent.isDirectory()) return collectFiles(full);
    return isAudioFile(full) ? [full] : [];
  });
}

/** `ensure-models` — pre-download the ONNX mood models so a later --mood
 *  run never stalls on a 320 MB fetch mid-batch. */
export async function cmdEnsureModels(): Promise<void> {
  const { modelsEnsure, moodModelsPresent, modelDir } =
    await import("../analysis/models");
  try {
    const got = modelsEnsure();
    console.log(
      got.length
        ? `downloaded ${got.length} model file(s) to ${modelDir()}: ${got.join(", ")}`
        : `all mood models already present in ${modelDir()}`,
    );
  } catch (e) {
    console.error(`ensure-models failed: ${(e as Error).message}`);
    setExit(1);
    return;
  }
  if (!moodModelsPresent()) {
    console.error("models still missing after download — check disk space");
    setExit(1);
  }
}

/** `verify-key` — the roadmap #3 gauntlet gate (#185): OpenKeyScan vs
 *  existing tags, ≥80% exact agreement or exit 1 (no batch key write). */
export async function cmdVerifyKey({ argv }: CliCtx): Promise<void> {
  const { parseVerifyKeyArgs, runVerifyKey, printVerifyKeyReport } =
    await import("../utils/verify-key");
  const vk = parseVerifyKeyArgs(argv.slice(1));
  if (vk.error || !vk.targets.length) {
    if (vk.error) console.error(vk.error);
    console.error(
      "usage: fulltags verify-key <folder|files...> [--limit 20] [--refs map.json] [--json]",
    );
    setExit(2);
    return;
  }
  let summary: Awaited<ReturnType<typeof runVerifyKey>> | null = null;
  try {
    summary = await runVerifyKey({
      targets: vk.targets,
      limit: vk.limit,
      refsPath: vk.refsPath,
    });
    if (vk.json) await writeJson(summary);
    else printVerifyKeyReport(console.log, summary);
  } catch (e) {
    console.error((e as Error).message);
    setExit(2);
    return;
  }
  if (!summary.gatePass) setExit(1);
}

/** `audit` — ground-truth completeness gate (gaps → exit 1, both modes). */
export async function cmdAudit({ args }: CliCtx): Promise<void> {
  const dir = args.target;
  if (!dir || !existsSync(dir)) {
    console.error("audit: pass an existing folder — fulltags audit <folder>");
    setExit(1);
    return;
  }
  const files = collectFiles(dir);
  const rows = files.map((f) => {
    const t = groundTruth(f);
    const ai = readAiStamps(f);
    // Dim list derives from the schema SSOT (COMPLETENESS_FIELDS via
    // completeness()) — issue #97: the two audit gates must agree by
    // construction, not by hand-maintained twin arrays.
    const { missing, complete } = completeness(t);
    // DJ identity fields (Beatport-sourced): audited, not gated — a gap
    // here is enrichment headroom, not incompleteness (report-only).
    const identity: string[] = [];
    if (!t.label) identity.push("label");
    if (!t.mixName) identity.push("mix");
    if (!t.isrc) identity.push("isrc");
    if (!t.remixer) identity.push("remixer");
    const aiFilled = [
      ai.aiGenre ? `genre←AI(${ai.aiGenre.split("|")[1] ?? "?"})` : null,
      ai.aiYear ? `year←AI(${ai.aiYear.split("|")[1] ?? "?"})` : null,
    ].filter((x): x is string => x !== null);
    return {
      file: basename(f),
      missing,
      identity,
      aiFilled,
      complete,
    };
  });
  const complete = rows.filter((r) => r.complete).length;
  const aiCount = rows.filter((r) => r.aiFilled.length).length;
  const bpCount = rows.filter((r) => r.identity.length === 0).length;
  const gaps = rows.filter((r) => !r.complete);
  // Gate semantics (megadj audit parity): gaps → exit 1, in BOTH output
  // modes. Agents/CI consume --json and rely on the exit code as the gate.
  if (gaps.length) setExit(1);
  if (args.json) {
    await writeJson({
      ok: gaps.length === 0,
      total: rows.length,
      complete,
      rows,
    });
  } else {
    console.log(
      `audit: ${complete}/${rows.length} complete (art + title + artist + album + genre + year + mood + energy)`,
    );
    if (aiCount)
      console.log(
        `  ${aiCount} track(s) carry AI-filled fields (genre←AI/year←AI with confidence)`,
      );
    if (bpCount)
      console.log(
        `  ${bpCount}/${rows.length} carry full DJ identity (label + mix + isrc + remixer)`,
      );
    if (gaps.length) {
      console.log("\nincomplete:");
      for (const r of gaps) console.log(`  [${r.missing.join(",")}] ${r.file}`);
    } else {
      console.log("✅ all tracks fully tagged");
    }
  }
}

/** The default arm — enrich every audio file under the target. Run only
 *  after main()'s valid gate. */
export async function cmdEnrich({ args }: CliCtx): Promise<void> {
  if (!args.target || !existsSync(args.target)) {
    console.error("fulltags: pass an existing file or folder");
    setExit(1);
    return;
  }

  const files = collectFiles(args.target);
  if (!files.length) {
    console.log(`fulltags: no audio files in ${args.target}`);
    return;
  }
  console.log(
    `fulltags: ${files.length} file(s)${args.stages ? ` · stages: ${args.stages.join("+")}` : " · all stages"}${args.dryRun ? " · DRY RUN" : ""}`,
  );
  // Hints (--title/--artist/--album) only make sense for a single file —
  // they pre-seed the MB lookup / SC search when the filename is garbage.
  const hintFiles =
    (args.hints.title ?? args.hints.artist ?? args.hints.album)
      ? files.slice(0, 1)
      : files;
  if (hintFiles.length < files.length) {
    console.log(
      "fulltags: note — hints apply to the first file only; run `fulltags single <file>` per file for the rest",
    );
  }
  // Mood stage pre-flight: models are ~320 MB on first use — make that
  // explicit up front rather than a mid-batch stall, then reuse.
  const moodWanted = !args.stages || args.stages.includes("mood");
  if (moodWanted && !args.dryRun) {
    const { moodModelsPresent, modelsEnsure, modelDir } =
      await import("../analysis/models");
    if (!moodModelsPresent()) {
      console.log(
        `fulltags: mood models missing — downloading to ${modelDir()} (~320 MB, once)…`,
      );
      try {
        modelsEnsure();
        console.log("fulltags: mood models ready");
      } catch (e) {
        console.log(
          `fulltags: model download failed (${(e as Error).message}) — mood will SKIP`,
        );
      }
    }
  }
  const summary = await enrichAll(hintFiles, {
    ...(args.stages === null ? {} : { only: args.stages }),
    jobs: args.jobs,
    dryRun: args.dryRun,
    upgradeScArt: args.upgradeScArt,
    ...(args.archiveDir === null ? {} : { archiveDir: args.archiveDir }),
    artworkQueue: args.artworkQueue,
    hints: args.hints,
  });
  console.log(
    `\nDONE — ${summary.complete}/${summary.total} complete · ${summary.notes} file(s) changed${args.dryRun ? " (dry run — nothing written)" : ""}`,
  );
}
