/**
 * megadj stem-export — write OverCue stems to a USB volume for XZ Mods playback.
 *
 * Phase 2 + 3 of #555: reads Demucs stem cache, builds OverCue PGZ bundles
 * (96 kHz stereo s16le, 7 mixes per track), writes CDJMODS/ on the target
 * volume.  Each track gets a 16-hex bundle ID derived from the source path.
 *
 * Usage: megadj stem-export <VOLUME> [--limit N] [--dry-run] [--json]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { createHash } from "node:crypto";
import type { ArchiveState } from "../../core/state";
import { commandLog } from "../../shared/progress";
import { writeJson } from "../../shared/cli-output";
import {
  lineHasRequestId,
  lineIsReady,
  openWorkerSession,
  writeNdjsonRequest,
  type WorkerSession,
} from "./analysis-worker";
import { parseJsonOrNull } from "../../shared/leaf/guards";

export interface StemExportOptions {
  state: ArchiveState;
  volume: string;
  limit?: number | undefined;
  dryRun?: boolean | undefined;
  json?: boolean | undefined;
  onProgress?: ((msg: string) => void) | undefined;
}

interface ExportResult {
  frames: number;
  elapsedS: number;
  sourceSha256: string;
}

interface ExportSession {
  convert: (req: {
    source: string;
    stems: Record<string, string>;
    outputDir: string;
  }) => Promise<ExportResult | null>;
  close: () => void;
}

const OVERCUE_DEPS = ["soundfile", "scipy", "numpy"] as const;
const RESPONSE_TIMEOUT_MS = 10 * 60 * 1000;
const READY_TIMEOUT_MS = 2 * 60 * 1000;

/** 16-hex bundle ID from source file path (deterministic, stable). */
function bundleId(sourcePath: string): string {
  return createHash("sha256").update(sourcePath).digest("hex").slice(0, 16);
}

async function openExportSession(): Promise<ExportSession | null> {
  const scriptPath = join(import.meta.dir, "overcue-writer.py");
  const scriptContent = readFileSync(scriptPath, "utf8");

  const inner: WorkerSession<
    { source: string; stems: Record<string, string>; outputDir: string },
    ExportResult
  > | null = await openWorkerSession<
    { source: string; stems: Record<string, string>; outputDir: string },
    ExportResult
  >({
    spawn: () =>
      Bun.spawn({
        cmd: [
          "uv",
          "run",
          ...OVERCUE_DEPS.flatMap((dep) => ["--with", dep]),
          "python",
          "-c",
          scriptContent,
        ],
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
      }),
    isReady(line) {
      const parsed = parseJsonOrNull(line);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "type" in parsed &&
        (parsed as Record<string, unknown>)["type"] === "ready"
      ) {
        return true;
      }
      return lineIsReady(line);
    },
    readyTimeoutMs: READY_TIMEOUT_MS,
    encodeRequest: (req, enc, proc) =>
      writeNdjsonRequest(proc, enc, {
        id: req.source,
        source: req.source,
        stems: req.stems,
        output_dir: req.outputDir,
      }),
    isResponse: lineHasRequestId,
    responseTimeoutMs: RESPONSE_TIMEOUT_MS,
    parse(line, req) {
      const obj = parseJsonOrNull(line) as Record<string, unknown> | null;
      if (obj === null || obj["id"] !== req.source) return null;
      if (obj["status"] !== "ok") return null;
      const framesRaw = Number(obj["frames"]);
      const elapsedRaw = Number(obj["elapsed_s"]);
      return {
        frames: Number.isFinite(framesRaw) ? framesRaw : 0,
        elapsedS: Number.isFinite(elapsedRaw) ? elapsedRaw : 0,
        sourceSha256: String(obj["source_sha256"] ?? ""),
      };
    },
  });

  if (inner === null) return null;

  return { convert: inner.analyze, close: inner.close };
}

export async function stemExport(opts: StemExportOptions): Promise<void> {
  const log = commandLog(opts);
  const { state, volume } = opts;

  if (!existsSync(volume)) {
    log(`stem-export: volume not found: ${volume}`);
    if (opts.json) await writeJson({ command: "stem-export", error: "volume not found" });
    return;
  }

  const contentsDir = join(volume, "Contents");
  if (!existsSync(contentsDir)) {
    log(`stem-export: no Contents/ on volume — expected a shelf or playing USB`);
    if (opts.json) await writeJson({ command: "stem-export", error: "no Contents/ on volume" });
    return;
  }

  const cdjmodsDir = join(volume, "CDJMODS");
  const stemsDir = join(cdjmodsDir, "stems");

  const allStems = state.db
    .query(
      `SELECT sc.video_id, sc.stem_dir, sc.vocals_path, sc.drums_path,
              sc.bass_path, sc.other_path, sc.source_path, t.file_path
       FROM stem_cache sc
       JOIN tracks t ON t.video_id = sc.video_id
       WHERE t.status = 'downloaded'
         AND sc.vocals_path IS NOT NULL
         AND sc.drums_path IS NOT NULL
         AND sc.bass_path IS NOT NULL
         AND sc.other_path IS NOT NULL`,
    )
    .all() as Record<string, unknown>[];

  const candidates = allStems.filter((row) => {
    const fp = String(row["file_path"] ?? "");
    return fp.startsWith(volume) && existsSync(fp);
  });

  log(`stem-export: ${candidates.length} tracks with stems on ${basename(volume)}`);

  const limit = opts.limit ?? candidates.length;
  const queue = candidates.slice(0, Math.max(0, limit));

  const alreadyExported: string[] = [];
  const toExport: Record<string, unknown>[] = [];

  for (const row of queue) {
    const bid = bundleId(String(row["source_path"]));
    const bundleDir = join(stemsDir, bid);
    if (existsSync(join(bundleDir, "overcue-manifest.json"))) {
      alreadyExported.push(String(row["video_id"]));
    } else {
      toExport.push(row);
    }
  }

  log(
    `  ${toExport.length} to export (${alreadyExported.length} already exported, limit ${limit})`,
  );

  if (toExport.length === 0) {
    if (opts.json)
      await writeJson({
        command: "stem-export",
        exported: 0,
        alreadyExported: alreadyExported.length,
        volume,
      });
    return;
  }

  if (opts.dryRun) {
    log(`dry run: would export ${toExport.length} tracks to ${cdjmodsDir}`);
    if (opts.json)
      await writeJson({
        command: "stem-export",
        dryRun: true,
        wouldExport: toExport.length,
        alreadyExported: alreadyExported.length,
        volume,
      });
    return;
  }

  mkdirSync(stemsDir, { recursive: true });

  let session: ExportSession | null = null;
  try {
    log("  starting OverCue writer…");
    session = await openExportSession();
    if (session === null) {
      log("  ❌ failed to start OverCue writer");
      if (opts.json)
        await writeJson({
          command: "stem-export",
          error: "overcue writer failed to start",
          exported: 0,
        });
      return;
    }
  } catch (error) {
    log(`  ❌ writer start error: ${error}`);
    if (opts.json) await writeJson({ command: "stem-export", error: String(error), exported: 0 });
    return;
  }

  let exported = 0;
  let failed = 0;
  const indexEntries: { file_path: string; bundle: string; video_id: string }[] = [];

  try {
    for (let i = 0; i < toExport.length; i++) {
      const row = toExport[i]!;
      const sourcePath = String(row["source_path"]);
      const filePath = String(row["file_path"]);
      const label = basename(filePath);
      const bid = bundleId(sourcePath);
      const bundleDir = join(stemsDir, bid);

      log(`  [${i + 1}/${toExport.length}] writing OverCue bundle: ${label}…`);
      opts.onProgress?.(`stem-export ${i + 1}/${toExport.length}: ${label}`);

      const result = await session.convert({
        source: filePath,
        stems: {
          vocals: String(row["vocals_path"]),
          drums: String(row["drums_path"]),
          bass: String(row["bass_path"]),
          other: String(row["other_path"]),
        },
        outputDir: bundleDir,
      });

      if (result === null) {
        failed++;
        log(`  ❌ export failed: ${label}`);
        session.close();
        session = await openExportSession();
        if (session === null) {
          log("  ❌ writer died; aborting remaining queue");
          failed += toExport.length - i - 1;
          break;
        }
        continue;
      }

      const relPath = `/${relative(volume, filePath)}`;
      indexEntries.push({ file_path: relPath, bundle: bid, video_id: String(row["video_id"]) });

      exported++;
      log(`  ✅ ${label} — ${result.frames} frames, ${result.elapsedS}s`);
    }
  } finally {
    session?.close();
  }

  if (indexEntries.length > 0) {
    const existingIndex = existsSync(join(cdjmodsDir, "index.json"))
      ? (parseJsonOrNull(readFileSync(join(cdjmodsDir, "index.json"), "utf8")) as Record<
          string,
          unknown
        > | null)
      : null;
    const existingEntries = Array.isArray(existingIndex?.["entries"])
      ? (existingIndex["entries"] as Record<string, unknown>[])
      : [];

    const entryMap = new Map<string, Record<string, unknown>>();
    for (const e of existingEntries) entryMap.set(String(e["file_path"]), e);
    for (const e of indexEntries) entryMap.set(e.file_path, e);

    const index = { schema: "overcue-index/1", entries: [...entryMap.values()] };
    writeFileSync(join(cdjmodsDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
    log(`  wrote CDJMODS/index.json (${entryMap.size} entries)`);
  }

  const loaderExists = existsSync(join(volume, "autoexec.bin"));

  log(`\nstem-export: ${exported} exported, ${failed} failed, ${alreadyExported.length} cached`);
  if (!loaderExists) {
    log(`  ⚠️  no autoexec.bin on ${basename(volume)} — use XZ Mods app to prepare the USB loader`);
  } else {
    log(`  ✅ autoexec.bin present — USB ready for XZ Mods playback`);
  }

  if (opts.json) {
    await writeJson({
      command: "stem-export",
      exported,
      failed,
      alreadyExported: alreadyExported.length,
      volume,
      cdjmodsDir,
      loaderPresent: loaderExists,
    });
  }
}
